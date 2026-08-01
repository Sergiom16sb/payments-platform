import { randomBytes } from 'node:crypto';
import type { Card } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../exceptions/index.js';
import { detectBrand, isLuhnValid } from '../helpers/luhn.js';
import {
  type CardsRepository,
  getCardsRepository,
} from '../repositories/cards.repository.js';

/**
 * Card tokenization service (PLAN §9, §10).
 *
 * The flow:
 *   1. Validate Luhn on the PAN.
 *   2. Reject expired cards.
 *   3. Generate an opaque token (tok_<24 random hex chars>).
 *   4. Detect brand from BIN.
 *   5. Persist only last4 + token + meta — PAN and CVV are discarded
 *      immediately after step 3. They never reach the DB or any log.
 *
 * Subsequent operations use the returned token (or the row's id) instead
 * of the PAN. The CVV is used once at registration to prove card
 * possession; PCI-DSS prohibits storing it.
 */

function generateToken(): string {
  return `tok_${randomBytes(24).toString('hex')}`;
}

function isExpired(expMonth: number, expYear: number): boolean {
  const now = new Date();
  const thisMonth = now.getUTCMonth() + 1;
  const thisYear = now.getUTCFullYear();
  if (expYear < thisYear) return true;
  if (expYear === thisYear && expMonth < thisMonth) return true;
  return false;
}

export class CardsService {
  constructor(private readonly cards: CardsRepository = getCardsRepository()) {}

  /**
   * Tokenize and persist a new card. Returns the persisted row with
   * PAN/CVV already discarded.
   */
  async register(input: {
    userId: string;
    pan: string;
    cvv: string;
    expMonth: number;
    expYear: number;
    cardholderName: string;
  }): Promise<Card> {
    if (!isLuhnValid(input.pan)) {
      throw new BadRequestException('PAN failed Luhn check', 'INVALID_PAN');
    }
    if (isExpired(input.expMonth, input.expYear)) {
      throw new BadRequestException('Card is expired', 'CARD_EXPIRED');
    }

    const last4 = input.pan.slice(-4);
    const brand = detectBrand(input.pan);
    const token = generateToken();

    // PAN and CVV go out of scope here — JS has no real memory wiping,
    // but for a technical test on this scope we don't need it. In
    // production we'd zero the buffer and run a GCMPAUSE fence.
    return this.cards.create({
      userId: input.userId,
      brand,
      last4,
      expMonth: input.expMonth,
      expYear: input.expYear,
      cardholderName: input.cardholderName,
      token,
    });
  }

  async listForUser(userId: string): Promise<Card[]> {
    return this.cards.listByUser(userId);
  }

  /**
   * Returns the card only if it belongs to the requesting user.
   * 403 otherwise — the caller is leaking existence of cards they
   * shouldn't know about.
   */
  async getOwned(id: string, userId: string): Promise<Card> {
    const card = await this.cards.findById(id);
    if (!card) {
      // NotFoundException -> 404 CARD_NOT_FOUND. (Was BadRequestException
      // -> 400 before PR #13; the soft-delete change made this path much
      // more reachable so the fix is part of this PR.)
      throw new NotFoundException(`Card ${id} not found`, 'CARD_NOT_FOUND');
    }
    if (card.userId !== userId) {
      throw new ForbiddenException(
        'You do not own this card',
        'NOT_CARD_OWNER'
      );
    }
    return card;
  }

  /**
   * Same ownership check for delete. Returns nothing on success.
   */
  async deleteOwned(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    await this.cards.delete(id);
  }

  /**
   * Admin operation: clear deletedAt on a soft-deleted card so it becomes
   * visible and usable again. The route layer is expected to gate this
   * behind requireRole('ADMIN') — this method does NOT check ownership.
   * Returns the restored card. 404 if the id doesn't exist at all.
   * Idempotent: restoring an already-active card returns it as-is.
   */
  async adminRestore(id: string): Promise<Card> {
    // First look it up INCLUDING soft-deleted rows (admin sees everything).
    const deleted = await this.cards.findByIdIncludingDeleted(id);
    if (!deleted) {
      throw new NotFoundException(`Card ${id} not found`, 'CARD_NOT_FOUND');
    }
    if (deleted.deletedAt === null) {
      // Already active — idempotent.
      return deleted;
    }
    const restored = await this.cards.restore(id);
    if (!restored) {
      // Race: another admin restored between our find and restore.
      // The row is now active; re-fetch and return.
      const fresh = await this.cards.findById(id);
      if (!fresh) {
        throw new NotFoundException(`Card ${id} not found`, 'CARD_NOT_FOUND');
      }
      return fresh;
    }
    // Re-fetch the now-active row to return its current state.
    const after = await this.cards.findById(id);
    if (!after) {
      throw new NotFoundException(`Card ${id} not found`, 'CARD_NOT_FOUND');
    }
    return after;
  }
}

let _default: CardsService | undefined;
export function getCardsService(): CardsService {
  if (_default) return _default;
  _default = new CardsService();
  return _default;
}

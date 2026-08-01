import type { Card, PrismaClient } from '@prisma/client';
import { getPrisma } from '../config/database.js';
import { NotFoundException } from '../exceptions/index.js';

/**
 * Cards repository. Wraps Prisma calls for the Card model.
 *
 * Soft delete (PR #13): rows are never physically removed. `delete()`
 * sets `deletedAt = now()`; every read filters `deletedAt: null` so the
 * user-facing API behaves as if the row is gone while the FK from
 * Payment rows stays intact.
 */
export class CardsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrisma();
  }

  async create(input: {
    userId: string;
    brand: 'VISA' | 'MASTERCARD' | 'AMEX' | 'UNKNOWN';
    last4: string;
    expMonth: number;
    expYear: number;
    cardholderName: string;
    token: string;
  }): Promise<Card> {
    return this.prisma.card.create({
      data: {
        userId: input.userId,
        brand: input.brand,
        last4: input.last4,
        expMonth: input.expMonth,
        expYear: input.expYear,
        cardholderName: input.cardholderName,
        token: input.token,
      },
    });
  }

  /** Returns the card if it exists AND has not been soft-deleted. */
  async findById(id: string): Promise<Card | null> {
    return this.prisma.card.findFirst({
      where: { id, deletedAt: null },
    });
  }

  /**
   * Admin helper: find a card by id regardless of soft-delete state.
   * Used by the admin-restore flow to look up rows that findById()
   * would hide.
   */
  async findByIdIncludingDeleted(id: string): Promise<Card | null> {
    return this.prisma.card.findUnique({ where: { id } });
  }

  async findByToken(token: string): Promise<Card | null> {
    // Only ACTIVE cards may be charged via their token. A soft-deleted
    // card's token is no longer usable for new payments.
    return this.prisma.card.findFirst({
      where: { token, deletedAt: null },
    });
  }

  /** Lists the user's ACTIVE cards, newest first. */
  async listByUser(userId: string): Promise<Card[]> {
    return this.prisma.card.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Soft delete: marks deletedAt = now(). P2025 (id not found) or a
   * record already deleted (treated as no-op for idempotency) -> NotFoundException.
   */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.card.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2025'
      ) {
        throw new NotFoundException(`Card ${id} not found`, 'CARD_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Restore a previously soft-deleted card (admin/maintenance helper,
   * not exposed via HTTP in PR #13). Returns true if a row was actually
   * restored, false if there was no matching deleted row.
   */
  async restore(id: string): Promise<boolean> {
    const result = await this.prisma.card.updateMany({
      where: { id, NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
    return result.count > 0;
  }
}

let _default: CardsRepository | undefined;
export function getCardsRepository(): CardsRepository {
  if (_default) return _default;
  _default = new CardsRepository();
  return _default;
}

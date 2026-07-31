import type { Card, PrismaClient } from '@prisma/client';
import { getPrisma } from '../config/database.js';
import { NotFoundException } from '../exceptions/index.js';

/**
 * Cards repository. Wraps Prisma calls for the Card model.
 *
 * Note: nothing here ever accepts or returns a PAN or CVV — those live
 * only in the tokenization service and are discarded before the row
 * reaches this layer (PLAN §9).
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

  async findById(id: string): Promise<Card | null> {
    return this.prisma.card.findUnique({ where: { id } });
  }

  async findByToken(token: string): Promise<Card | null> {
    return this.prisma.card.findUnique({ where: { token } });
  }

  /** Lists all cards owned by the given user, newest first. */
  async listByUser(userId: string): Promise<Card[]> {
    return this.prisma.card.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Delete a card by id. P2025 -> NotFoundException. */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.card.delete({ where: { id } });
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
}

let _default: CardsRepository | undefined;
export function getCardsRepository(): CardsRepository {
  if (_default) return _default;
  _default = new CardsRepository();
  return _default;
}

import type {
  Payment,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { getPrisma } from '../config/database.js';
import { ConflictException, NotFoundException } from '../exceptions/index.js';

export interface ListFilters {
  status?: PaymentStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/**
 * Payments repository. Wraps Prisma calls for the Payment model.
 *
 * The idempotencyKey unique constraint is the DB-level guarantee behind
 * "no duplicate charges on retry" — findByIdempotencyKey lets the service
 * check for an existing payment BEFORE calling the processor (cheap path),
 * and create() still relies on the unique index as the final guard against
 * races (P2002 -> ConflictException).
 */
export class PaymentsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrisma();
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
  }

  async findById(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { id } });
  }

  async create(input: {
    userId: string;
    cardId: string;
    amount: Prisma.Decimal | string | number;
    currency: string;
    idempotencyKey: string;
  }): Promise<Payment> {
    try {
      return await this.prisma.payment.create({
        data: {
          userId: input.userId,
          cardId: input.cardId,
          amount: input.amount,
          currency: input.currency,
          idempotencyKey: input.idempotencyKey,
          status: 'PENDING',
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'Payment already processed with this idempotency key',
          'IDEMPOTENCY_CONFLICT'
        );
      }
      throw err;
    }
  }

  async markResolved(
    id: string,
    result: {
      status: 'APPROVED' | 'REJECTED';
      processorRef: string | null;
      rejectionReason: string | null;
    }
  ): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id },
      data: result,
    });
  }

  async listForUser(
    userId: string,
    filters: ListFilters
  ): Promise<{
    data: Payment[];
    total: number;
  }> {
    const where: Prisma.PaymentWhereInput = { userId };
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total };
  }

  async getOrThrow(id: string): Promise<Payment> {
    const payment = await this.findById(id);
    if (!payment) {
      throw new NotFoundException(
        `Payment ${id} not found`,
        'PAYMENT_NOT_FOUND'
      );
    }
    return payment;
  }
}

let _default: PaymentsRepository | undefined;
export function getPaymentsRepository(): PaymentsRepository {
  if (_default) return _default;
  _default = new PaymentsRepository();
  return _default;
}

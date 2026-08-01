import { Prisma, type PrismaClient, type Refund } from '@prisma/client';
import { getPrisma } from '../config/database.js';
import { ConflictException, NotFoundException } from '../exceptions/index.js';

/**
 * Refunds repository. Wraps Prisma calls for the Refund model.
 *
 * Idempotency contract:
 *   - findByIdempotencyKey returns the row if it exists; the service
 *     uses this as a cheap pre-check before calling the processor.
 *   - create() relies on the unique index on idempotencyKey as the
 *     final race guard — a P2002 is mapped to ConflictException
 *     (409 IDEMPOTENCY_CONFLICT) so the caller can distinguish 'you
 *     already refunded this with that key' from other failures.
 */
export class RefundsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrisma();
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    return this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
  }

  async findById(id: string): Promise<Refund | null> {
    return this.prisma.refund.findUnique({ where: { id } });
  }

  async create(input: {
    paymentId: string;
    amount: Prisma.Decimal | string | number;
    currency: string;
    reason?: string;
    idempotencyKey: string;
  }): Promise<Refund> {
    try {
      return await this.prisma.refund.create({
        data: {
          paymentId: input.paymentId,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason,
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
          'Refund already processed with this idempotency key',
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
  ): Promise<Refund> {
    return this.prisma.refund.update({
      where: { id },
      data: result,
    });
  }

  /** Lists refunds for a payment, newest first. */
  async listByPayment(paymentId: string): Promise<Refund[]> {
    return this.prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Ensures a refund exists; throws NotFoundException otherwise. */
  async getOrThrow(id: string): Promise<Refund> {
    const refund = await this.findById(id);
    if (!refund) {
      throw new NotFoundException(`Refund ${id} not found`, 'REFUND_NOT_FOUND');
    }
    return refund;
  }

  /**
   * Sums approved + pending refunds for a payment. Used to enforce the
   * 'can't over-refund' rule when the caller omits `amount` (defaults
   * to the remaining refundable balance).
   */
  async sumActiveForPayment(paymentId: string): Promise<Prisma.Decimal> {
    const result = await this.prisma.refund.aggregate({
      where: {
        paymentId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }
}

let _default: RefundsRepository | undefined;
export function getRefundsRepository(): RefundsRepository {
  if (_default) return _default;
  _default = new RefundsRepository();
  return _default;
}

import type { Refund } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateRefundRequestSchema,
  RefundResponseSchema,
} from '../dto/payments/refunds.schemas.js';
import { UnauthorizedException } from '../exceptions/index.js';
import { getRefundsService } from '../services/refunds.service.js';

function userIdFrom(req: FastifyRequest): string {
  const sub = (req.user as { sub?: string } | undefined)?.sub;
  if (!sub) {
    throw new UnauthorizedException(
      'No authenticated user on request',
      'UNAUTHENTICATED'
    );
  }
  return sub;
}

function toView(refund: Refund) {
  return RefundResponseSchema.parse({
    id: refund.id,
    paymentId: refund.paymentId,
    amount: refund.amount.toString(),
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    processorRef: refund.processorRef,
    rejectionReason: refund.rejectionReason,
    idempotencyKey: refund.idempotencyKey,
    createdAt: refund.createdAt.toISOString(),
  });
}

export const refundsController = {
  /**
   * POST /api/payments/:id/refund
   * Body: { amount?, reason?, idempotencyKey? }.
   * Returns 201 with the created refund (APPROVED or REJECTED).
   */
  async create(
    req: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const body = CreateRefundRequestSchema.parse(req.body ?? {});
    const refund = await getRefundsService().create({
      userId: userIdFrom(req),
      paymentId: req.params.id,
      ...body,
    });
    reply.status(201);
    return toView(refund);
  },

  /**
   * GET /api/payments/:id/refunds
   * Lists the refunds for a payment (owner only, via payments.getOwned).
   */
  async list(
    req: FastifyRequest<{ Params: { id: string } }>
  ): Promise<unknown[]> {
    const refunds = await getRefundsService().listForPayment(
      userIdFrom(req),
      req.params.id
    );
    return refunds.map(toView);
  },

  /**
   * GET /api/refunds/:id  (singular, top-level for convenience)
   * Returns one refund, owner-checked via the parent payment.
   */
  async getOne(
    req: FastifyRequest<{ Params: { id: string } }>
  ): Promise<unknown> {
    const refund = await getRefundsService().getOwned(
      req.params.id,
      userIdFrom(req)
    );
    return toView(refund);
  },
};

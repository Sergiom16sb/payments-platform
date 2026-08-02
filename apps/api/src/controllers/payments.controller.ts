import type { Payment } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CreatePaymentRequestSchema,
  PaymentQuerySchema,
} from '../dto/payments/payments.schemas.js';
import {
  ForbiddenException,
  UnauthorizedException,
} from '../exceptions/index.js';
import { getPaymentsService } from '../services/payments.service.js';

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

function toView(payment: Payment) {
  return {
    id: payment.id,
    userId: payment.userId,
    cardId: payment.cardId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    status: payment.status,
    processorRef: payment.processorRef,
    rejectionReason: payment.rejectionReason,
    idempotencyKey: payment.idempotencyKey,
    createdAt: payment.createdAt.toISOString(),
  };
}

export const paymentsController = {
  async create(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const body = CreatePaymentRequestSchema.parse(req.body);
    const payment = await getPaymentsService().create({
      userId: userIdFrom(req),
      ...body,
    });
    reply.status(201);
    return toView(payment);
  },

  async getOne(
    req: FastifyRequest<{ Params: { id: string } }>
  ): Promise<unknown> {
    const payment = await getPaymentsService().getOwned(
      req.params.id,
      userIdFrom(req)
    );
    return toView(payment);
  },

  /**
   * GET /api/users/:id/payments — owner or admin only. The :id in the
   * path must match the caller's own id (admin bypass deferred — no
   * admin routes exist yet in this scope).
   */
  async listForUser(
    req: FastifyRequest<{ Params: { id: string }; Querystring: unknown }>
  ): Promise<unknown> {
    const requesterId = userIdFrom(req);
    if (req.params.id !== requesterId) {
      // Authenticated but not authorized for someone else's payment history — 403, not 401.
      throw new ForbiddenException(
        'You can only list your own payments',
        'NOT_SELF'
      );
    }
    const query = PaymentQuerySchema.parse(req.query);
    const { data, total } = await getPaymentsService().listForUser(
      requesterId,
      {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      }
    );
    return {
      data: data.map(toView),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  },
};

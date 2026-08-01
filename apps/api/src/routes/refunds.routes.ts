import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { refundsController } from '../controllers/refunds.controller.js';
import {
  CreateRefundRequestSchema,
  RefundResponseSchema,
} from '../dto/payments/refunds.schemas.js';
import { IdSchema } from '../schemas/index.js';

/**
 * Refund routes (PLAN §7 + PR #16). All routes require authentication
 * (preHandler: app.authenticate). Ownership is checked inside the
 * service via the existing payments.getOwned() — no new auth surface.
 *
 * Three endpoints:
 *   POST /api/payments/:id/refund   -> 201 RefundResponseSchema
 *   GET  /api/payments/:id/refunds   -> 200 RefundResponseSchema[]
 *   GET  /api/refunds/:id            -> 200 RefundResponseSchema
 *
 * Mounted at /api by app.ts so both /api/payments/... and
 * /api/refunds/:id resolve.
 *
 * Response convention: raw shape (matches auth.routes.ts / cards.routes.ts).
 * Only errors go through the {success: false, error: {...}} envelope.
 */
export async function refundsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: unknown }>('/payments/:id/refund', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
      body: CreateRefundRequestSchema,
      response: { 201: RefundResponseSchema },
    },
    handler: refundsController.create,
  });

  app.get<{ Params: { id: string } }>('/payments/:id/refunds', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: z.array(RefundResponseSchema) },
    },
    handler: refundsController.list,
  });

  app.get<{ Params: { id: string } }>('/refunds/:id', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: RefundResponseSchema },
    },
    handler: refundsController.getOne,
  });
}

export default refundsRoutes;

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { paymentsController } from '../controllers/payments.controller.js';
import {
  CreatePaymentRequestSchema,
  PaymentResponseSchema,
} from '../dto/payments/payments.schemas.js';
import { IdSchema } from '../schemas/index.js';

/**
 * Payments routes (PLAN §7). All routes require an authenticated user.
 * Mounted under /api by app.ts so both /api/payments and
 * /api/users/:id/payments resolve correctly.
 */
export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/payments — create + process a payment
  app.post('/payments', {
    preHandler: app.authenticate,
    schema: {
      body: CreatePaymentRequestSchema,
      response: { 201: PaymentResponseSchema },
    },
    handler: paymentsController.create,
  });

  // GET /api/payments/:id — fetch one payment (owner only)
  app.get<{ Params: { id: string } }>('/payments/:id', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: PaymentResponseSchema },
    },
    handler: paymentsController.getOne,
  });

  // GET /api/users/:id/payments — paginated history (owner only in this scope)
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/users/:id/payments',
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({ id: IdSchema }),
      },
      handler: paymentsController.listForUser,
    }
  );
}

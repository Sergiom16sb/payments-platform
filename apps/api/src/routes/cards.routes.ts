import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cardsController } from '../controllers/cards.controller.js';
import {
  CardResponseSchema,
  CreateCardRequestSchema,
} from '../dto/cards/cards.schemas.js';
import { IdSchema } from '../schemas/index.js';

/**
 * Cards routes. All routes require an authenticated user
 * (preHandler: app.authenticate) — cards are private to each user.
 *
 * Validation via Zod schemas; serialization via CardResponseSchema (no
 * PAN, no CVV — those fields exist only in the request).
 *
 * Success responses are NOT wrapped in a {success, data} envelope —
 * matching the convention established in auth.routes.ts (raw shape).
 * Only errors go through the {success: false, error: {...}} envelope,
 * which is applied globally by the error handler.
 */
export async function cardsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', {
    preHandler: app.authenticate,
    schema: {
      body: CreateCardRequestSchema,
      response: { 201: CardResponseSchema },
    },
    handler: cardsController.create,
  });

  app.get('/', {
    preHandler: app.authenticate,
    schema: {
      response: { 200: z.array(CardResponseSchema) },
    },
    handler: cardsController.list,
  });

  app.get<{ Params: { id: string } }>('/:id', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: CardResponseSchema },
    },
    handler: cardsController.getOne,
  });

  app.delete<{ Params: { id: string } }>('/:id', {
    preHandler: app.authenticate,
    schema: {
      params: z.object({ id: IdSchema }),
    },
    handler: cardsController.delete,
  });
}

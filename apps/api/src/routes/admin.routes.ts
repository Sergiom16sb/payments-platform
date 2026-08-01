import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminController } from '../controllers/admin.controller.js';
import { CardResponseSchema } from '../dto/cards/cards.schemas.js';
import { IdSchema } from '../schemas/index.js';

/**
 * Admin routes (gated by requireRole('ADMIN')). Mounted under
 * /api/admin by app.ts. Every route here uses both preHandlers:
 *
 *   preHandler: [app.authenticate, app.requireRole('ADMIN')]
 *
 * authenticate runs first (401 if no/bad token), then requireRole (403
 * if role !== 'ADMIN'). The handler can trust req.user.role === 'ADMIN'.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/cards/:id/restore', {
    preHandler: [app.authenticate, app.requireRole('ADMIN')],
    schema: {
      params: z.object({ id: IdSchema }),
      response: { 200: CardResponseSchema },
    },
    handler: adminController.restoreCard,
  });
}

export default adminRoutes;

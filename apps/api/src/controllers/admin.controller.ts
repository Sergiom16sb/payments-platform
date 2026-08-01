import type { FastifyRequest } from 'fastify';
import { CardResponseSchema } from '../dto/cards/cards.schemas.js';
import { getCardsService } from '../services/cards.service.js';

/**
 * Admin HTTP handlers. All routes in this controller are gated by
 * requireRole('ADMIN') in the route file — the handler can trust
 * req.user.role === 'ADMIN' and skip ownership checks.
 */

export const adminController = {
  /**
   * POST /api/admin/cards/:id/restore
   * Reverts a soft-deleted card. 200 with the restored card on success,
   * 404 if the id doesn't exist (whether deleted or never existed —
   * findByIdIncludingDeleted returns null in both cases).
   */
  async restoreCard(
    req: FastifyRequest<{ Params: { id: string } }>
  ): Promise<unknown> {
    const card = await getCardsService().adminRestore(req.params.id);
    return CardResponseSchema.parse({
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      cardholderName: card.cardholderName,
      token: card.token,
      createdAt: card.createdAt.toISOString(),
    });
  },
};

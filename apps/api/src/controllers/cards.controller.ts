import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CardResponseSchema,
  CreateCardRequestSchema,
} from '../dto/cards/cards.schemas.js';
import { UnauthorizedException } from '../exceptions/index.js';
import { getCardsService } from '../services/cards.service.js';

/**
 * Cards HTTP handlers. Authentication is enforced via
 * `preHandler: app.authenticate` in the route file — by the time we
 * reach a handler, req.user is set.
 */

function toView(card: {
  id: string;
  brand: 'VISA' | 'MASTERCARD' | 'AMEX' | 'UNKNOWN';
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  token: string;
  createdAt: Date;
}) {
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
}

function userIdFrom(req: FastifyRequest): string {
  const sub = (req.user as { sub?: string } | undefined)?.sub;
  if (!sub) {
    // Should never happen if the route has preHandler: app.authenticate,
    // but defense in depth.
    throw new UnauthorizedException(
      'No authenticated user on request',
      'UNAUTHENTICATED'
    );
  }
  return sub;
}

export const cardsController = {
  async create(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const body = CreateCardRequestSchema.parse(req.body);
    const card = await getCardsService().register({
      userId: userIdFrom(req),
      ...body,
    });
    reply.status(201);
    return toView(card);
  },

  async list(req: FastifyRequest): Promise<unknown[]> {
    const cards = await getCardsService().listForUser(userIdFrom(req));
    return cards.map(toView);
  },

  async getOne(
    req: FastifyRequest<{ Params: { id: string } }>
  ): Promise<unknown> {
    const card = await getCardsService().getOwned(
      req.params.id,
      userIdFrom(req)
    );
    return toView(card);
  },

  async delete(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    await getCardsService().deleteOwned(req.params.id, userIdFrom(req));
    reply.status(204);
  },
};

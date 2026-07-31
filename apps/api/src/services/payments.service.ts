import { randomUUID } from 'node:crypto';
import type { Payment } from '@prisma/client';
import {
  ForbiddenException,
  PaymentRequiredException,
} from '../exceptions/index.js';
import {
  getPaymentsRepository,
  type ListFilters,
  type PaymentsRepository,
} from '../repositories/payments.repository.js';
import { type CardsService, getCardsService } from './cards.service.js';
import {
  getPaymentsProcessorClient,
  type PaymentsProcessorClient,
} from './payments-processor.client.js';

/**
 * Payments service (PLAN §7, §9, §10). Orchestrates:
 *
 *   1. Idempotency check — if idempotencyKey was already used, return the
 *      EXISTING payment instead of creating a new one (PLAN §10: "misma
 *      clave -> mismo pago"). No re-charge, no processor call.
 *   2. Card ownership check — the card must belong to the requesting user
 *      (403 NOT_CARD_OWNER, reusing the same check as cards.service).
 *   3. Create a PENDING payment row (idempotencyKey uniqueness is the
 *      final DB-level guard against a race between two concurrent
 *      requests with the same key).
 *   4. Call the processor with the card's TOKEN — never the PAN (PLAN §9).
 *   5. Update the payment to APPROVED or REJECTED based on the processor
 *      response. A REJECTED processor result maps to a 402 exception,
 *      but the payment row is still persisted as REJECTED (so it shows
 *      up in history) — the 402 is what the caller sees in the response.
 *   6. If the processor call itself throws (503/504 after retries), the
 *      payment stays PENDING and the exception propagates as 503/504.
 *      A client retrying the same idempotencyKey will find the PENDING
 *      row on step 1 and — for this scope — we simply return it as-is
 *      (a background reconciliation job would resolve it in production).
 */
export class PaymentsService {
  constructor(
    private readonly payments: PaymentsRepository = getPaymentsRepository(),
    private readonly cards: CardsService = getCardsService(),
    private readonly processor: PaymentsProcessorClient = getPaymentsProcessorClient()
  ) {}

  async create(input: {
    userId: string;
    cardId: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
  }): Promise<Payment> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    const existing = await this.payments.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.userId !== input.userId) {
        // Someone else's idempotency key collided with ours (practically
        // impossible with UUIDs, but the client can supply an arbitrary
        // string) — don't leak the existing payment.
        throw new ForbiddenException(
          'Idempotency key belongs to another user',
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      return existing;
    }

    // Ownership check — throws 403/404 if the card isn't the caller's.
    const card = await this.cards.getOwned(input.cardId, input.userId);

    const payment = await this.payments.create({
      userId: input.userId,
      cardId: input.cardId,
      amount: input.amount,
      currency: input.currency,
      idempotencyKey,
    });

    const result = await this.processor.process({
      paymentId: payment.id,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      cardToken: card.token,
    });

    const resolved = await this.payments.markResolved(payment.id, {
      status: result.status,
      processorRef: result.processorRef,
      rejectionReason: result.reason,
    });

    if (result.status === 'REJECTED') {
      throw new PaymentRequiredException(
        `Payment rejected: ${result.reason}`,
        'PAYMENT_REJECTED',
        { payment: resolved }
      );
    }

    return resolved;
  }

  async getOwned(id: string, userId: string): Promise<Payment> {
    const payment = await this.payments.getOrThrow(id);
    if (payment.userId !== userId) {
      throw new ForbiddenException(
        'You do not own this payment',
        'NOT_PAYMENT_OWNER'
      );
    }
    return payment;
  }

  async listForUser(
    userId: string,
    filters: ListFilters
  ): Promise<{ data: Payment[]; total: number }> {
    return this.payments.listForUser(userId, filters);
  }
}

let _default: PaymentsService | undefined;
export function getPaymentsService(): PaymentsService {
  if (_default) return _default;
  _default = new PaymentsService();
  return _default;
}

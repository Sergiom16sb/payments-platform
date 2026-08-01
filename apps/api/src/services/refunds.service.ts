import { randomUUID } from 'node:crypto';
import type { Payment, Refund } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getEnv } from '../config/env.js';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '../exceptions/index.js';
import {
  getRefundsRepository,
  type RefundsRepository,
} from '../repositories/refunds.repository.js';
import {
  getPaymentsService,
  type PaymentsService,
} from './payments.service.js';
import {
  getPaymentsProcessorClient,
  type PaymentsProcessorClient,
} from './payments-processor.client.js';

/**
 * Refund service (PR #16).
 *
 * Flow (mirrors payments.service.ts):
 *   1. Idempotency check — if the key was already used, return the
 *      EXISTING refund (no re-charge, no processor call).
 *   2. Ownership check — the user must own the parent payment
 *      (403 NOT_PAYMENT_OWNER, reusing the same check as payments).
 *   3. Eligibility check — payment.status must be APPROVED, or PENDING
 *      but only within PAYMENT_PENDING_REFUND_WINDOW_MINUTES of
 *      createdAt. Otherwise: 409 REFUND_NOT_ELIGIBLE.
 *   4. Over-refund check — amount (or payment.amount if omitted) must
 *      not exceed (payment.amount - sum(active_refunds.amount)). If it
 *      would, 422 REFUND_EXCEEDS_REMAINING.
 *   5. Create PENDING refund row (idempotencyKey uniqueness is the
 *      final DB-level guard against a race between two concurrent
 *      requests with the same key).
 *   6. Call the processor with the card's TOKEN, never the PAN.
 *   7. Update the refund to APPROVED or REJECTED. A REJECTED processor
 *      result does NOT throw (unlike a rejected payment) — the refund
 *      row is persisted as REJECTED and the client gets 201 with the
 *      rejection reason. Reason: a refund is a NEGATIVE money event;
 *      if declined, the original charge is intact, no client action
 *      is required, and the 201-with-rejection matches the typical
 *      async-refund UX.
 */
export class RefundsService {
  constructor(
    private readonly refunds: RefundsRepository = getRefundsRepository(),
    private readonly payments: PaymentsService = getPaymentsService(),
    private readonly processor: PaymentsProcessorClient = getPaymentsProcessorClient()
  ) {}

  async create(input: {
    userId: string;
    paymentId: string;
    amount?: number;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<Refund> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    // 1. Idempotency pre-check.
    const existing = await this.refunds.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.paymentId !== input.paymentId) {
        throw new ForbiddenException(
          'Idempotency key belongs to another refund',
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      return existing;
    }

    // 2. Ownership check via the existing payments service.
    const payment = await this.payments.getOwned(input.paymentId, input.userId);

    // 3. Eligibility.
    this.assertRefundable(payment);

    // 4. Amount defaulting + over-refund check.
    const alreadyRefundedOrPending = await this.refunds.sumActiveForPayment(
      payment.id
    );
    const paymentAmount = new Prisma.Decimal(payment.amount.toString());
    const maxRefundable = paymentAmount.minus(alreadyRefundedOrPending);
    const requested = input.amount
      ? new Prisma.Decimal(input.amount)
      : maxRefundable;

    if (requested.lte(0)) {
      throw new UnprocessableEntityException(
        'Nothing left to refund on this payment',
        'REFUND_EXCEEDS_REMAINING',
        { remaining: maxRefundable.toFixed(2) }
      );
    }
    if (requested.gt(maxRefundable)) {
      throw new UnprocessableEntityException(
        `Refund amount ${requested.toFixed(2)} exceeds remaining ${maxRefundable.toFixed(2)}`,
        'REFUND_EXCEEDS_REMAINING',
        { requested: requested.toFixed(2), remaining: maxRefundable.toFixed(2) }
      );
    }

    // 5. Create the PENDING row.
    const refund = await this.refunds.create({
      paymentId: payment.id,
      amount: requested.toFixed(2),
      currency: payment.currency,
      reason: input.reason,
      idempotencyKey,
    });

    // 6. Call the processor.
    const result = await this.processor.processRefund({
      refundId: refund.id,
      paymentId: payment.id,
      amount: requested.toFixed(2),
      currency: payment.currency,
    });

    // 7. Mark resolved (APPROVED or REJECTED — never throws on REJECTED).
    const resolved = await this.refunds.markResolved(refund.id, {
      status: result.status,
      processorRef: result.processorRef,
      rejectionReason: result.reason,
    });

    return resolved;
  }

  /**
   * List refunds for a payment. Ownership check via the payments service
   * (throws 403 NOT_PAYMENT_OWNER if the caller is not the owner).
   */
  async listForPayment(userId: string, paymentId: string): Promise<Refund[]> {
    await this.payments.getOwned(paymentId, userId);
    return this.refunds.listByPayment(paymentId);
  }

  /**
   * Get one refund. Returns it if the user owns the parent payment;
   * throws 403 otherwise.
   */
  async getOwned(refundId: string, userId: string): Promise<Refund> {
    const refund = await this.refunds.getOrThrow(refundId);
    // Reuse the payments ownership check by reading the parent.
    await this.payments.getOwned(refund.paymentId, userId);
    return refund;
  }

  private assertRefundable(payment: Payment): void {
    if (payment.status === 'APPROVED') return;
    if (payment.status === 'PENDING') {
      // PENDING is refundable only within the processor's window.
      const windowMin = getEnv().PAYMENT_PENDING_REFUND_WINDOW_MINUTES;
      const ageMs = Date.now() - payment.createdAt.getTime();
      if (ageMs <= windowMin * 60_000) return;
      throw new ConflictException(
        `Payment has been PENDING for more than ${windowMin} minutes — refund window expired`,
        'REFUND_NOT_ELIGIBLE',
        { paymentStatus: 'PENDING', ageMinutes: Math.floor(ageMs / 60_000) }
      );
    }
    // REJECTED was never charged — nothing to refund.
    throw new ConflictException(
      'Payment was rejected; no money to refund',
      'REFUND_NOT_ELIGIBLE',
      { paymentStatus: payment.status }
    );
  }
}

let _default: RefundsService | undefined;
export function getRefundsService(): RefundsService {
  if (_default) return _default;
  _default = new RefundsService();
  return _default;
}

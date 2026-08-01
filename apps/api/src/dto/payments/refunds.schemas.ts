import { z } from 'zod';
import {
  AmountSchema,
  CurrencySchema,
  IdSchema,
} from '../../schemas/primitives.js';

/**
 * Refund request/response schemas (PR #16).
 *
 * Refunds are tied 1..N to a Payment. Partial refunds are allowed —
 * `amount` defaults to the full payment amount if omitted, but the
 * service clamps to (payment.amount - sum(existing.refunds.amount))
 * so callers can't over-refund.
 */

export const RefundRejectionReasonSchema = z.enum([
  'INSUFFICIENT_FUNDS',
  'EXPIRED',
  'FRAUD_SUSPECTED',
  'REFUND_WINDOW_EXPIRED',
  'ORIGINAL_NOT_FOUND',
]);

/** POST /api/payments/:id/refund — input. */
export const CreateRefundRequestSchema = z.object({
  amount: AmountSchema.optional(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.uuid().optional(),
});

export type CreateRefundRequest = z.infer<typeof CreateRefundRequestSchema>;

/** Refund as returned to clients. */
export const RefundResponseSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  amount: z.string(), // Prisma Decimal serializes as string
  currency: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reason: RefundRejectionReasonSchema.nullable(),
  processorRef: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.iso.datetime(),
});

export type RefundResponse = z.infer<typeof RefundResponseSchema>;

/** Path param for /api/payments/:id/refund and /api/payments/:id/refunds. */
export const RefundIdParamSchema = z.object({ id: IdSchema });

/**
 * Processor HTTP contract for POST /refund. Same shape convention as
 * ProcessorRequestSchema in payments.schemas.ts.
 */
export const ProcessorRefundRequestSchema = z.object({
  refundId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  amount: z.string(),
  currency: CurrencySchema,
});

export type ProcessorRefundRequest = z.infer<
  typeof ProcessorRefundRequestSchema
>;

export const ProcessorRefundResponseSchema = z.object({
  processorRef: z.string().min(1),
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.enum(['REFUND_WINDOW_EXPIRED', 'ORIGINAL_NOT_FOUND']).nullable(),
});

export type ProcessorRefundResponse = z.infer<
  typeof ProcessorRefundResponseSchema
>;

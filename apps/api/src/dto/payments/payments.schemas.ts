import { z } from 'zod';
import {
  AmountSchema,
  CurrencySchema,
  IdSchema,
  PaginationMetaSchema,
} from '../../schemas/primitives.js';

/**
 * Payment request/response schemas.
 *
 * The processor client schemas (ProcessorRequestSchema/ProcessorResponseSchema)
 * live in this file too because they share the same domain vocabulary
 * (amount, currency, processorRef) — but they validate the HTTP contract
 * with the Python service, NOT the public API contract.
 */

export const PaymentStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type PaymentStatusValue = z.infer<typeof PaymentStatusSchema>;

/** POST /api/payments — input. idempotencyKey auto-generated if absent. */
export const CreatePaymentRequestSchema = z.object({
  cardId: IdSchema,
  amount: AmountSchema,
  currency: CurrencySchema.default('USD'),
  idempotencyKey: z.uuid().optional(),
});

export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const PaymentResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  cardId: z.string(),
  amount: z.string(), // Prisma Decimal serializes as string
  currency: z.string(),
  status: PaymentStatusSchema,
  processorRef: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.iso.datetime(),
});

export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

export const PaymentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: PaymentStatusSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type PaymentQuery = z.infer<typeof PaymentQuerySchema>;

export const PaymentListResponseSchema = z.object({
  data: z.array(PaymentResponseSchema),
  meta: PaginationMetaSchema,
});

/**
 * Processor HTTP contract (POST /process on the Python service).
 * Validated at the client boundary — request before send, response after
 * receive — so a contract drift fails fast instead of corrupting data.
 */
export const ProcessorRequestSchema = z.object({
  paymentId: z.string().min(1).max(64),
  amount: z.string(), // Decimal serialized as string over the wire
  currency: CurrencySchema,
  cardToken: z.string().min(1).max(128),
});

export type ProcessorRequest = z.infer<typeof ProcessorRequestSchema>;

export const ProcessorResponseSchema = z.object({
  processorRef: z.string().min(1),
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z
    .enum(['INSUFFICIENT_FUNDS', 'EXPIRED', 'FRAUD_SUSPECTED'])
    .nullable(),
});

export type ProcessorResponse = z.infer<typeof ProcessorResponseSchema>;

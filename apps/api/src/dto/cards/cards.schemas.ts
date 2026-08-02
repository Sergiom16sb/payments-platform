import { CardBrand } from '@prisma/client';
import { z } from 'zod';

/**
 * Card request/response schemas.
 *
 * Request takes the FULL PAN + CVV (so we can tokenize) — but only the
 * token + last4 ever live in the database or in responses.
 */

const PanSchema = z
  .string()
  .regex(/^\d{13,19}$/, 'PAN must be 13-19 digits with no spaces');

const CvvSchema = z.string().regex(/^\d{3,4}$/, 'CVV must be 3 or 4 digits');

export const CreateCardRequestSchema = z.object({
  pan: PanSchema,
  cvv: CvvSchema,
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2100),
  cardholderName: z.string().min(2).max(100),
});

export type CreateCardRequest = z.infer<typeof CreateCardRequestSchema>;

/** Card as returned to clients — NEVER includes PAN or CVV. */
export const CardResponseSchema = z.object({
  id: z.string(),
  brand: z.nativeEnum(CardBrand),
  last4: z.string().length(4),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int(),
  cardholderName: z.string(),
  token: z.string(),
  createdAt: z.iso.datetime(),
});

export type CardResponse = z.infer<typeof CardResponseSchema>;

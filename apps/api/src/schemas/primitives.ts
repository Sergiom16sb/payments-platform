import { z } from 'zod';

/**
 * Primitive shared schemas used across every feature. Each is the single
 * source of truth for the corresponding shape — same Zod schema validates
 * requests, serializes responses, and types TS code via z.infer.
 */

// Prisma uses cuid() for ids (e.g., "ckl5x..."). Matches "c" + 24 chars.
export const IdSchema = z
  .string()
  .min(20, 'id too short')
  .max(40, 'id too long')
  .regex(/^c[a-z0-9]{20,30}$/, 'invalid id format');

export type Id = z.infer<typeof IdSchema>;

/** RFC 5322-ish email (zod's .email() is permissive enough for our needs). */
export const EmailSchema = z.string().email().max(254).toLowerCase();

/** ISO 4217 currency code — 3 uppercase letters. */
export const CurrencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code');

/** Money amount as a number: positive, 2 decimals, <= 1M. */
export const AmountSchema = z
  .number()
  .positive()
  .multipleOf(0.01)
  .max(1_000_000);

/** ISO 8601 datetime string (e.g. "2026-07-31T12:34:56.789Z"). */
export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

/** Plain object metadata for paginated responses. */
export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Query parameters for list endpoints (offset/limit pagination). */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

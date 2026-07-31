import { z } from 'zod';

/**
 * Standard response envelopes. Every endpoint returns either a success
 * envelope or an error envelope — never a bare value — so clients can
 * reliably check `body.success` first.
 *
 *   success: { success: true,  data: T,            meta?: PaginationMeta }
 *   error:   { success: false, error: { message, code, details?, fields? } }
 *
 * The error envelope shape must mirror what src/plugins/error-handler.ts
 * emits so response validators don't reject what the handler sends.
 */

export const ErrorBodySchema = z.object({
  message: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
  fields: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      })
    )
    .optional(),
  context: z.string().optional(),
});

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: ErrorBodySchema,
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/**
 * Generic success envelope for any payload T.
 * Usage:  SuccessEnvelopeSchema(MyDataSchema)
 *       = { success: true, data: MyDataSchema, meta: PaginationMetaSchema.optional() }
 */
export function successEnvelope<T extends z.ZodTypeAny>(
  dataSchema: T,
  metaSchema: z.ZodTypeAny | null = null
) {
  const shape: Record<string, z.ZodTypeAny> = {
    success: z.literal(true),
    data: dataSchema,
  };
  if (metaSchema) {
    shape.meta = metaSchema.optional();
  }
  return z.object(shape);
}

export type SuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: unknown;
};

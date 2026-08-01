import { z } from 'zod';

/**
 * Env validation schema. Single source of truth for what the API expects
 * to be in process.env. Parsed via getEnv() at server boot (lazily, once),
 * so any missing/invalid variable throws immediately with a ZodError listing
 * every problem — fail-fast instead of a cryptic undefined deeper in the
 * stack.
 *
 * CORS_ORIGINS is a comma-separated string → string[]; empty string is
 * treated as "no origins" (CORS disabled).
 *
 * JWT_SECRET must be at least 32 chars per HS256 spec recommendations.
 * Production deployments must inject a real secret via env.
 */

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection string'
    ),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for HS256'),
  JWT_ISSUER: z.string().default('payments-api'),
  JWT_AUDIENCE: z.string().default('payments-client'),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  PAYMENTS_PROCESSOR_URL: z.string().url(),
  PAYMENTS_PROCESSOR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  PAYMENTS_PROCESSOR_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  // Window in minutes during which a PENDING payment is still refundable
  // (the processor never responded). After this, refunds on PENDING
  // payments are rejected with 409 — the original status must be either
  // APPROVED or PENDING within this window.
  PAYMENT_PENDING_REFUND_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(5),

  CORS_ORIGINS: csv,
});

export type Env = z.infer<typeof envSchema>;
export { envSchema };

let cached: Env | undefined;

/**
 * Test-only: clear the cached env so a new parse reflects changes to
 * process.env. Never call from production code.
 */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}

/**
 * Lazily validates and returns the process env. Called once at server boot
 * (from app.ts and server.ts), then memoized. Keeping it lazy means test
 * files can import schemas and types without triggering a hard exit when
 * env vars are absent.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

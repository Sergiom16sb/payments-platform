import { z } from 'zod';
import { EmailSchema } from '../../schemas/primitives.js';

/**
 * Auth request/response schemas (PLAN §7).
 *
 * Password rule (PLAN §10): min 8 chars, at least one upper, one lower,
 * one digit. Enforced by the strong-password refinement.
 */

const PasswordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(128, 'password too long')
  .refine((v) => /[A-Z]/.test(v), 'password must contain an uppercase letter')
  .refine((v) => /[a-z]/.test(v), 'password must contain a lowercase letter')
  .refine((v) => /\d/.test(v), 'password must contain a digit');

/** POST /api/auth/register */
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  name: z.string().min(2).max(100),
  password: PasswordSchema,
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** POST /api/auth/login */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** POST /api/auth/refresh — body contains the refresh token (also accepted via cookie) */
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** User shape returned to clients (never includes password). */
export const PublicUserSchema = z.object({
  id: z.string(),
  email: EmailSchema,
  name: z.string(),
  role: z.enum(['USER', 'ADMIN']),
  createdAt: z.iso.datetime(),
});

export type PublicUser = z.infer<typeof PublicUserSchema>;

/** Token envelope returned by register/login/refresh. */
export const TokenResponseSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresIn: z.string(),
  refreshTokenExpiresIn: z.string(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

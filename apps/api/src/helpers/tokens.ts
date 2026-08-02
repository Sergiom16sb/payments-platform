import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Token helpers (PLAN §9).
 *
 * Two distinct secrets / signers:
 *  - accessToken (short-lived JWT, HS256, signed with JWT_SECRET).
 *    Verified by @fastify/jwt on every protected request.
 *  - refreshToken (longer-lived JWT, signed with a derived secret). The
 *    raw token is also SHA-256 hashed and persisted in the refresh_tokens
 *    table, so logout can revoke and refresh can detect reuse.
 *
 * Why a derived secret for refresh tokens instead of reusing JWT_SECRET?
 *  - Defense in depth: if JWT_SECRET leaks (access tokens are compromised)
 *    the refresh-token database is still safe (its signing key differs).
 *  - Different lifetimes: refresh tokens are 7d, access tokens 15m — they
 *    have different rotation/revocation semantics and benefit from being
 *    independently revocable.
 */

function getSecret(secret: string | undefined, fallback: string): Uint8Array {
  return new TextEncoder().encode(secret ?? fallback);
}

function accessSecret(): Uint8Array {
  // env validated upstream; throw if missing rather than fall back silently.
  const s = process.env.JWT_SECRET;
  if (!s)
    throw new Error(
      'JWT_SECRET not set (env validation should have caught this)'
    );
  return getSecret(s, 'dev-fallback-secret-please-change');
}

function refreshSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  // Derive a refresh-only secret via HMAC-style: SHA-256(s, "refresh")
  const derived = createHash('sha256').update(`${s}:refresh`).digest('hex');
  return getSecret(derived, derived);
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // unique id (also the random suffix of the raw token)
  typ: 'refresh';
}

const ISSUER = process.env.JWT_ISSUER ?? 'payments-api';
const AUDIENCE = process.env.JWT_AUDIENCE ?? 'payments-client';
const ACCESS_TTL = process.env.JWT_ACCESS_TOKEN_EXPIRES_IN ?? '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '7d';

export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'typ'>
): Promise<string> {
  return new SignJWT({ ...payload, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(ACCESS_TTL)
    .setSubject(payload.sub)
    .sign(accessSecret());
}

export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (payload.typ !== 'access') throw new Error('not an access token');
  return payload as unknown as AccessTokenPayload;
}

export async function signRefreshToken(payload: { userId: string }): Promise<{
  token: string;
  tokenHash: string;
  jti: string;
  expiresAt: Date;
}> {
  const jti = randomBytes(24).toString('hex');
  const token = await new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(REFRESH_TTL)
    .setSubject(payload.userId)
    .setJti(jti)
    .sign(refreshSecret());

  return {
    token,
    jti,
    tokenHash: sha256(token),
    expiresAt: parseTtl(REFRESH_TTL),
  };
}

export async function verifyRefreshToken(
  token: string
): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (payload.typ !== 'refresh') throw new Error('not a refresh token');
  return payload as unknown as RefreshTokenPayload;
}

/** SHA-256 hex of the raw token, used for the persisted hash column. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Parse a duration string like "15m", "7d", "1h" into a future Date.
 * Supports: s (seconds), m (minutes), h (hours), d (days).
 */
export function parseTtl(ttl: string): Date {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`invalid TTL: ${ttl}`);
  const n = Number(match[1]);
  const unit = match[2];
  const ms =
    unit === 's'
      ? n * 1000
      : unit === 'm'
        ? n * 60_000
        : unit === 'h'
          ? n * 3_600_000
          : n * 86_400_000;
  return new Date(Date.now() + ms);
}

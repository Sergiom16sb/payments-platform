import type { User } from '@prisma/client';
import {
  ConflictException,
  UnauthorizedException,
} from '../exceptions/index.js';
import { hashPassword, verifyPassword } from '../helpers/passwords.js';
import {
  type RefreshTokenPayload,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../helpers/tokens.js';
import {
  getRefreshTokensRepository,
  type RefreshTokensRepository,
} from '../repositories/refresh-tokens.repository.js';
import {
  getUsersRepository,
  type UsersRepository,
} from '../repositories/users.repository.js';

/**
 * Auth service. Orchestrates registration, login, refresh, and logout.
 *
 * Rules (PLAN §7, §9):
 *  - Registration: hash password, create user. Email uniqueness is
 *    enforced by the repository (P2002 -> ConflictException).
 *  - Login: lookup by email, verify bcrypt hash. Both wrong-email and
 *    wrong-password map to the same UnauthorizedException so attackers
 *    can't enumerate accounts.
 *  - Refresh: rotate (revoke the old token, issue a new one). Detects
 *    reuse of revoked tokens and rejects them.
 *  - Logout: revoke the refresh token (idempotent — revoking an
 *    already-revoked token is a no-op).
 *
 * Returned shape mirrors TokenResponseSchema so the controller just
 * hands it to the client after wrapping in the success envelope.
 */
export interface AuthSuccess {
  user: User;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository = getUsersRepository(),
    private readonly refreshTokens: RefreshTokensRepository = getRefreshTokensRepository()
  ) {}

  async register(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<AuthSuccess> {
    const password = await hashPassword(input.password);
    // Email was lowercased by RegisterRequestSchema; pass through as-is.
    let user: User;
    try {
      user = await this.users.create({
        email: input.email,
        name: input.name,
        password,
        role: 'USER',
      });
    } catch (err: unknown) {
      if (err instanceof ConflictException) throw err;
      throw err;
    }
    return this.issueTokens(user);
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<AuthSuccess> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      // Don't leak whether the email exists; same error code as bad password.
      throw new UnauthorizedException(
        'Invalid email or password',
        'INVALID_CREDENTIALS'
      );
    }
    const ok = await verifyPassword(input.password, user.password);
    if (!ok) {
      throw new UnauthorizedException(
        'Invalid email or password',
        'INVALID_CREDENTIALS'
      );
    }
    return this.issueTokens(user);
  }

  /**
   * Exchanges a refresh token for a new (access, refresh) pair. Implements
   * token rotation: the old refresh token is revoked, a new one is issued.
   * If the supplied token has been revoked, the request is rejected — this
   * is the "reuse detection" that forces attackers to use a stolen token
   * exactly once before the victim notices.
   */
  async refresh(input: { refreshToken: string }): Promise<AuthSuccess> {
    let payload: RefreshTokenPayload;
    try {
      payload = await verifyRefreshToken(input.refreshToken);
    } catch {
      throw new UnauthorizedException(
        'Invalid refresh token',
        'INVALID_REFRESH'
      );
    }
    const tokenHash = sha256(input.refreshToken);
    const stored = await this.refreshTokens.findByHash(tokenHash);
    if (!stored) {
      throw new UnauthorizedException(
        'Refresh token not recognised',
        'INVALID_REFRESH'
      );
    }
    if (stored.revokedAt) {
      // Reuse of a revoked token — reject.
      throw new UnauthorizedException(
        'Refresh token has been revoked',
        'REVOKED_REFRESH'
      );
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists', 'USER_GONE');
    }
    // Rotate: revoke old, issue new.
    await this.refreshTokens.revoke(stored.id);
    return this.issueTokens(user);
  }

  async logout(input: { refreshToken: string }): Promise<void> {
    const tokenHash = sha256(input.refreshToken);
    const stored = await this.refreshTokens.findByHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await this.refreshTokens.revoke(stored.id);
    }
    // Idempotent: no error if already revoked or unknown.
  }

  /**
   * Internal helper: sign both tokens and persist the refresh-token hash.
   * Throws ConflictException is impossible here because we just read the
   * user, but kept as a safety net in case of a race.
   */
  private async issueTokens(user: User): Promise<AuthSuccess> {
    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      role: (user.role as 'USER' | 'ADMIN') ?? 'USER',
    });
    const refresh = await signRefreshToken({ userId: user.id });
    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });
    return {
      user,
      accessToken,
      refreshToken: refresh.token,
      accessTokenExpiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRES_IN ?? '15m',
      refreshTokenExpiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '7d',
    };
  }
}

let _default: AuthService | undefined;
export function getAuthService(): AuthService {
  if (_default) return _default;
  _default = new AuthService();
  return _default;
}

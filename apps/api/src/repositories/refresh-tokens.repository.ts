import type { PrismaClient, RefreshToken } from '@prisma/client';
import { getPrisma } from '../config/database.js';

/**
 * Refresh tokens repository. Persists refresh-token metadata so logout
 * can revoke and `refresh` can detect reuse of revoked tokens (PLAN §9).
 *
 * Security notes:
 *  - We persist the SHA-256 hash of the raw token, never the raw value.
 *    The raw value lives only in the httpOnly cookie + the JWT signed
 *    body returned to the client.
 *  - revokedAt is set on logout; refresh requests check it and reject
 *    tokens that have been revoked.
 *  - expired rows are pruned by a future periodic job (out of scope here).
 */
export class RefreshTokensRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrisma();
  }

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data: input });
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string): Promise<RefreshToken> {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every active token for a user. Useful for "log out everywhere".
   * Currently unused by routes but kept here for the next PR.
   */
  async revokeAllForUser(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { count: result.count };
  }
}

let _default: RefreshTokensRepository | undefined;
export function getRefreshTokensRepository(): RefreshTokensRepository {
  if (_default) return _default;
  _default = new RefreshTokensRepository();
  return _default;
}

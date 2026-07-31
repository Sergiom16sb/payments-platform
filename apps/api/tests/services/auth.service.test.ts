import type { RefreshToken, User } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictException,
  UnauthorizedException,
} from '@/exceptions/index.js';
import { sha256, verifyRefreshToken } from '@/helpers/tokens.js';
import { RefreshTokensRepository } from '@/repositories/refresh-tokens.repository.js';
import { UsersRepository } from '@/repositories/users.repository.js';
// (clearTestEnv not needed here — every test calls setTestEnv in beforeEach)
import { AuthService } from '@/services/auth.service.js';
import { setTestEnv } from '../setup-env.js';

class FakeUsersRepository extends UsersRepository {
  byEmail: Map<string, User> = new Map();
  nextId = 0;
  // Bypass the Prisma-backed base class entirely.
  constructor() {
    super(undefined as never);
  }
  override async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email) ?? null;
  }
  override async findById(id: string): Promise<User | null> {
    for (const u of this.byEmail.values()) if (u.id === id) return u;
    return null;
  }
  override async create(input: {
    email: string;
    name: string;
    password: string;
    role?: 'USER' | 'ADMIN';
  }): Promise<User> {
    if (this.byEmail.has(input.email)) {
      throw new ConflictException(
        'Email is already registered',
        'EMAIL_TAKEN',
        {
          email: input.email,
        }
      );
    }
    this.nextId += 1;
    const user: User = {
      id: `usr-${this.nextId}`,
      email: input.email,
      name: input.name,
      password: input.password, // already hashed by service in real life
      role: input.role ?? 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.byEmail.set(input.email, user);
    return user;
  }
}

class FakeRefreshTokensRepository extends RefreshTokensRepository {
  byHash: Map<string, RefreshToken> = new Map();
  nextId = 0;
  constructor() {
    super(undefined as never);
  }
  override async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    this.nextId += 1;
    const row: RefreshToken = {
      id: `rt-${this.nextId}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.byHash.set(input.tokenHash, row);
    return row;
  }
  override async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.byHash.get(tokenHash) ?? null;
  }
  override async revoke(id: string): Promise<RefreshToken> {
    const row = [...this.byHash.values()].find((r) => r.id === id);
    if (!row) throw new Error('not found');
    const updated = { ...row, revokedAt: new Date() };
    this.byHash.set(row.tokenHash, updated);
    return updated;
  }
}

function makeService(): {
  service: AuthService;
  users: FakeUsersRepository;
  refresh: FakeRefreshTokensRepository;
} {
  const users = new FakeUsersRepository();
  const refresh = new FakeRefreshTokensRepository();
  const service = new AuthService(users, refresh);
  return { service, users, refresh };
}

describe('AuthService', () => {
  beforeEach(() => {
    setTestEnv();
  });

  describe('register', () => {
    it('creates a user and returns a token pair', async () => {
      const { service } = makeService();
      const result = await service.register({
        email: 'a@b.com',
        name: 'Alice',
        password: 'Secret123',
      });
      expect(result.user.email).toBe('a@b.com');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it('rejects a duplicate email with ConflictException', async () => {
      const { service } = makeService();
      await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      await expect(
        service.register({ email: 'a@b.com', name: 'A', password: 'Secret123' })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('returns tokens when password matches', async () => {
      const { service } = makeService();
      await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      const result = await service.login({
        email: 'a@b.com',
        password: 'Secret123',
      });
      expect(result.accessToken).toBeTruthy();
    });

    it('rejects wrong password with INVALID_CREDENTIALS', async () => {
      const { service } = makeService();
      await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'WrongPass1' })
      ).rejects.toThrow(/Invalid email or password/);
    });

    it('rejects unknown email with the same message (no enumeration)', async () => {
      const { service } = makeService();
      await expect(
        service.login({ email: 'nobody@x.com', password: 'Anything1' })
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token (old revoked, new issued)', async () => {
      const { service, refresh } = makeService();
      const reg = await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      const out = await service.refresh({ refreshToken: reg.refreshToken });
      expect(out.refreshToken).not.toBe(reg.refreshToken);

      // The old token row should now be revoked.
      const oldPayload = await verifyRefreshToken(reg.refreshToken);
      const oldHash = sha256(reg.refreshToken);
      const oldRow = await refresh.findByHash(oldHash);
      expect(oldRow?.revokedAt).toBeTruthy();
      expect(oldRow?.userId).toBe(oldPayload.sub);
    });

    it('rejects a revoked refresh token (reuse detection)', async () => {
      const { service } = makeService();
      const reg = await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      await service.refresh({ refreshToken: reg.refreshToken }); // first use rotates
      await expect(
        service.refresh({ refreshToken: reg.refreshToken }) // second use must fail
      ).rejects.toThrow(/revoked/);
    });

    it('rejects a tampered refresh token', async () => {
      const { service } = makeService();
      await expect(
        service.refresh({ refreshToken: 'not.a.real.jwt' })
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      const { service, refresh } = makeService();
      const reg = await service.register({
        email: 'a@b.com',
        name: 'A',
        password: 'Secret123',
      });
      await service.logout({ refreshToken: reg.refreshToken });
      const { sha256 } = await import('@/helpers/tokens.js');
      const row = await refresh.findByHash(sha256(reg.refreshToken));
      expect(row?.revokedAt).toBeTruthy();
    });

    it('is idempotent (no error on unknown or already-revoked token)', async () => {
      const { service } = makeService();
      await expect(
        service.logout({ refreshToken: 'not.a.real.jwt' })
      ).resolves.toBeUndefined();
    });
  });
});

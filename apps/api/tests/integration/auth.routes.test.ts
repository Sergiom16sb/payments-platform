import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app.js';
import { clearTestEnv, setTestEnv } from '../setup-env.js';

/**
 * End-to-end auth integration tests via app.inject(). Uses the real
 * postgres container (the one from docker-compose) — these tests connect
 * to the live DB and clean up the users table between cases.
 *
 * Skip gracefully if DATABASE_URL points to an unreachable host (so the
 * test suite still passes on CI boxes without docker).
 */

let db: PrismaClient | undefined;

function getDb(): PrismaClient {
  if (!db) db = new PrismaClient();
  return db;
}

async function safeDb(): Promise<PrismaClient | null> {
  try {
    const c = getDb();
    await c.$queryRaw`SELECT 1`;
    return c;
  } catch {
    return null;
  }
}

const uniqueEmail = () =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

beforeEach(() => {
  setTestEnv();
});

afterEach(async () => {
  const c = await safeDb();
  if (c) {
    // Clean up test users so re-runs don't accumulate.
    await c.user.deleteMany({
      where: { email: { startsWith: 'test-' } },
    });
  }
  await c?.$disconnect();
  clearTestEnv();
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token pair', async () => {
    if (!(await safeDb())) return; // skip if no DB
    const app = await buildApp({ logger: false });
    await app.ready();

    const email = uniqueEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'Alice', password: 'Secret123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.email).toBe(email);

    await app.close();
  });

  it('rejects a duplicate email with 409', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'Alice', password: 'Secret123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'Alice2', password: 'Secret456' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');

    await app.close();
  });

  it('rejects a weak password with 400 (Zod validation)', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: uniqueEmail(), name: 'A', password: 'weak' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

describe('POST /api/auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'A', password: 'Secret123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'Secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();

    await app.close();
  });

  it('returns 401 for wrong password', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'A', password: 'Secret123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'WrongPass1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');

    await app.close();
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const email = uniqueEmail();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'A', password: 'Secret123' },
    });
    const oldRefresh = reg.json().refreshToken;

    const ref = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(ref.statusCode).toBe(200);
    expect(ref.json().refreshToken).not.toBe(oldRefresh);

    // Reuse of the old (now revoked) refresh token must fail.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(reuse.statusCode).toBe(401);

    await app.close();
  });

  it('reads the refresh token from the httpOnly cookie', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: uniqueEmail(), name: 'A', password: 'Secret123' },
    });
    const setCookie = reg.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie[0]
      : (setCookie as string | undefined);
    expect(cookieHeader).toContain('refresh_token=');

    const ref = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: cookieHeader ?? '' },
      payload: {},
    });
    expect(ref.statusCode).toBe(200);

    await app.close();
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204 and revokes the refresh token', async () => {
    if (!(await safeDb())) return;
    const app = await buildApp({ logger: false });
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: uniqueEmail(), name: 'A', password: 'Secret123' },
    });
    const refreshToken = reg.json().refreshToken;

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const ref = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(ref.statusCode).toBe(401);

    await app.close();
  });
});

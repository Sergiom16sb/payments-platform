import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '@/app.js';
import { clearTestEnv, setTestEnv } from '../setup-env.js';

let db: PrismaClient | undefined;
async function safeDb() {
  try {
    db ??= new PrismaClient();
    await db.$queryRaw`SELECT 1`;
    return db;
  } catch {
    return null;
  }
}

beforeEach(() => setTestEnv());
afterEach(async () => {
  const c = await safeDb();
  if (c) {
    await c.card.deleteMany({
      where: { cardholderName: { startsWith: 'admin-' } },
    });
    await c.user.deleteMany({ where: { email: { startsWith: 'admin-' } } });
  }
  await db?.$disconnect();
  db = undefined;
  clearTestEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function registerUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  role: 'USER' | 'ADMIN' = 'USER'
) {
  // Use the same register endpoint. role is taken from the seed-like
  // creation — but our default registration always sets role=USER.
  // We adjust by hitting Prisma directly for the ADMIN case.
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'Admin', password: 'Secret123' },
  });
  const token = reg.json().accessToken as string;
  const userId = reg.json().user.id as string;

  if (role === 'ADMIN') {
    const c = await safeDb();
    if (c) {
      await c.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    }
  }
  return { token, userId };
}

describe('POST /api/admin/cards/:id/restore', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();
    // Use a cuid-shaped id so the params validation passes and authenticate
    // (the preHandler) gets to run and return 401.
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cards/cmsaaaaaaaaaaaaaaaaaaaaaa/restore',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 403 with a USER-role token (insufficient role)', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token } = await registerUser(
      app,
      `admin-no-${Date.now()}@example.com`,
      'USER'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cards/cmsaaaaaaaaaaaaaaaaaaaaaa/restore',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSUFFICIENT_ROLE');
    await app.close();
  });

  it('returns 404 for an unknown card id (admin role ok)', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token } = await registerUser(
      app,
      `admin-404-${Date.now()}@example.com`,
      'ADMIN'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cards/cms_does_not_exist_aaaa/restore',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 for an invalid (non-cuid) id', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token } = await registerUser(
      app,
      `admin-400-${Date.now()}@example.com`,
      'ADMIN'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cards/not-a-cuid/restore',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});

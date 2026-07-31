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
    await c.payment.deleteMany({
      where: { user: { email: { startsWith: 'pay-' } } },
    });
    await c.card.deleteMany({
      where: { user: { email: { startsWith: 'pay-' } } },
    });
    await c.user.deleteMany({ where: { email: { startsWith: 'pay-' } } });
  }
  await db?.$disconnect();
  db = undefined;
  clearTestEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function registerAndCard(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'Payer', password: 'Secret123' },
  });
  const token = reg.json().accessToken as string;

  const cardRes = await app.inject({
    method: 'POST',
    url: '/api/cards',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'Payer Visa',
    },
  });
  const card = cardRes.json();
  const userId = reg.json().user.id as string;
  return { token, cardId: card.id as string, userId };
}

function mockProcessor(result: {
  processorRef: string;
  status: 'APPROVED' | 'REJECTED';
  reason: string | null;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  );
}

describe('POST /api/payments', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: { cardId: 'cms93f0xb0000wofz8qlw3egv', amount: 10 },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates an APPROVED payment end-to-end', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({ processorRef: 'proc-1', status: 'APPROVED', reason: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, cardId } = await registerAndCard(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 49.99 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('APPROVED');
    expect(body.processorRef).toBe('proc-1');
    await app.close();
  });

  it('returns 402 when the processor rejects', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({
      processorRef: 'proc-2',
      status: 'REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    });

    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, cardId } = await registerAndCard(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 10 },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('PAYMENT_REJECTED');
    await app.close();
  });

  it('returns the same payment on a repeated idempotencyKey', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({ processorRef: 'proc-3', status: 'APPROVED', reason: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, cardId } = await registerAndCard(app);
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';

    const first = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 15, idempotencyKey },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 15, idempotencyKey },
    });

    expect(first.json().id).toBe(second.json().id);
    await app.close();
  });

  it('rejects a card that belongs to another user with 403', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({ processorRef: 'proc-4', status: 'APPROVED', reason: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    const owner = await registerAndCard(app);
    const other = await registerAndCard(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${other.token}` },
      payload: { cardId: owner.cardId, amount: 5 },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /api/payments/:id', () => {
  it('returns 403 for a payment owned by another user', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({ processorRef: 'proc-5', status: 'APPROVED', reason: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    const owner = await registerAndCard(app);
    const other = await registerAndCard(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { cardId: owner.cardId, amount: 20 },
    });
    const paymentId = created.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/payments/${paymentId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /api/users/:id/payments', () => {
  it('returns paginated history for the authenticated user', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    mockProcessor({ processorRef: 'proc-6', status: 'APPROVED', reason: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, cardId, userId } = await registerAndCard(app);

    await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 1 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { authorization: `Bearer ${token}` },
      payload: { cardId, amount: 2 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/payments`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
    await app.close();
  });

  it("returns 403 when requesting someone else's history", async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const me = await registerAndCard(app);
    const other = await registerAndCard(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${other.userId}/payments`,
      headers: { authorization: `Bearer ${me.token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

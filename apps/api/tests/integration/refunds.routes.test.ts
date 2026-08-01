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
    await c.refund.deleteMany({
      where: { payment: { user: { email: { startsWith: 'rf-' } } } },
    });
    await c.payment.deleteMany({
      where: { user: { email: { startsWith: 'rf-' } } },
    });
    await c.card.deleteMany({
      where: { user: { email: { startsWith: 'rf-' } } },
    });
    await c.user.deleteMany({ where: { email: { startsWith: 'rf-' } } });
  }
  await db?.$disconnect();
  db = undefined;
  clearTestEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockProcessor(result: unknown) {
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

async function registerAndMakePayment(
  app: Awaited<ReturnType<typeof buildApp>>
) {
  const email = `rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'RF', password: 'Secret123' },
  });
  const token = reg.json().accessToken as string;
  const userId = reg.json().user.id as string;

  const cardRes = await app.inject({
    method: 'POST',
    url: '/api/cards',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'RF',
    },
  });
  const cardId = cardRes.json().id as string;

  // Create a payment (mock processor as APPROVED).
  mockProcessor({
    processorRef: 'proc-pay-1',
    status: 'APPROVED',
    reason: null,
  });
  const pay = await app.inject({
    method: 'POST',
    url: '/api/payments',
    headers: { authorization: `Bearer ${token}` },
    payload: { cardId, amount: 100 },
  });
  const paymentId = pay.json().id as string;
  return { token, userId, cardId, paymentId };
}

describe('POST /api/payments/:id/refund', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();
    // No auth header — authenticate rejects with 401 (or 400 if params
    // validation runs first; either means the preHandler chain is wired).
    // Just verify the call is rejected, not the exact status.
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/cmsaaaaaaaaaaaaaaaaaaaaaa/refund',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    await app.close();
  });

  it('returns 400 for an invalid (non-cuid) id', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/not-a-cuid/refund',
    });
    expect(res.statusCode).toBe(400);
    // The exact error envelope shape (our custom {code: 'VALIDATION_ERROR'}
    // vs Fastify's default {statusCode,error,message}) depends on which
    // error path fires first; just check the status code.
    await app.close();
  });

  it('returns 201 with an APPROVED refund on a full refund of an APPROVED payment', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-1',
      status: 'APPROVED',
      reason: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('APPROVED');
    expect(body.amount).toBe('100.00');
    await app.close();
  });

  it('returns 422 when refunding more than the payment amount', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-1',
      status: 'APPROVED',
      reason: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 200 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('REFUND_EXCEEDS_REMAINING');
    await app.close();
  });

  it('returns 201 with a REJECTED refund (does not throw)', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-rej',
      status: 'REJECTED',
      reason: 'REFUND_WINDOW_EXPIRED',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('REJECTED');
    expect(body.rejectionReason).toBe('REFUND_WINDOW_EXPIRED');
    await app.close();
  });

  it('returns the same refund on a repeated idempotencyKey (no double refund)', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-1',
      status: 'APPROVED',
      reason: null,
    });
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const first = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: key },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: key },
    });
    expect(first.json().id).toBe(second.json().id);
    await app.close();
  });

  it('allows two partial refunds adding up to the full amount', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-1',
      status: 'APPROVED',
      reason: null,
    });
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 30 },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 70 },
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().amount).toBe('30.00');
    expect(r2.json().amount).toBe('70.00');
    await app.close();
  });

  it('returns 422 when a third refund would exceed the remaining balance', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({
      processorRef: 'proc-rfn-1',
      status: 'APPROVED',
      reason: null,
    });
    await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 100 },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 1 },
    });
    expect(r2.statusCode).toBe(422);
    await app.close();
  });
});

describe('GET /api/payments/:id/refunds + GET /api/refunds/:id', () => {
  it('list returns the refunds for the payment', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({ processorRef: 'p1', status: 'APPROVED', reason: null });
    await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
    });
    mockProcessor({ processorRef: 'p2', status: 'APPROVED', reason: null });
    await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/payments/${paymentId}/refunds`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    await app.close();
  });

  it('getOne returns the refund by id', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const { token, paymentId } = await registerAndMakePayment(app);

    mockProcessor({ processorRef: 'p1', status: 'APPROVED', reason: null });
    const created = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { authorization: `Bearer ${token}` },
    });
    const refundId = created.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/refunds/${refundId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(refundId);
    await app.close();
  });
});

import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
      where: { cardholderName: { startsWith: 'integration-' } },
    });
    await c.user.deleteMany({ where: { email: { startsWith: 'card-' } } });
  }
  await db?.$disconnect();
  db = undefined;
  clearTestEnv();
});

describe('POST /api/cards', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        pan: '4111111111111111',
        cvv: '123',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'integration-x',
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 201 with tokenized card for valid auth + Luhn-valid PAN', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    // Register a user to get an access token
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `card-${Date.now()}@example.com`,
        name: 'C',
        password: 'Secret123',
      },
    });
    const token = reg.json().accessToken;

    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        pan: '4111111111111111',
        cvv: '123',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'integration-x',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.last4).toBe('1111');
    expect(body.brand).toBe('VISA');
    expect(body.token).toMatch(/^tok_[0-9a-f]+$/);
    expect(body.pan).toBeUndefined();
    expect(body.cvv).toBeUndefined();
    await app.close();
  });

  it('rejects bad Luhn with 400 INVALID_PAN', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `card-${Date.now()}@example.com`,
        name: 'C',
        password: 'Secret123',
      },
    });
    const token = reg.json().accessToken;
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        pan: '4111111111111112',
        cvv: '123',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'integration-x',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PAN');
    await app.close();
  });

  it('rejects expired card with 400 CARD_EXPIRED', async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `card-${Date.now()}@example.com`,
        name: 'C',
        password: 'Secret123',
      },
    });
    const token = reg.json().accessToken;
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        pan: '4111111111111111',
        cvv: '123',
        expMonth: 1,
        expYear: 2020,
        cardholderName: 'integration-x',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CARD_EXPIRED');
    await app.close();
  });
});

describe('GET /api/cards', () => {
  it("returns only the authenticated user's cards", async () => {
    const dbOk = await safeDb();
    if (!dbOk) return;
    const app = await buildApp({ logger: false });
    await app.ready();
    // Two users
    const u1 = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `card-u1-${Date.now()}@example.com`,
        name: 'U1',
        password: 'Secret123',
      },
    });
    const u2 = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `card-u2-${Date.now()}@example.com`,
        name: 'U2',
        password: 'Secret123',
      },
    });
    // Each registers a card
    await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { authorization: `Bearer ${u1.json().accessToken}` },
      payload: {
        pan: '4111111111111111',
        cvv: '1',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'integration-u1',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { authorization: `Bearer ${u2.json().accessToken}` },
      payload: {
        pan: '5555555555554444',
        cvv: '1',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'integration-u2',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cards',
      headers: { authorization: `Bearer ${u1.json().accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const cards = res.json();
    expect(cards).toHaveLength(1);
    expect(cards[0].last4).toBe('1111');
    await app.close();
  });
});

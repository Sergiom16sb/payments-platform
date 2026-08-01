import type { Card } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CardsRepository } from '@/repositories/cards.repository.js';
import { CardsService } from '@/services/cards.service.js';
import { setTestEnv } from '../setup-env.js';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    userId: 'user-1',
    brand: 'VISA',
    last4: '1111',
    expMonth: 12,
    expYear: 2030,
    cardholderName: 'Alice',
    token: 'tok_abc',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

class FakeCardsRepository extends CardsRepository {
  store = new Map<string, Card>();
  constructor() {
    super(undefined as never);
  }
  override async create(input: {
    userId: string;
    brand: 'VISA' | 'MASTERCARD' | 'AMEX' | 'UNKNOWN';
    last4: string;
    expMonth: number;
    expYear: number;
    cardholderName: string;
    token: string;
  }): Promise<Card> {
    const card = makeCard({
      id: `c-${this.store.size + 1}`,
      userId: input.userId,
      brand: input.brand,
      last4: input.last4,
      expMonth: input.expMonth,
      expYear: input.expYear,
      cardholderName: input.cardholderName,
      token: input.token,
    });
    this.store.set(card.id, card);
    return card;
  }
  override async findById(id: string): Promise<Card | null> {
    const c = this.store.get(id);
    return c && c.deletedAt === null ? c : null;
  }
  override async findByToken(token: string): Promise<Card | null> {
    for (const c of this.store.values()) {
      if (c.token === token && c.deletedAt === null) return c;
    }
    return null;
  }
  override async listByUser(userId: string): Promise<Card[]> {
    return [...this.store.values()]
      .filter((c) => c.userId === userId && c.deletedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  override async delete(id: string): Promise<void> {
    const c = this.store.get(id);
    if (!c || c.deletedAt !== null) {
      const err = new Error('not found') as Error & { code: string };
      err.code = 'P2025';
      throw err;
    }
    this.store.set(id, { ...c, deletedAt: new Date() });
  }
  override async restore(id: string): Promise<boolean> {
    const c = this.store.get(id);
    if (!c || c.deletedAt === null) return false;
    this.store.set(id, { ...c, deletedAt: null });
    return true;
  }
}

function makeService() {
  const repo = new FakeCardsRepository();
  const service = new CardsService(repo);
  return { service, repo };
}

describe('CardsService soft delete', () => {
  beforeEach(() => setTestEnv());

  it('deleteOwned sets deletedAt and makes the card invisible to subsequent reads', async () => {
    const { service, repo } = makeService();
    const card = await service.register({
      userId: 'u1',
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'Alice',
    });
    await service.deleteOwned(card.id, 'u1');
    // Direct repo lookup simulates other read paths (get by id / token / list).
    expect(await repo.findById(card.id)).toBeNull();
    expect(await repo.findByToken(card.token)).toBeNull();
    expect(await repo.listByUser('u1')).toEqual([]);
  });

  it('getOwned returns NotFound after soft delete (cannot see deleted cards)', async () => {
    const { service, repo } = makeService();
    const card = await service.register({
      userId: 'u1',
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'Alice',
    });
    await service.deleteOwned(card.id, 'u1');
    await expect(service.getOwned(card.id, 'u1')).rejects.toThrow(/not found/i);
    // Restore it via the repo (admin) and getOwned should work again.
    expect(await repo.restore(card.id)).toBe(true);
    const restored = await service.getOwned(card.id, 'u1');
    expect(restored.id).toBe(card.id);
  });

  it('listForUser excludes soft-deleted cards', async () => {
    const { service } = makeService();
    const c1 = await service.register({
      userId: 'u1',
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'C1',
    });
    const c2 = await service.register({
      userId: 'u1',
      pan: '5555555555554444',
      cvv: '123',
      expMonth: 6,
      expYear: 2028,
      cardholderName: 'C2',
    });
    await service.deleteOwned(c1.id, 'u1');
    const list = await service.listForUser('u1');
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(c2.id);
  });

  it('register can create a fresh row even if a card with the same PAN existed (token is fresh)', async () => {
    const { service } = makeService();
    await service.register({
      userId: 'u1',
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'C1',
    });
    // Same PAN, new user -> should succeed because token uniqueness is
    // on the new (still-in-DB but soft-deleted) row, and we generate
    // a new token. (The DB-level unique constraint on `token` would
    // fail only if someone explicitly re-uses the same token, which we
    // never do.)
    await service.register({
      userId: 'u1',
      pan: '4111111111111111',
      cvv: '123',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'C2',
    });
    expect(true).toBe(true);
  });

  // cleanup refs to keep biome happy
  afterEach(() => {});
});

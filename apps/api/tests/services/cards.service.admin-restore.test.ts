import type { Card } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@/exceptions/index.js';
import { CardsRepository } from '@/repositories/cards.repository.js';
import { CardsService } from '@/services/cards.service.js';
import { setTestEnv } from '../setup-env.js';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    userId: 'u1',
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
  override async findById(id: string): Promise<Card | null> {
    const c = this.store.get(id);
    return c && c.deletedAt === null ? c : null;
  }
  override async findByIdIncludingDeleted(id: string): Promise<Card | null> {
    return this.store.get(id) ?? null;
  }
  override async restore(id: string): Promise<boolean> {
    const c = this.store.get(id);
    if (!c || c.deletedAt === null) return false;
    this.store.set(id, { ...c, deletedAt: null });
    return true;
  }
}

describe('CardsService.adminRestore', () => {
  beforeEach(() => setTestEnv());

  it('restores a soft-deleted card so it becomes visible again', async () => {
    const repo = new FakeCardsRepository();
    repo.store.set('c1', makeCard({ id: 'c1', deletedAt: new Date() }));
    const service = new CardsService(repo);

    // Sanity: deleted card is invisible via the public read path.
    expect(await repo.findById('c1')).toBeNull();

    const restored = await service.adminRestore('c1');
    expect(restored.id).toBe('c1');
    expect(restored.deletedAt).toBeNull();
    expect(await repo.findById('c1')).not.toBeNull();
  });

  it('is idempotent: restoring an already-active card returns it as-is', async () => {
    const repo = new FakeCardsRepository();
    repo.store.set('c1', makeCard({ id: 'c1' })); // already active
    const service = new CardsService(repo);

    const result = await service.adminRestore('c1');
    expect(result.id).toBe('c1');
    expect(result.deletedAt).toBeNull();
  });

  it('throws NotFoundException for an unknown id', async () => {
    const repo = new FakeCardsRepository();
    const service = new CardsService(repo);
    await expect(service.adminRestore('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('does not check ownership (admin operation, not user-scoped)', async () => {
    const repo = new FakeCardsRepository();
    // The card belongs to user 'A'; admin restoring it should not require
    // them to be the same user.
    repo.store.set(
      'c1',
      makeCard({ id: 'c1', userId: 'A', deletedAt: new Date() })
    );
    const service = new CardsService(repo);

    const result = await service.adminRestore('c1');
    expect(result.userId).toBe('A');
  });

  // cleanup refs to keep biome happy
  afterEach(() => {});
});

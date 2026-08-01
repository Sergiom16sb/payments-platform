import type { Card, Payment } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ForbiddenException,
  PaymentRequiredException,
} from '@/exceptions/index.js';
import {
  type ListFilters,
  PaymentsRepository,
} from '@/repositories/payments.repository.js';
import { CardsService } from '@/services/cards.service.js';
import { PaymentsService } from '@/services/payments.service.js';
import { PaymentsProcessorClient } from '@/services/payments-processor.client.js';
import { setTestEnv } from '../setup-env.js';

const OWNER_ID = 'user-1';
const OTHER_ID = 'user-2';
const CARD_ID = 'card-1';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: CARD_ID,
    userId: OWNER_ID,
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

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    userId: OWNER_ID,
    cardId: CARD_ID,
    amount: '49.99' as unknown as Payment['amount'],
    currency: 'USD',
    status: 'PENDING',
    processorRef: null,
    rejectionReason: null,
    idempotencyKey: 'idem-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakePaymentsRepository extends PaymentsRepository {
  byKey = new Map<string, Payment>();
  byId = new Map<string, Payment>();
  nextId = 0;
  constructor() {
    super(undefined as never);
  }
  override async findByIdempotencyKey(key: string): Promise<Payment | null> {
    return this.byKey.get(key) ?? null;
  }
  override async findById(id: string): Promise<Payment | null> {
    return this.byId.get(id) ?? null;
  }
  override async create(input: {
    userId: string;
    cardId: string;
    amount: number | string;
    currency: string;
    idempotencyKey: string;
  }): Promise<Payment> {
    this.nextId += 1;
    const p = makePayment({
      id: `pay-${this.nextId}`,
      userId: input.userId,
      cardId: input.cardId,
      idempotencyKey: input.idempotencyKey,
    });
    this.byKey.set(input.idempotencyKey, p);
    this.byId.set(p.id, p);
    return p;
  }
  override async markResolved(
    id: string,
    result: {
      status: 'APPROVED' | 'REJECTED';
      processorRef: string | null;
      rejectionReason: string | null;
    }
  ): Promise<Payment> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...result };
    this.byId.set(id, updated);
    this.byKey.set(existing.idempotencyKey, updated);
    return updated;
  }
  override async getOrThrow(id: string): Promise<Payment> {
    const p = this.byId.get(id);
    if (!p) throw new Error('not found');
    return p;
  }
  override async listForUser(
    userId: string,
    _filters: ListFilters
  ): Promise<{ data: Payment[]; total: number }> {
    const data = [...this.byId.values()].filter((p) => p.userId === userId);
    return { data, total: data.length };
  }
}

class FakeCardsService extends CardsService {
  card: Card;
  constructor(card: Card) {
    super(undefined as never);
    this.card = card;
  }
  override async getOwned(id: string, userId: string): Promise<Card> {
    if (this.card.id !== id) throw new Error('unknown card in test fixture');
    if (this.card.userId !== userId) {
      throw new ForbiddenException(
        'You do not own this card',
        'NOT_CARD_OWNER'
      );
    }
    return this.card;
  }
}

type ProcessorResult = {
  processorRef: string;
  status: 'APPROVED' | 'REJECTED';
  reason: 'INSUFFICIENT_FUNDS' | 'EXPIRED' | 'FRAUD_SUSPECTED' | null;
};

class FakeProcessorClient extends PaymentsProcessorClient {
  nextResult: ProcessorResult = {
    processorRef: 'proc-1',
    status: 'APPROVED',
    reason: null,
  };
  calls: unknown[] = [];
  constructor() {
    super({ baseUrl: 'http://unused' });
  }
  override async process(
    input: Parameters<PaymentsProcessorClient['process']>[0]
  ): ReturnType<PaymentsProcessorClient['process']> {
    this.calls.push(input);
    return this.nextResult;
  }
}

function makeService() {
  const paymentsRepo = new FakePaymentsRepository();
  const card = makeCard();
  const cardsService = new FakeCardsService(card);
  const processor = new FakeProcessorClient();
  const service = new PaymentsService(paymentsRepo, cardsService, processor);
  return { service, paymentsRepo, cardsService, processor, card };
}

describe('PaymentsService', () => {
  beforeEach(() => setTestEnv());

  it('creates a payment and calls the processor with the card token (not PAN)', async () => {
    const { service, processor } = makeService();
    const payment = await service.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 49.99,
      currency: 'USD',
    });
    expect(payment.status).toBe('APPROVED');
    expect(processor.calls).toHaveLength(1);
    expect((processor.calls[0] as { cardToken: string }).cardToken).toBe(
      'tok_abc'
    );
  });

  it('auto-generates an idempotencyKey when none is provided', async () => {
    const { service } = makeService();
    const payment = await service.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 10,
      currency: 'USD',
    });
    expect(payment.idempotencyKey).toBeTruthy();
  });

  it('returns the same payment on a repeated idempotencyKey (no re-charge)', async () => {
    const { service, processor } = makeService();
    const key = 'fixed-key-1';
    const first = await service.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 10,
      currency: 'USD',
      idempotencyKey: key,
    });
    const second = await service.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 10,
      currency: 'USD',
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);
    expect(processor.calls).toHaveLength(1); // processor NOT called twice
  });

  it('throws PaymentRequiredException (402) when processor rejects', async () => {
    const { service, processor } = makeService();
    processor.nextResult = {
      processorRef: 'proc-2',
      status: 'REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    };
    await expect(
      service.create({
        userId: OWNER_ID,
        cardId: CARD_ID,
        amount: 10,
        currency: 'USD',
      })
    ).rejects.toBeInstanceOf(PaymentRequiredException);
  });

  it('throws ForbiddenException when the card belongs to another user', async () => {
    const { service, card } = makeService();
    card.userId = OTHER_ID;
    await expect(
      service.create({
        userId: OWNER_ID,
        cardId: CARD_ID,
        amount: 10,
        currency: 'USD',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getOwned throws ForbiddenException for a non-owner', async () => {
    const { service, paymentsRepo } = makeService();
    const payment = await paymentsRepo.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 10,
      currency: 'USD',
      idempotencyKey: 'k1',
    });
    await expect(service.getOwned(payment.id, OTHER_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("listForUser returns only that user's payments", async () => {
    const { service, paymentsRepo } = makeService();
    await paymentsRepo.create({
      userId: OWNER_ID,
      cardId: CARD_ID,
      amount: 1,
      currency: 'USD',
      idempotencyKey: 'a',
    });
    await paymentsRepo.create({
      userId: OTHER_ID,
      cardId: CARD_ID,
      amount: 2,
      currency: 'USD',
      idempotencyKey: 'b',
    });
    const { data } = await service.listForUser(OWNER_ID, {
      page: 1,
      pageSize: 20,
    });
    expect(data).toHaveLength(1);
    expect(data[0]?.userId).toBe(OWNER_ID);
  });
});

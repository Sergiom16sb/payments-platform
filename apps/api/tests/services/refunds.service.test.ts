import { type Payment, Prisma, type Refund } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@/exceptions/index.js';
import { RefundsRepository } from '@/repositories/refunds.repository.js';
import { PaymentsService } from '@/services/payments.service.js';
import { PaymentsProcessorClient } from '@/services/payments-processor.client.js';
import { RefundsService } from '@/services/refunds.service.js';
import { setTestEnv } from '../setup-env.js';

const OWNER_ID = 'user-1';
const OTHER_ID = 'user-2';
const PAYMENT_ID = 'pay-1';
const CARD_ID = 'card-1';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT_ID,
    userId: OWNER_ID,
    cardId: CARD_ID,
    amount: '100.00' as unknown as Payment['amount'],
    currency: 'USD',
    status: 'APPROVED',
    processorRef: 'proc-1',
    rejectionReason: null,
    idempotencyKey: 'idem-pay-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRefund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 'rfn-1',
    paymentId: PAYMENT_ID,
    amount: '10.00' as unknown as Refund['amount'],
    currency: 'USD',
    status: 'APPROVED',
    reason: null,
    processorRef: 'proc-rfn-1',
    rejectionReason: null,
    idempotencyKey: 'idem-rfn-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeRefundsRepository extends RefundsRepository {
  byKey = new Map<string, Refund>();
  byId = new Map<string, Refund>();
  nextId = 0;
  constructor() {
    super(undefined as never);
  }
  override async findByIdempotencyKey(key: string): Promise<Refund | null> {
    return this.byKey.get(key) ?? null;
  }
  override async findById(id: string): Promise<Refund | null> {
    return this.byId.get(id) ?? null;
  }
  override async create(input: {
    paymentId: string;
    amount: Prisma.Decimal | string | number;
    currency: string;
    reason?: string;
    idempotencyKey: string;
  }): Promise<Refund> {
    this.nextId += 1;
    const r = makeRefund({
      id: `rfn-${this.nextId}`,
      paymentId: input.paymentId,
      amount: input.amount as unknown as Refund['amount'],
      currency: input.currency,
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
      processorRef: null,
    });
    this.byKey.set(input.idempotencyKey, r);
    this.byId.set(r.id, r);
    return r;
  }
  override async markResolved(
    id: string,
    result: {
      status: 'APPROVED' | 'REJECTED';
      processorRef: string | null;
      rejectionReason: string | null;
    }
  ): Promise<Refund> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error('not found');
    const updated: Refund = { ...existing, ...result };
    this.byId.set(id, updated);
    this.byKey.set(existing.idempotencyKey, updated);
    return updated;
  }
  override async listByPayment(paymentId: string): Promise<Refund[]> {
    return [...this.byId.values()].filter((r) => r.paymentId === paymentId);
  }
  override async sumActiveForPayment(
    paymentId: string
  ): Promise<Prisma.Decimal> {
    return [...this.byId.values()]
      .filter(
        (r) =>
          r.paymentId === paymentId &&
          (r.status === 'PENDING' || r.status === 'APPROVED')
      )
      .reduce(
        (acc, r) => acc.plus(new Prisma.Decimal(r.amount as unknown as string)),
        new Prisma.Decimal(0)
      );
  }
}

class FakePaymentsService extends PaymentsService {
  payment: Payment;
  constructor(p: Payment) {
    super(undefined as never, undefined as never, undefined as never);
    this.payment = p;
  }
  override async getOwned(id: string, _userId: string): Promise<Payment> {
    if (this.payment.id !== id || this.payment.userId !== _userId) {
      throw new ForbiddenException(
        'You do not own this payment',
        'NOT_PAYMENT_OWNER'
      );
    }
    return this.payment;
  }
}

type ProcessorRefundResult = {
  processorRef: string;
  status: 'APPROVED' | 'REJECTED';
  reason: 'REFUND_WINDOW_EXPIRED' | 'ORIGINAL_NOT_FOUND' | null;
};

class FakeProcessorClient extends PaymentsProcessorClient {
  nextResult: ProcessorRefundResult = {
    processorRef: 'proc-rfn-1',
    status: 'APPROVED',
    reason: null,
  };
  calls: unknown[] = [];
  constructor() {
    super({ baseUrl: 'http://unused' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async processRefund(input: any): Promise<ProcessorRefundResult> {
    this.calls.push(input);
    return this.nextResult;
  }
}

function makeService(p: Payment) {
  const repo = new FakeRefundsRepository();
  const payments = new FakePaymentsService(p);
  const processor = new FakeProcessorClient();
  const service = new RefundsService(repo, payments, processor);
  return { service, repo, payments, processor };
}

describe('RefundsService.create', () => {
  beforeEach(() => setTestEnv());

  it('creates a PENDING row, calls the processor, marks APPROVED', async () => {
    const { service, repo, processor } = makeService(makePayment());
    const result = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result.status).toBe('APPROVED');
    expect(result.amount.toString()).toBe('100.00');
    expect(processor.calls).toHaveLength(1);
    // No refunds tracked yet at the time of the call
    expect(repo.byKey.size).toBe(1);
  });

  it('returns the same refund on a repeated idempotencyKey (no double charge)', async () => {
    const { service, processor } = makeService(makePayment());
    const key = 'fixed-key-1';
    const first = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
      idempotencyKey: key,
    });
    const second = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);
    expect(processor.calls).toHaveLength(1);
  });

  it('throws ConflictException for a REJECTED payment', async () => {
    const { service } = makeService(makePayment({ status: 'REJECTED' }));
    await expect(
      service.create({ userId: OWNER_ID, paymentId: PAYMENT_ID })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ConflictException for a PENDING payment older than the window', async () => {
    const oldDate = new Date(Date.now() - 10 * 60_000); // 10 min ago, window is 5
    const { service } = makeService(
      makePayment({ status: 'PENDING', createdAt: oldDate })
    );
    await expect(
      service.create({ userId: OWNER_ID, paymentId: PAYMENT_ID })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts a PENDING payment within the refund window', async () => {
    const recent = new Date(Date.now() - 60_000); // 1 min ago
    const { service, processor } = makeService(
      makePayment({ status: 'PENDING', createdAt: recent })
    );
    const result = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result.status).toBe('APPROVED');
    expect(processor.calls).toHaveLength(1);
  });

  it('throws UnprocessableEntityException for an over-refund', async () => {
    const { service, repo } = makeService(makePayment());
    // First refund: full 100
    await service.create({ userId: OWNER_ID, paymentId: PAYMENT_ID });
    // Second refund: anything > 0
    await expect(
      service.create({
        userId: OWNER_ID,
        paymentId: PAYMENT_ID,
        amount: 1,
      })
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.byKey.size).toBe(1); // only the first refund
  });

  it('allows a partial refund that fits the remaining balance', async () => {
    const { service, processor } = makeService(makePayment());
    await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
      amount: 30,
    });
    const result = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
      amount: 70,
    });
    expect(result.status).toBe('APPROVED');
    expect(processor.calls).toHaveLength(2);
  });

  it('throws ForbiddenException when the user does not own the payment', async () => {
    const { service } = makeService(makePayment());
    await expect(
      service.create({ userId: OTHER_ID, paymentId: PAYMENT_ID })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 201-shaped refund on a REJECTED processor response (does not throw)', async () => {
    const { service, processor } = makeService(makePayment());
    processor.nextResult = {
      processorRef: 'proc-rfn-rej',
      status: 'REJECTED',
      reason: 'REFUND_WINDOW_EXPIRED',
    };
    const result = await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('REFUND_WINDOW_EXPIRED');
  });
});

describe('RefundsService.listForPayment + getOwned', () => {
  beforeEach(() => setTestEnv());

  it('listForPayment returns only refunds of the given payment', async () => {
    const { service, repo } = makeService(makePayment());
    await service.create({
      userId: OWNER_ID,
      paymentId: PAYMENT_ID,
      amount: 10,
    });
    repo.byKey.set(
      'k2',
      makeRefund({ id: 'rfn-x', paymentId: 'other-pay', idempotencyKey: 'k2' })
    );
    const list = await service.listForPayment(OWNER_ID, PAYMENT_ID);
    expect(list.every((r) => r.paymentId === PAYMENT_ID)).toBe(true);
    expect(list.length).toBe(1);
  });

  it('getOwned throws ForbiddenException for a non-owner', async () => {
    const { service, repo } = makeService(makePayment());
    await service.create({ userId: OWNER_ID, paymentId: PAYMENT_ID });
    const refundId = [...repo.byKey.values()][0]!.id;
    await expect(service.getOwned(refundId, OTHER_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});

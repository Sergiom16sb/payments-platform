import { describe, expect, it } from 'vitest';
import {
  CreatePaymentRequestSchema,
  PaymentQuerySchema,
  ProcessorRequestSchema,
  ProcessorResponseSchema,
} from '@/dto/payments/payments.schemas.js';

describe('CreatePaymentRequestSchema', () => {
  const validCardId = 'cms93f0xb0000wofz8qlw3egv';

  it('accepts a minimal valid payload (currency defaults to USD)', () => {
    const r = CreatePaymentRequestSchema.parse({
      cardId: validCardId,
      amount: 49.99,
    });
    expect(r.currency).toBe('USD');
    expect(r.idempotencyKey).toBeUndefined();
  });

  it('accepts an explicit idempotencyKey (UUID)', () => {
    const r = CreatePaymentRequestSchema.parse({
      cardId: validCardId,
      amount: 10,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.idempotencyKey).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects a non-UUID idempotencyKey', () => {
    expect(() =>
      CreatePaymentRequestSchema.parse({
        cardId: validCardId,
        amount: 10,
        idempotencyKey: 'not-a-uuid',
      })
    ).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() =>
      CreatePaymentRequestSchema.parse({ cardId: validCardId, amount: -5 })
    ).toThrow();
  });

  it('rejects an invalid cardId', () => {
    expect(() =>
      CreatePaymentRequestSchema.parse({ cardId: 'not-a-cuid', amount: 5 })
    ).toThrow();
  });
});

describe('PaymentQuerySchema', () => {
  it('applies defaults', () => {
    const r = PaymentQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it('accepts a status filter', () => {
    const r = PaymentQuerySchema.parse({ status: 'APPROVED' });
    expect(r.status).toBe('APPROVED');
  });

  it('rejects an invalid status', () => {
    expect(() => PaymentQuerySchema.parse({ status: 'BOGUS' })).toThrow();
  });
});

describe('ProcessorRequestSchema / ProcessorResponseSchema', () => {
  it('validates a well-formed processor request', () => {
    const r = ProcessorRequestSchema.parse({
      paymentId: 'ckl123',
      amount: '49.99',
      currency: 'USD',
      cardToken: 'tok_abc',
    });
    expect(r.currency).toBe('USD');
  });

  it('validates an APPROVED response with reason=null', () => {
    const r = ProcessorResponseSchema.parse({
      processorRef: 'abc123',
      status: 'APPROVED',
      reason: null,
    });
    expect(r.status).toBe('APPROVED');
  });

  it('validates a REJECTED response with a reason', () => {
    const r = ProcessorResponseSchema.parse({
      processorRef: 'abc123',
      status: 'REJECTED',
      reason: 'INSUFFICIENT_FUNDS',
    });
    expect(r.reason).toBe('INSUFFICIENT_FUNDS');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      ProcessorResponseSchema.parse({
        processorRef: 'x',
        status: 'MAYBE',
        reason: null,
      })
    ).toThrow();
  });
});

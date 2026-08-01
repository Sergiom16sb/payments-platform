import { describe, expect, it } from 'vitest';
import {
  CreateRefundRequestSchema,
  ProcessorRefundRequestSchema,
  ProcessorRefundResponseSchema,
  RefundResponseSchema,
} from '@/dto/payments/refunds.schemas.js';

describe('CreateRefundRequestSchema', () => {
  it('accepts an empty body (all fields optional)', () => {
    expect(() => CreateRefundRequestSchema.parse({})).not.toThrow();
  });

  it('accepts an explicit amount and reason', () => {
    const r = CreateRefundRequestSchema.parse({
      amount: 25.5,
      reason: 'Customer request',
    });
    expect(r.amount).toBe(25.5);
  });

  it('rejects a negative amount', () => {
    expect(() => CreateRefundRequestSchema.parse({ amount: -1 })).toThrow();
  });

  it('rejects a 3-decimal amount', () => {
    expect(() => CreateRefundRequestSchema.parse({ amount: 1.234 })).toThrow();
  });

  it('accepts a uuid idempotencyKey', () => {
    const r = CreateRefundRequestSchema.parse({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.idempotencyKey).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects a non-uuid idempotencyKey', () => {
    expect(() =>
      CreateRefundRequestSchema.parse({ idempotencyKey: 'abc' })
    ).toThrow();
  });
});

describe('RefundResponseSchema', () => {
  it('accepts a well-formed response', () => {
    const r = RefundResponseSchema.parse({
      id: 'rfn_1',
      paymentId: 'ckl_1',
      amount: '49.99',
      currency: 'USD',
      status: 'APPROVED',
      reason: null,
      processorRef: 'proc_abc',
      rejectionReason: null,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-01T12:00:00.000Z',
    });
    expect(r.status).toBe('APPROVED');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      RefundResponseSchema.parse({
        id: 'rfn_1',
        paymentId: 'ckl_1',
        amount: '49.99',
        currency: 'USD',
        status: 'BOGUS',
        reason: null,
        processorRef: null,
        rejectionReason: null,
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-01T12:00:00.000Z',
      })
    ).toThrow();
  });
});

describe('ProcessorRefundRequestSchema / ProcessorRefundResponseSchema', () => {
  it('validates a well-formed processor request', () => {
    const r = ProcessorRefundRequestSchema.parse({
      refundId: 'rfn_1',
      paymentId: 'ckl_1',
      amount: '49.99',
      currency: 'USD',
    });
    expect(r.currency).toBe('USD');
  });

  it('rejects lowercase currency', () => {
    expect(() =>
      ProcessorRefundRequestSchema.parse({
        refundId: 'rfn_1',
        paymentId: 'ckl_1',
        amount: '49.99',
        currency: 'usd',
      })
    ).toThrow();
  });

  it('validates a REJECTED refund response with REFUND_WINDOW_EXPIRED', () => {
    const r = ProcessorRefundResponseSchema.parse({
      processorRef: 'proc_1',
      status: 'REJECTED',
      reason: 'REFUND_WINDOW_EXPIRED',
    });
    expect(r.reason).toBe('REFUND_WINDOW_EXPIRED');
  });

  it('rejects an unknown reason in processor response', () => {
    expect(() =>
      ProcessorRefundResponseSchema.parse({
        processorRef: 'x',
        status: 'REJECTED',
        reason: 'NOT_A_REAL_REASON',
      })
    ).toThrow();
  });
});

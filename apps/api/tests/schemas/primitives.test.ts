import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '@/schemas/envelopes.js';
import {
  AmountSchema,
  CurrencySchema,
  EmailSchema,
  IdSchema,
  IsoDateTimeSchema,
  PaginationMetaSchema,
  PaginationQuerySchema,
} from '@/schemas/primitives.js';

describe('primitives', () => {
  describe('IdSchema', () => {
    it('accepts a valid cuid', () => {
      expect(() => IdSchema.parse('cms93f0xb0000wofz8qlw3egv')).not.toThrow();
    });

    it('rejects an empty string', () => {
      expect(() => IdSchema.parse('')).toThrow();
    });

    it('rejects a UUID (not a cuid)', () => {
      expect(() =>
        IdSchema.parse('550e8400-e29b-41d4-a716-446655440000')
      ).toThrow();
    });
  });

  describe('EmailSchema', () => {
    it('lowercases the email', () => {
      expect(EmailSchema.parse('Foo@Bar.COM')).toBe('foo@bar.com');
    });

    it('rejects malformed input', () => {
      expect(() => EmailSchema.parse('not-an-email')).toThrow();
    });
  });

  describe('CurrencySchema', () => {
    it('accepts ISO 4217 codes', () => {
      expect(CurrencySchema.parse('USD')).toBe('USD');
    });

    it('rejects lowercase (must be uppercase)', () => {
      expect(() => CurrencySchema.parse('eur')).toThrow();
    });

    it('rejects non-3-letter strings', () => {
      expect(() => CurrencySchema.parse('US')).toThrow();
      expect(() => CurrencySchema.parse('USDX')).toThrow();
    });
  });

  describe('AmountSchema', () => {
    it('accepts a positive 2-decimal amount', () => {
      expect(AmountSchema.parse(49.99)).toBe(49.99);
    });

    it('rejects negative or zero', () => {
      expect(() => AmountSchema.parse(0)).toThrow();
      expect(() => AmountSchema.parse(-1)).toThrow();
    });

    it('rejects 3-decimal amounts', () => {
      expect(() => AmountSchema.parse(1.234)).toThrow();
    });

    it('caps at 1_000_000', () => {
      expect(() => AmountSchema.parse(1_000_001)).toThrow();
    });
  });

  describe('IsoDateTimeSchema', () => {
    it('parses a valid ISO 8601 string into a Date', () => {
      const d = IsoDateTimeSchema.parse('2026-07-31T12:34:56.789Z');
      expect(d).toBeInstanceOf(Date);
      expect(d.toISOString()).toBe('2026-07-31T12:34:56.789Z');
    });

    it('rejects non-ISO strings', () => {
      expect(() => IsoDateTimeSchema.parse('not a date')).toThrow();
    });
  });

  describe('PaginationQuerySchema', () => {
    it('coerces numeric strings', () => {
      const r = PaginationQuerySchema.parse({ page: '3', pageSize: '10' });
      expect(r.page).toBe(3);
      expect(r.pageSize).toBe(10);
    });

    it('applies defaults when missing', () => {
      const r = PaginationQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(20);
    });

    it('rejects pageSize > 100', () => {
      expect(() => PaginationQuerySchema.parse({ pageSize: 200 })).toThrow();
    });
  });

  describe('PaginationMetaSchema', () => {
    it('round-trips a valid meta object', () => {
      const m = PaginationMetaSchema.parse({
        page: 1,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      });
      expect(m).toEqual({
        page: 1,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      });
    });
  });
});

describe('envelopes', () => {
  const ItemSchema = z.object({ id: z.string(), name: z.string() });
  const EnvelopeSchema = successEnvelope(
    ItemSchema.array(),
    PaginationMetaSchema
  );

  it('builds a success envelope with data and optional meta', () => {
    const r = EnvelopeSchema.parse({
      success: true,
      data: [{ id: '1', name: 'a' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it('rejects success envelope with wrong data shape', () => {
    expect(() =>
      EnvelopeSchema.parse({ success: true, data: [{ wrong: 'shape' }] })
    ).toThrow();
  });

  it('ErrorEnvelopeSchema accepts the standard error shape', () => {
    const r = ErrorEnvelopeSchema.parse({
      success: false,
      error: { message: 'bad', code: 'BAD' },
    });
    expect(r.success).toBe(false);
  });

  it('ErrorEnvelopeSchema accepts fields array', () => {
    const r = ErrorEnvelopeSchema.parse({
      success: false,
      error: {
        message: 'invalid',
        code: 'VALIDATION_ERROR',
        fields: [{ path: 'email', message: 'required' }],
      },
    });
    expect(r.error.fields).toEqual([{ path: 'email', message: 'required' }]);
  });
});

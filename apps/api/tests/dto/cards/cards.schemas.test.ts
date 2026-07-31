import { describe, expect, it } from 'vitest';
import {
  CardResponseSchema,
  CreateCardRequestSchema,
} from '@/dto/cards/cards.schemas.js';

describe('CreateCardRequestSchema', () => {
  const valid = {
    pan: '4111111111111111',
    cvv: '123',
    expMonth: 12,
    expYear: 2030,
    cardholderName: 'Alice Example',
  };

  it('accepts a well-formed payload', () => {
    expect(() => CreateCardRequestSchema.parse(valid)).not.toThrow();
  });

  it('rejects a PAN with non-digits', () => {
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, pan: '4111-1111-1111-1111' })
    ).toThrow();
  });

  it('rejects a PAN that is too short', () => {
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, pan: '41111' })
    ).toThrow();
  });

  it('rejects an out-of-range month', () => {
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, expMonth: 13 })
    ).toThrow();
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, expMonth: 0 })
    ).toThrow();
  });

  it('rejects a CVV that is not 3-4 digits', () => {
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, cvv: '12' })
    ).toThrow();
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, cvv: '12345' })
    ).toThrow();
  });

  it('accepts a 4-digit CVV (Amex)', () => {
    expect(() =>
      CreateCardRequestSchema.parse({ ...valid, cvv: '1234' })
    ).not.toThrow();
  });
});

describe('CardResponseSchema', () => {
  it('accepts a well-formed response (no PAN/CVV)', () => {
    const r = CardResponseSchema.parse({
      id: 'cms9a1b2c3d4e5f6g7h8',
      brand: 'VISA',
      last4: '1111',
      expMonth: 12,
      expYear: 2030,
      cardholderName: 'Alice',
      token: 'tok_8f3a2b',
      createdAt: '2026-07-31T12:00:00.000Z',
    });
    expect(r.brand).toBe('VISA');
  });

  it('rejects a last4 that is not exactly 4 chars', () => {
    expect(() =>
      CardResponseSchema.parse({
        id: 'x',
        brand: 'VISA',
        last4: '111',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'A',
        token: 't',
        createdAt: '2026-07-31T12:00:00.000Z',
      })
    ).toThrow();
  });
});

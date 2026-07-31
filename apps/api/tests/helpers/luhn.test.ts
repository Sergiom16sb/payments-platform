import { describe, expect, it } from 'vitest';
import { detectBrand, isLuhnValid } from '@/helpers/luhn.js';

describe('isLuhnValid', () => {
  // Well-known Luhn-valid test PANs.
  it.each([
    '4111111111111111', // Visa test
    '4012888888881881', // Visa test
    '5555555555554444', // MC test
    '5105105105105100', // MC test
    '378282246310005', // Amex test (15 digits)
    '371449635398431', // Amex test
  ])('accepts real test PAN %s', (pan) => {
    expect(isLuhnValid(pan)).toBe(true);
  });

  it.each([
    '4111111111111112', // off-by-one
    '1234567890123456', // sequential — invalid
    '411111111111111', // 15 digits but not Amex-valid
  ])('rejects bad PAN %s', (pan) => {
    expect(isLuhnValid(pan)).toBe(false);
  });

  it('accepts digits-with-dashes (strips non-digits — robust helper)', () => {
    // The PAN schema enforces no-dashes; the Luhn helper is forgiving so
    // callers that pre-clean input don't get bitten. Card validation
    // upstream (the Zod schema) is the strict gate.
    expect(isLuhnValid('4111-1111-1111-1111')).toBe(true);
  });

  it('rejects empty / too short / too long', () => {
    expect(isLuhnValid('')).toBe(false);
    expect(isLuhnValid('4111')).toBe(false);
    expect(isLuhnValid('1'.repeat(20))).toBe(false);
    expect(isLuhnValid('1'.repeat(12))).toBe(false);
  });
});

describe('detectBrand', () => {
  it('detects Visa (starts with 4)', () => {
    expect(detectBrand('4111111111111111')).toBe('VISA');
  });
  it('detects Mastercard (51-55, 22-27)', () => {
    expect(detectBrand('5555555555554444')).toBe('MASTERCARD');
    expect(detectBrand('2223000048400011')).toBe('MASTERCARD');
  });
  it('detects Amex (34, 37)', () => {
    expect(detectBrand('378282246310005')).toBe('AMEX');
  });
  it('returns UNKNOWN for unrecognized BINs', () => {
    expect(detectBrand('9999888877776666')).toBe('UNKNOWN');
  });
});

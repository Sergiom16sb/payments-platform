import { describe, expect, it } from 'vitest';
import { envSchema } from '@/config/env.js';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  PAYMENTS_PROCESSOR_URL: 'http://localhost:8000',
};

describe('envSchema', () => {
  it('accepts a valid minimal env and applies defaults', () => {
    const result = envSchema.parse(VALID_ENV);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.HOST).toBe('0.0.0.0');
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.JWT_ISSUER).toBe('payments-api');
    expect(result.JWT_AUDIENCE).toBe('payments-client');
    expect(result.BCRYPT_ROUNDS).toBe(10);
    expect(result.PAYMENTS_PROCESSOR_TIMEOUT_MS).toBe(5000);
    expect(result.PAYMENTS_PROCESSOR_MAX_RETRIES).toBe(3);
    expect(result.CORS_ORIGINS).toEqual([]);
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      JWT_SECRET: 'too-short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['JWT_SECRET']);
    }
  });

  it('rejects a DATABASE_URL that is not postgres', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      DATABASE_URL: 'mysql://user:pass@localhost/db',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['DATABASE_URL']);
    }
  });

  it('coerces numeric strings from env', () => {
    const result = envSchema.parse({
      ...VALID_ENV,
      PORT: '8080',
      BCRYPT_ROUNDS: '12',
      PAYMENTS_PROCESSOR_TIMEOUT_MS: '10000',
    });
    expect(result.PORT).toBe(8080);
    expect(result.BCRYPT_ROUNDS).toBe(12);
    expect(result.PAYMENTS_PROCESSOR_TIMEOUT_MS).toBe(10_000);
  });

  it('splits CORS_ORIGINS on commas and trims whitespace', () => {
    const result = envSchema.parse({
      ...VALID_ENV,
      CORS_ORIGINS: ' http://a , http://b ,http://c ',
    });
    expect(result.CORS_ORIGINS).toEqual(['http://a', 'http://b', 'http://c']);
  });

  it('treats empty CORS_ORIGINS as a disabled list', () => {
    const result = envSchema.parse({ ...VALID_ENV, CORS_ORIGINS: '' });
    expect(result.CORS_ORIGINS).toEqual([]);
  });
});

/**
 * Test environment helper. Many tests need a valid `process.env` to
 * satisfy `getEnv()` (which is called eagerly by `getPrisma()` and
 * indirectly by `UsersRepository` etc.). Centralize the fixture here
 * so individual test files only import + call this.
 *
 * Also resets the env-side cache in env.ts so each test sees a clean
 * parse.
 */

import { _resetEnvCacheForTests } from '@/config/env.js';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(32),
  JWT_ISSUER: 'payments-api',
  JWT_AUDIENCE: 'payments-client',
  JWT_ACCESS_TOKEN_EXPIRES_IN: '15m',
  JWT_REFRESH_TOKEN_EXPIRES_IN: '7d',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  PAYMENTS_PROCESSOR_URL: 'http://localhost:8000',
  BCRYPT_ROUNDS: '4',
};

export function setTestEnv(overrides: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
    process.env[k] = v;
  }
  // Force the next getEnv() call to re-parse so changes take effect.
  _resetEnvCacheForTests();
}

export function clearTestEnv(): void {
  for (const k of Object.keys(BASE_ENV)) {
    delete process.env[k];
  }
  _resetEnvCacheForTests();
}

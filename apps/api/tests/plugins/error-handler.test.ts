import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { buildApp } from '@/app.js';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@/exceptions/index.js';

describe('error-handler plugin', () => {
  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/d';
    process.env.JWT_SECRET ??= 'x'.repeat(32);
    process.env.PAYMENTS_PROCESSOR_URL ??= 'http://localhost:8000';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.PAYMENTS_PROCESSOR_URL;
  });

  // Builds a fresh app per test, registers probe routes, then ready()s.
  // Routes must be added BEFORE ready() because Fastify refuses new routes
  // after the instance starts the listening prep.
  async function makeApp() {
    const app = await buildApp({ logger: false });
    return app;
  }

  async function boot(app: Awaited<ReturnType<typeof buildApp>>) {
    await app.ready();
  }

  it('maps HttpException to its declared status and envelope', async () => {
    const app = await makeApp();
    app.get('/_t/not-found', () => {
      throw new NotFoundException('User abc not found', 'USER_NOT_FOUND');
    });
    await boot(app);

    const res = await app.inject({ method: 'GET', url: '/_t/not-found' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toEqual({
      success: false,
      error: { message: 'User abc not found', code: 'USER_NOT_FOUND' },
    });

    await app.close();
  });

  it('maps ConflictException to 409 with details', async () => {
    const app = await makeApp();
    app.get('/_t/conflict', () => {
      throw new ConflictException('Email already registered', 'EMAIL_TAKEN', {
        email: 'a@b.com',
      });
    });
    await boot(app);

    const res = await app.inject({ method: 'GET', url: '/_t/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      message: 'Email already registered',
      code: 'EMAIL_TAKEN',
      details: { email: 'a@b.com' },
    });

    await app.close();
  });

  it('maps ZodError to 400 with structured fields', async () => {
    const app = await makeApp();
    app.get('/_t/zod', () => {
      throw new ZodError([
        {
          code: 'invalid_type',
          path: ['email'],
          message: 'Expected string',
          expected: 'string',
        } as never,
        {
          code: 'too_small',
          path: ['password'],
          message: 'String must contain at least 8 character(s)',
          origin: 'string',
          minimum: 8,
          inclusive: true,
        } as never,
      ]);
    });
    await boot(app);

    const res = await app.inject({ method: 'GET', url: '/_t/zod' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields).toEqual([
      { path: 'email', message: 'Expected string' },
      {
        path: 'password',
        message: 'String must contain at least 8 character(s)',
      },
    ]);

    await app.close();
  });

  it('maps Fastify route-schema validation to 400 with fields', async () => {
    const app = await makeApp();
    app.get(
      '/_t/validation',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { n: { type: 'integer' } },
            required: ['n'],
          },
        },
      },
      () => ({ ok: true })
    );
    await boot(app);

    const res = await app.inject({ method: 'GET', url: '/_t/validation' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.fields)).toBe(true);

    await app.close();
  });

  it('maps unknown errors to 500 with a generic message in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = await makeApp();
    app.get('/_t/boom', () => {
      throw new Error('database password leaked into the error');
    });
    await boot(app);

    const res = await app.inject({ method: 'GET', url: '/_t/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe('Internal Server Error');

    await app.close();
    process.env.NODE_ENV = prev;
  });

  it('preserves HttpException subclasses (BadRequestException, etc.)', async () => {
    const app = await makeApp();
    app.get('/_t/bad', () => {
      throw new BadRequestException('Bad input', 'BAD_INPUT');
    });
    await boot(app);
    const res = await app.inject({ method: 'GET', url: '/_t/bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');

    await app.close();
  });

  it('returns 404 with envelope for unknown routes', async () => {
    const app = await makeApp();
    await boot(app);
    const res = await app.inject({ method: 'GET', url: '/_t/nowhere' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      success: false,
      error: {
        message: 'Route GET:/_t/nowhere not found',
        code: 'NOT_FOUND',
      },
    });
    await app.close();
  });

  it('does not break when HttpException details is undefined', async () => {
    const app = await makeApp();
    app.get('/_t/no-details', () => {
      throw new HttpException('Boom', 418, "I'M_A_TEAPOT");
    });
    await boot(app);
    const res = await app.inject({ method: 'GET', url: '/_t/no-details' });
    expect(res.statusCode).toBe(418);
    expect(res.json().error.details).toBeUndefined();
    await app.close();
  });
});

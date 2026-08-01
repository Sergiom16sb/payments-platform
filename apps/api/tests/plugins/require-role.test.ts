import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { getEnv } from '@/config/env.js';
import authGuardPlugin from '@/plugins/auth-guard.js';
import requireRolePlugin from '@/plugins/require-role.js';
import { setTestEnv } from '../setup-env.js';

async function buildApp(): Promise<import('fastify').FastifyInstance> {
  setTestEnv();
  const env = getEnv();
  if (!env) throw new Error('env not loaded');
  const app = Fastify({ logger: false })
    .register(cookie, {})
    .register(jwt, {
      secret: env.JWT_SECRET,
      sign: { expiresIn: '15m' },
    });
  // Register BOTH auth-guard and require-role (mirrors production).
  return app
    .register(authGuardPlugin)
    .register(requireRolePlugin) as unknown as Promise<
    import('fastify').FastifyInstance
  >;
}

async function issueToken(
  app: import('fastify').FastifyInstance,
  role: 'ADMIN' | 'USER'
) {
  return app.jwt.sign({ sub: 'user-x', email: 'x@x.com', role, typ: 'access' });
}

describe('requireRole preHandler', () => {
  beforeEach(() => setTestEnv());

  it('rejects with 403 when role does not match', async () => {
    const app = await buildApp();
    await app.ready();

    const guard = app.requireRole('ADMIN');
    let captured: unknown;
    try {
      await guard(
        { user: { sub: 'user-x', role: 'USER' } } as FastifyRequest,
        {} as FastifyReply
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toMatchObject({
      statusCode: 403,
      code: 'INSUFFICIENT_ROLE',
    });
    await app.close();
  });

  it('passes through when role matches', async () => {
    const app = await buildApp();
    await app.ready();
    const guard = app.requireRole('ADMIN');
    await guard(
      { user: { sub: 'user-x', role: 'ADMIN' } } as unknown as FastifyRequest,
      {} as FastifyReply
    );
    await app.close();
  });

  it('rejects with 401 when user is missing entirely', async () => {
    const app = await buildApp();
    await app.ready();
    const guard = app.requireRole('ADMIN');
    await expect(
      guard({} as FastifyRequest, {} as FastifyReply)
    ).rejects.toMatchObject({ statusCode: 401 });
    await app.close();
  });

  it('is end-to-end: route with the guard returns 403 for USER role', async () => {
    const app = await buildApp();
    // Production wiring: authenticate FIRST (populates req.user), then
    // requireRole (reads req.user.role). Order matters — requireRole
    // throws 401 if user is missing.
    app.get('/guarded', {
      preHandler: [app.authenticate, app.requireRole('ADMIN')],
      handler: () => ({ ok: true }),
    });
    await app.ready();

    // No auth header -> 401 (handled by authenticate).
    const noAuth = await app.inject({ method: 'GET', url: '/guarded' });
    expect(noAuth.statusCode).toBe(401);

    // USER token -> 403 INSUFFICIENT_ROLE (handled by requireRole).
    const userToken = await issueToken(app, 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSUFFICIENT_ROLE');

    // ADMIN works.
    const adminToken = await issueToken(app, 'ADMIN');
    const res2 = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res2.statusCode).toBe(200);
    await app.close();
  });
});

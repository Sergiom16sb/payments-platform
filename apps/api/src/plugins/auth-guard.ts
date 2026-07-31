import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Adds a request-level `authenticate` preHandler that:
 *  1. Reads the Authorization: Bearer header
 *  2. Verifies the JWT via @fastify/jwt
 *  3. Sets request.user = { sub: string, email: string, role: 'USER'|'ADMIN' }
 *
 * Use via:
 *
 *   app.post('/protected', {
 *     preHandler: app.authenticate,
 *     handler: (req) => req.user.sub,
 *   });
 *
 * The decorator is set on the Fastify instance (not a route plugin),
 * so all routes that opt in via `preHandler: app.authenticate` get
 * the same behavior — even routes registered as siblings under
 * `app.register(...)`.
 *
 * Implementation note: we wrap the preHandler in fp() so the decoration
 * (app.authenticate) bubbles to the root and is visible everywhere.
 */

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authGuardPlugin(app: FastifyInstance): Promise<void> {
  app.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        reply.status(401).send({
          success: false,
          error: {
            message: 'Missing or invalid access token',
            code: 'UNAUTHENTICATED',
          },
        });
      }
    }
  );
}

export default fp(authGuardPlugin, { name: 'auth-guard' });

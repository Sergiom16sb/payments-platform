import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  ForbiddenException,
  UnauthorizedException,
} from '../exceptions/index.js';

/**
 * Decorates `app.requireRole(role)` with a preHandler factory.
 *
 * Use on any route to gate access by JWT role:
 *
 *   app.post('/admin/...', {
 *     preHandler: [app.authenticate, app.requireRole('ADMIN')],
 *     handler: ...,
 *   });
 *
 * Must be listed AFTER `app.authenticate` so that `req.user` is populated.
 * `app.authenticate` already does `reply.status(401).send(...)` directly
 * when JWT verification fails (instead of throwing), so the typical
 * ordering {authenticate, requireRole} means:
 *   - 401 (no token / bad signature) — handled by authenticate
 *   - 403 (token valid but role wrong) — handled here
 *
 * Decorated with fp() so the `requireRole` factory is visible on every
 * route plugin (same encapsulation reasoning as auth-guard).
 */

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (
      role: 'ADMIN' | 'USER'
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function requireRolePlugin(
  app: import('fastify').FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void
): void {
  app.decorate('requireRole', (role: 'ADMIN' | 'USER') => {
    return async (req: FastifyRequest, _reply: FastifyReply) => {
      const u = req.user as { sub?: string; role?: string } | undefined;
      if (!u || !u.sub) {
        // Defensive: should never reach here if `app.authenticate` ran first.
        throw new UnauthorizedException(
          'Authenticated user not found on request',
          'UNAUTHENTICATED'
        );
      }
      if (u.role !== role) {
        throw new ForbiddenException(
          `This endpoint requires role ${role}`,
          'INSUFFICIENT_ROLE'
        );
      }
    };
  });
  done();
}

export default fp(requireRolePlugin, { name: 'require-role' });

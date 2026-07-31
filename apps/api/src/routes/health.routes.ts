import type { FastifyInstance } from 'fastify';

/**
 * Health endpoint used by docker compose healthcheck.
 * GET /api/health -> 200 with { status: 'ok', uptime }.
 *
 * A future PR (PLAN §11) will add /api/health/db that runs SELECT 1
 * via Prisma. For now this only proves the HTTP server is listening.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));
}

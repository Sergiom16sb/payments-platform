import type { FastifyInstance } from 'fastify';

/**
 * Health endpoint used by docker compose healthcheck.
 * GET /api/health -> 200 with { status: 'ok', uptime }.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));
}

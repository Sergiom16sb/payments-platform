import { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env.js';

/**
 * Singleton Prisma client. Built once per process and reused across
 * every request. The DATABASE_URL is read from the validated env so the
 * client only exists after env validation succeeds (fail-fast boot).
 *
 * In tests we pass `prisma` instances per-suite via app.decorate to keep
 * isolation, but this singleton is the default for production.
 */
let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  const env = getEnv();
  _prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  return _prisma;
}

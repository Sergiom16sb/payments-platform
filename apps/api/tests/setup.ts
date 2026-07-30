import { afterEach, beforeEach } from 'vitest';
import { buildApp, type BuildAppOptions } from '@/app.js';

export interface TestContext {
  app: Awaited<ReturnType<typeof buildApp>>;
}

export async function setupTestApp(
  opts: BuildAppOptions = {}
): Promise<TestContext> {
  const app = await buildApp({
    logger: false,
    ...opts,
  });

  beforeEach(async () => {
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  return { app };
}

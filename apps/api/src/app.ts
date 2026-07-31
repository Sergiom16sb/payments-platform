import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autoLoad from '@fastify/autoload';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { getEnv } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  logger?: boolean | object;
}

const registerPlugins: FastifyPluginAsync = async (app) => {
  // Validate env once before registering any plugin that needs it.
  const env = getEnv();

  // Sensible: default HTTP error helpers (httpErrors.notFound, etc.)
  await app.register(sensible);

  // Helmet: default security headers. CSP disabled because Swagger UI
  // serves inline scripts that would otherwise need a per-route nonce.
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS: env-driven whitelist. Empty list disables CORS entirely.
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });

  // Rate limit: global default; specific routes can override per-PR.
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '15 minutes',
  });

  // Swagger (JSON spec generation) + Swagger UI.
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Payments API',
        description:
          'REST API for the payments-platform technical test. ' +
          'Schema-driven via Zod + fastify-type-provider-zod.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
};

const registerAppPlugins: FastifyPluginAsync = async (app) => {
  // Auto-load domain plugins (error handler, routes, etc.) from src/plugins/
  // and src/routes/. Each plugin is a fastify-plugin-encapsulated module.
  // Empty dirs are OK — autoLoad just no-ops until files appear in later PRs.
  await app.register(autoLoad, {
    dir: path.join(__dirname, 'plugins'),
    forceESM: true,
  });

  await app.register(autoLoad, {
    dir: path.join(__dirname, 'routes'),
    forceESM: true,
    options: { prefix: '/api' },
  });
};

export async function buildApp(
  opts: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register the error handler on the root instance BEFORE any plugin
  // creates an encapsulation context, so it applies to ALL routes —
  // including those added later by autoload and tests.
  registerErrorHandler(app);

  await app.register(registerPlugins);
  await app.register(registerAppPlugins);

  return app;
}

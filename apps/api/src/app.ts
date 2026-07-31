import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
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
import { authRoutes } from './routes/auth.routes.js';

export interface BuildAppOptions {
  logger?: boolean | object;
}

const registerPlugins: FastifyPluginAsync = async (app) => {
  // Sensible: default HTTP error helpers (httpErrors.notFound, etc.)
  await app.register(sensible);

  // Helmet: default security headers. CSP disabled because Swagger UI
  // serves inline scripts that would otherwise need a per-route nonce.
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS: env-driven whitelist. Empty list disables CORS entirely.
  await app.register(cors, {
    origin: getEnv().CORS_ORIGINS.length > 0 ? getEnv().CORS_ORIGINS : false,
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
  // including those added later by tests and (in future PRs) domain routes.
  registerErrorHandler(app);

  // Cookie parser + JWT MUST be registered on the root, not inside
  // registerPlugins — otherwise the decoration (`reply.setCookie` and
  // `request.jwtVerify`) is scoped to the child context and not visible
  // to routes registered as siblings (auth.routes, future feature routes).
  // Both plugins are fp()-wrapped internally so this works without
  // breaking encapsulation.
  const env = getEnv();
  await app.register(cookie, {});
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN },
  });

  await app.register(registerPlugins);

  // Domain routes (registered manually rather than via @fastify/autoload
  // so we don't depend on directory contents that may be empty).
  await app.register(authRoutes, { prefix: '/api/auth' });

  return app;
}

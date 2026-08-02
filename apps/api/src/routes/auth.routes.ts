import type { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth.controller.js';
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  TokenResponseSchema,
} from '../dto/auth/auth.schemas.js';

/**
 * Auth routes. Mounted under /api/auth by app.ts.
 *
 * Validation: Fastify + fastify-type-provider-zod run the Zod schemas
 * against body/response, producing typed req.body and serializing the
 * outgoing JSON via TokenResponseSchema.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', {
    schema: {
      body: RegisterRequestSchema,
      response: { 201: TokenResponseSchema },
    },
    handler: authController.register,
  });

  app.post('/login', {
    schema: {
      body: LoginRequestSchema,
      response: { 200: TokenResponseSchema },
    },
    handler: authController.login,
  });

  app.post('/refresh', {
    schema: {
      body: RefreshRequestSchema,
      response: { 200: TokenResponseSchema },
    },
    handler: authController.refresh,
  });

  app.post('/logout', {
    schema: { body: RefreshRequestSchema },
    handler: authController.logout,
  });
}

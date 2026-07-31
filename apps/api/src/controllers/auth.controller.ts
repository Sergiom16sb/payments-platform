import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from '../dto/auth/auth.schemas.js';
import { type AuthSuccess, getAuthService } from '../services/auth.service.js';

/**
 * Auth HTTP handlers (controllers). Each method receives a Fastify
 * request, parses the body via Zod, calls the auth service, and
 * returns the success value (Fastify serializes via the route's
 * response schema declared in auth.routes.ts).
 *
 * Refresh tokens are also stored in an httpOnly cookie so clients
 * that don't want to manage the body field can just send the cookie.
 */

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_TTL_SECONDS,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export interface PublicUserView {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

export interface TokenView {
  user: PublicUserView;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
}

function toView(success: AuthSuccess): TokenView {
  return {
    user: {
      id: success.user.id,
      email: success.user.email,
      name: success.user.name,
      role: (success.user.role as 'USER' | 'ADMIN') ?? 'USER',
      createdAt: success.user.createdAt.toISOString(),
    },
    accessToken: success.accessToken,
    refreshToken: success.refreshToken,
    accessTokenExpiresIn: success.accessTokenExpiresIn,
    refreshTokenExpiresIn: success.refreshTokenExpiresIn,
  };
}

export const authController = {
  async register(req: FastifyRequest, reply: FastifyReply): Promise<TokenView> {
    const body = RegisterRequestSchema.parse(req.body);
    const success = await getAuthService().register(body);
    setRefreshCookie(reply, success.refreshToken);
    reply.status(201);
    return toView(success);
  },

  async login(req: FastifyRequest, reply: FastifyReply): Promise<TokenView> {
    const body = LoginRequestSchema.parse(req.body);
    const success = await getAuthService().login(body);
    setRefreshCookie(reply, success.refreshToken);
    return toView(success);
  },

  async refresh(req: FastifyRequest, reply: FastifyReply): Promise<TokenView> {
    const body = RefreshRequestSchema.parse(req.body ?? {});
    const cookieToken = req.cookies[REFRESH_COOKIE];
    const token = body.refreshToken ?? cookieToken;
    if (!token) {
      // Fastify response validation will produce 400 from the route schema;
      // we throw here to short-circuit and use a clean error code.
      throw new (await import('../exceptions/index.js')).BadRequestException(
        'refreshToken is required',
        'REFRESH_REQUIRED'
      );
    }
    const success = await getAuthService().refresh({ refreshToken: token });
    setRefreshCookie(reply, success.refreshToken);
    return toView(success);
  },

  async logout(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = RefreshRequestSchema.parse(req.body ?? {});
    const cookieToken = req.cookies[REFRESH_COOKIE];
    const token = body.refreshToken ?? cookieToken;
    if (token) {
      await getAuthService().logout({ refreshToken: token });
    }
    clearRefreshCookie(reply);
    // Fastify needs explicit reply.send() for 204, otherwise the handler
    // hangs and the healthcheck reports unhealthy.
    reply.status(204).send();
  },
};

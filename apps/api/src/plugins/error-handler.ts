import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '../exceptions/index.js';

/**
 * Registers the centralized error handler directly on the Fastify instance.
 * Must be called on the root instance (not inside a register() context) so
 * it applies to ALL routes — including those added later by autoload and
 * tests.
 *
 * Maps every error type to a consistent JSON envelope:
 *
 *   success: { success: true,  data: T, meta?: ... }
 *   error:   { success: false, error: { message, code, details?, fields? } }
 *
 * Mapping rules (per PLAN.md §10):
 *   - HttpException (our hierarchy)  -> status from exception, body via toJSON()
 *   - ZodError                       -> 400 with error.fields
 *   - Prisma known errors:
 *       P2002 unique violation       -> 409 ConflictException
 *       P2025 record not found       -> 404 NotFoundException
 *       P2003 FK constraint          -> 400 with FK_CONSTRAINT
 *   - Fastify validation (FST_ERR_VALIDATION) -> 400 with fields
 *   - anything else                  -> 500 generic message in prod, real msg in dev
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    // 1. Our own HttpException hierarchy.
    if (err instanceof HttpException) {
      const body = err.toJSON();
      if (err.details !== undefined) {
        body.error.details = err.details;
      }
      return reply.status(err.statusCode).send(body);
    }

    // 2. Zod validation errors (when services/repositories use .parse()).
    if (err instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          fields: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      });
    }

    // 3. Prisma known request errors.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      req.log.warn({ code: err.code, meta: err.meta }, 'prisma error');
      switch (err.code) {
        case 'P2002': {
          const target = Array.isArray(err.meta?.target)
            ? (err.meta.target as string[]).join(', ')
            : String(err.meta?.target ?? '');
          return reply
            .status(409)
            .send(
              new ConflictException(
                `A record with this ${target} already exists`,
                'UNIQUE_CONSTRAINT',
                { target }
              ).toJSON()
            );
        }
        case 'P2025':
          return reply
            .status(404)
            .send(
              new NotFoundException('Resource not found', 'NOT_FOUND').toJSON()
            );
        case 'P2003':
          return reply.status(400).send({
            success: false,
            error: {
              message: 'Foreign key constraint violated',
              code: 'FK_CONSTRAINT',
              fields:
                err.meta?.field_name !== undefined
                  ? [
                      {
                        path: String(err.meta.field_name),
                        message: 'invalid reference',
                      },
                    ]
                  : undefined,
            },
          });
        default:
          // Unknown Prisma code — log and fall through to 500.
          req.log.error({ err }, 'unhandled prisma error code');
          break;
      }
    }

    // 4. Fastify's built-in validation (route schema validation). Detected by
    // `code === 'FST_ERR_VALIDATION'` because there are two branches inside
    // Fastify's wrapValidationError:
    //   - default Ajv path: attaches .validation as an Ajv issue array.
    //   - custom-validator path: validator threw/rejected a pre-formed Error,
    //     and .validation is absent — fall back to a single issue.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'FST_ERR_VALIDATION'
    ) {
      const validation = (
        err as {
          validation?: Array<{ instancePath?: string; message?: string }>;
          validationContext?: string;
        }
      ).validation;
      const context = (err as { validationContext?: string }).validationContext;
      const fields = Array.isArray(validation)
        ? validation.map((v) => ({
            path: v.instancePath ?? '',
            message: v.message ?? 'invalid',
          }))
        : [
            {
              path: '',
              message:
                (err as { message?: string }).message || 'Validation failed',
            },
          ];
      return reply.status(400).send({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          ...(context ? { context } : {}),
          fields,
        },
      });
    }

    // 5. Anything else — generic 500. Don't leak internal details in prod.
    req.log.error({ err }, 'unhandled error');
    const isProd = process.env.NODE_ENV === 'production';
    const message =
      isProd || !(err instanceof Error)
        ? 'Internal Server Error'
        : err.message || 'Internal Server Error';
    return reply
      .status(500)
      .send(
        new InternalServerErrorException(
          message,
          'INTERNAL_SERVER_ERROR'
        ).toJSON()
      );
  });

  // Also wrap "route not found" in our envelope so clients always see the
  // same shape. Fastify's setNotFoundHandler fires BEFORE setErrorHandler,
  // so without this override 404s would fall back to Fastify's default body.
  app.setNotFoundHandler((req, reply) => {
    reply
      .status(404)
      .send(
        new NotFoundException(
          `Route ${req.method}:${req.url} not found`,
          'NOT_FOUND'
        ).toJSON()
      );
  });
}

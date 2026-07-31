import { HttpException } from './http.exception.js';

/** 400 — generic client error / bad input. */
export class BadRequestException extends HttpException {
  constructor(
    message = 'Bad Request',
    code = 'BAD_REQUEST',
    details?: unknown
  ) {
    super(message, 400, code, details);
  }
}

/** 401 — missing or invalid auth credentials. */
export class UnauthorizedException extends HttpException {
  constructor(
    message = 'Unauthorized',
    code = 'UNAUTHORIZED',
    details?: unknown
  ) {
    super(message, 401, code, details);
  }
}

/** 403 — authenticated but not allowed to do this. */
export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden', code = 'FORBIDDEN', details?: unknown) {
    super(message, 403, code, details);
  }
}

/** 404 — resource not found. */
export class NotFoundException extends HttpException {
  constructor(message = 'Not Found', code = 'NOT_FOUND', details?: unknown) {
    super(message, 404, code, details);
  }
}

/** 409 — conflict (e.g., unique constraint, idempotency key reuse). */
export class ConflictException extends HttpException {
  constructor(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    super(message, 409, code, details);
  }
}

/** 422 — validation passed shape but failed semantic rules. */
export class UnprocessableEntityException extends HttpException {
  constructor(
    message = 'Unprocessable Entity',
    code = 'UNPROCESSABLE_ENTITY',
    details?: unknown
  ) {
    super(message, 422, code, details);
  }
}

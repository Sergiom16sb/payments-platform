import { HttpException } from './http.exception.js';

/**
 * 409 — a payment request was made with an idempotency key that has
 * already been used (successfully or not). Lets the client distinguish
 * "retry safely" from "duplicated, abort".
 *
 * Used in PR #11 (payments).
 */
export class IdempotencyConflictException extends HttpException {
  constructor(
    message = 'Payment already processed with this idempotency key',
    code = 'IDEMPOTENCY_CONFLICT',
    details?: unknown
  ) {
    super(message, 409, code, details);
  }
}

/**
 * 402 — payment processor rejected the charge (insufficient funds, expired,
 * fraud-suspected, etc.). Distinct from 503 (processor unavailable).
 *
 * Used in PR #11 (payments) when the processor returns status=REJECTED.
 */
export class PaymentRequiredException extends HttpException {
  constructor(
    message = 'Payment was rejected by the processor',
    code = 'PAYMENT_REJECTED',
    details?: unknown
  ) {
    super(message, 402, code, details);
  }
}

/**
 * Thrown by repositories when a Zod schema rejects a record pulled from the
 * DB — should never happen if writes were validated, but defense in depth.
 * Maps to 500 because it indicates a data-integrity bug, not a client error.
 */
export class DataIntegrityException extends HttpException {
  constructor(
    message = 'Persisted record failed schema validation',
    code = 'DATA_INTEGRITY',
    details?: unknown
  ) {
    super(message, 500, code, details);
  }
}

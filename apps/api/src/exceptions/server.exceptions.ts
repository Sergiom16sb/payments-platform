import { HttpException } from './http.exception.js';

/**
 * 500 — generic server error. Thrown when an internal invariant is broken
 * or a dependency (DB, processor service) fails in an unexpected way.
 */
export class InternalServerErrorException extends HttpException {
  constructor(
    message = 'Internal Server Error',
    code = 'INTERNAL_SERVER_ERROR',
    details?: unknown
  ) {
    super(message, 500, code, details);
  }
}

/** 502 — bad response from upstream dependency. */
export class BadGatewayException extends HttpException {
  constructor(
    message = 'Bad Gateway',
    code = 'BAD_GATEWAY',
    details?: unknown
  ) {
    super(message, 502, code, details);
  }
}

/** 503 — upstream dependency unavailable. Triggers client retry. */
export class ServiceUnavailableException extends HttpException {
  constructor(
    message = 'Service Unavailable',
    code = 'SERVICE_UNAVAILABLE',
    details?: unknown
  ) {
    super(message, 503, code, details);
  }
}

/**
 * 504 — upstream dependency timed out. Triggers client retry.
 * Used by the payments-processor.client when fetch() exceeds the configured timeout.
 */
export class GatewayTimeoutException extends HttpException {
  constructor(
    message = 'Gateway Timeout',
    code = 'GATEWAY_TIMEOUT',
    details?: unknown
  ) {
    super(message, 504, code, details);
  }
}

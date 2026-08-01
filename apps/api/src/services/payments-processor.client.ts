import {
  type ProcessorRequest,
  ProcessorRequestSchema,
  type ProcessorResponse,
  ProcessorResponseSchema,
} from '../dto/payments/payments.schemas.js';
import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '../exceptions/index.js';

/**
 * HTTP client for the Python payment-processor microservice (PLAN §8, §19.4).
 *
 * Contract enforcement:
 *   - REQUEST is validated with ProcessorRequestSchema before sending.
 *   - RESPONSE is validated with ProcessorResponseSchema after receiving.
 *   - A Zod failure on either side throws InternalServerErrorException
 *     upstream (from the caller) — that's a contract bug, not a client bug.
 *
 * Retry policy (per PLAN §19 checklist): exponential backoff
 * 200ms, 800ms, 3200ms — max 3 attempts total. Only retries on:
 *   - HTTP 503 (processor overloaded, matches processor's simulated error rate)
 *   - fetch() network errors / timeout
 * A 4xx from the processor is NOT retried (it means our request was malformed).
 *
 * Timeout: PAYMENTS_PROCESSOR_TIMEOUT_MS (default 5000ms) per attempt,
 * via AbortController.
 */

const RETRY_DELAYS_MS = [200, 800, 3200];

export interface ProcessorClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PaymentsProcessorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: ProcessorClientOptions = {}) {
    this.baseUrl =
      opts.baseUrl ??
      process.env.PAYMENTS_PROCESSOR_URL ??
      'http://processor:8000';
    this.timeoutMs =
      opts.timeoutMs ??
      Number(process.env.PAYMENTS_PROCESSOR_TIMEOUT_MS ?? 5000);
    this.maxRetries =
      opts.maxRetries ??
      Number(process.env.PAYMENTS_PROCESSOR_MAX_RETRIES ?? 3);
  }

  /**
   * Calls POST /process. Retries on 503 and network/timeout errors with
   * exponential backoff. Throws a mapped HttpException on final failure.
   */
  async process(input: ProcessorRequest): Promise<ProcessorResponse> {
    const body = ProcessorRequestSchema.parse(input);
    const url = `${this.baseUrl.replace(/\/$/, '')}/process`;

    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3200);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 503) {
          lastError = new ServiceUnavailableException(
            'Payment processor is temporarily unavailable',
            'PROCESSOR_UNAVAILABLE'
          );
          continue; // retry
        }

        if (!res.ok) {
          // Any other non-2xx is a contract/client bug — don't retry.
          throw new BadGatewayException(
            `Processor returned unexpected status ${res.status}`,
            'PROCESSOR_BAD_RESPONSE'
          );
        }

        const json: unknown = await res.json();
        return ProcessorResponseSchema.parse(json);
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof BadGatewayException) throw err;
        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = new GatewayTimeoutException(
            'Payment processor did not respond in time',
            'PROCESSOR_TIMEOUT'
          );
          continue; // retry
        }
        // Network error (connection refused, DNS, etc.) — retry.
        lastError = new ServiceUnavailableException(
          'Could not reach the payment processor',
          'PROCESSOR_UNREACHABLE'
        );
      }
    }

    throw (
      lastError ??
      new ServiceUnavailableException(
        'Payment processor is temporarily unavailable',
        'PROCESSOR_UNAVAILABLE'
      )
    );
  }

  /**
   * Calls POST /refund. Same retry/timeout policy as process(). The
   * request and response schemas (ProcessorRefundRequestSchema /
   * ProcessorRefundResponseSchema) live in dto/payments/refunds.schemas.ts.
   */
  async processRefund(
    input: import('../dto/payments/refunds.schemas.js').ProcessorRefundRequest
  ): Promise<
    import('../dto/payments/refunds.schemas.js').ProcessorRefundResponse
  > {
    // Lazy import to keep this file from pulling the refund schemas when
    // only /process is used (some test setups don't have Refund loaded).
    const { ProcessorRefundRequestSchema, ProcessorRefundResponseSchema } =
      await import('../dto/payments/refunds.schemas.js');
    const body = ProcessorRefundRequestSchema.parse(input);
    const url = `${this.baseUrl.replace(/\/$/, '')}/refund`;

    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3200);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 503) {
          lastError = new ServiceUnavailableException(
            'Payment processor is temporarily unavailable',
            'PROCESSOR_UNAVAILABLE'
          );
          continue;
        }
        if (!res.ok) {
          throw new BadGatewayException(
            `Processor returned unexpected status ${res.status}`,
            'PROCESSOR_BAD_RESPONSE'
          );
        }
        const json: unknown = await res.json();
        return ProcessorRefundResponseSchema.parse(json);
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof BadGatewayException) throw err;
        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = new GatewayTimeoutException(
            'Payment processor did not respond in time',
            'PROCESSOR_TIMEOUT'
          );
          continue;
        }
        lastError = new ServiceUnavailableException(
          'Could not reach the payment processor',
          'PROCESSOR_UNREACHABLE'
        );
      }
    }

    throw (
      lastError ??
      new ServiceUnavailableException(
        'Payment processor is temporarily unavailable',
        'PROCESSOR_UNAVAILABLE'
      )
    );
  }
}

let _default: PaymentsProcessorClient | undefined;
export function getPaymentsProcessorClient(): PaymentsProcessorClient {
  if (_default) return _default;
  _default = new PaymentsProcessorClient();
  return _default;
}

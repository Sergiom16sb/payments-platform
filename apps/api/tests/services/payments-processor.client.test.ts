import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@/exceptions/index.js';
import { PaymentsProcessorClient } from '@/services/payments-processor.client.js';

const VALID_REQUEST = {
  paymentId: 'ckl123',
  amount: '49.99',
  currency: 'USD',
  cardToken: 'tok_abc',
};

const VALID_RESPONSE = {
  processorRef: 'proc_abc123',
  status: 'APPROVED' as const,
  reason: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PaymentsProcessorClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the parsed response on the first successful call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(VALID_RESPONSE));
    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 3,
    });
    const result = await client.process(VALID_REQUEST);
    expect(result.status).toBe('APPROVED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates the outgoing request with Zod before sending', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(VALID_RESPONSE));
    const client = new PaymentsProcessorClient({ baseUrl: 'http://fake' });
    await expect(
      client.process({ ...VALID_REQUEST, currency: 'usd' }) // lowercase invalid
    ).rejects.toThrow();
  });

  it('rejects a malformed processor response (Zod)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'WEIRD' }));
    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 1,
    });
    await expect(client.process(VALID_REQUEST)).rejects.toThrow();
  });

  it('retries on 503 with exponential backoff, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(VALID_RESPONSE));

    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 3,
    });
    const result = await client.process(VALID_REQUEST);
    expect(result.status).toBe('APPROVED');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it('throws ServiceUnavailableException after exhausting retries on 503', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 2,
    });
    await expect(client.process(VALID_REQUEST)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it('does not retry on a non-503 error status (e.g. 422)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'bad' }, 422));
    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 3,
    });
    await expect(client.process(VALID_REQUEST)).rejects.toBeInstanceOf(
      BadGatewayException
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on network error, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(VALID_RESPONSE));

    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 2,
    });
    const result = await client.process(VALID_REQUEST);
    expect(result.status).toBe('APPROVED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it('throws GatewayTimeoutException on repeated abort/timeout', async () => {
    fetchMock.mockImplementation(() => {
      const err = new DOMException('The operation was aborted', 'AbortError');
      return Promise.reject(err);
    });
    const client = new PaymentsProcessorClient({
      baseUrl: 'http://fake',
      maxRetries: 1,
      timeoutMs: 10,
    });
    await expect(client.process(VALID_REQUEST)).rejects.toBeInstanceOf(
      GatewayTimeoutException
    );
  });
});

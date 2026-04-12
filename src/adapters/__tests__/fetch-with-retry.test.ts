// ---------------------------------------------------------------------------
// Tests for fetch-with-retry — retry logic and rate limiting
// ---------------------------------------------------------------------------

import {
  fetchWithRetry,
  VendorRateLimiter,
  VENDOR_RATE_LIMITS,
  createVendorFetch,
} from '@/adapters/fetch-with-retry';

// ---------------------------------------------------------------------------
// Timer setup — use fake timers so backoff / rate-limit waits resolve
// instantly without real delays.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal Response-like object for mocking globalThis.fetch. */
function mockResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers(headers),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. fetchWithRetry
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchWithRetry', () => {
  it('returns immediately on a successful response without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    globalThis.fetch = mockFetch;

    const response = await fetchWithRetry('https://api.example.com/data');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on HTTP 503 and succeeds on next attempt', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { recovered: true }));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    // Advance past the backoff delay
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 429 (rate limited)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 502', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(502))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 504', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(504))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors (fetch throws)', async () => {
    const networkError = new TypeError('Failed to fetch');
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw networkError;
      }
      return mockResponse(200, { ok: true });
    });
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on HTTP 400 (client error)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(400, { error: 'bad request' }));
    globalThis.fetch = mockFetch;

    const response = await fetchWithRetry('https://api.example.com/data');

    expect(response.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HTTP 401 (unauthorized)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(401));
    globalThis.fetch = mockFetch;

    const response = await fetchWithRetry('https://api.example.com/data');

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HTTP 404 (not found)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(404));
    globalThis.fetch = mockFetch;

    const response = await fetchWithRetry('https://api.example.com/data');

    expect(response.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After header (seconds format)', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);
    await promise;

    // Find the setTimeout call that corresponds to our Retry-After delay.
    // Retry-After: 5 → 5000 ms (capped at maxDelayMs = 30000)
    const delayArgs = setTimeoutSpy.mock.calls.map((call) => call[1]).filter(Boolean);
    expect(delayArgs).toContain(5_000);

    setTimeoutSpy.mockRestore();
  });

  it('respects Retry-After header (HTTP-date format)', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    // With fake timers, Date.now() is deterministic.
    const futureDate = new Date(Date.now() + 3_000).toUTCString();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(503, {}, { 'Retry-After': futureDate }))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data');
    await vi.advanceTimersByTimeAsync(35_000);
    await promise;

    // The delay should be approximately 3000 ms (within tolerance for rounding)
    const delayArgs = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((d): d is number => typeof d === 'number' && d > 1_000 && d <= 30_000);
    expect(delayArgs.length).toBeGreaterThan(0);

    setTimeoutSpy.mockRestore();
  });

  it('caps Retry-After at maxDelayMs', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '120' }))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data', undefined, {
      maxDelayMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(35_000);
    await promise;

    // Retry-After: 120 → 120000 ms, but capped at 10000
    const delayArgs = setTimeoutSpy.mock.calls.map((call) => call[1]).filter(Boolean);
    expect(delayArgs).toContain(10_000);
    // Should NOT contain the uncapped 120000 ms value
    expect(delayArgs).not.toContain(120_000);

    setTimeoutSpy.mockRestore();
  });

  it('throws on final failure after all retries exhausted (network error)', async () => {
    const networkError = new TypeError('Connection refused');
    // Use mockImplementation instead of mockRejectedValue to avoid
    // "PromiseRejectionHandledWarning" from pre-rejected promise objects.
    const mockFetch = vi.fn().mockImplementation(async () => {
      throw networkError;
    });
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data', undefined, { maxRetries: 2 });

    // Attach the rejection handler BEFORE advancing timers to prevent
    // an unhandled rejection window during micro-task processing.
    const resultPromise = promise.then(
      () => ({ threw: false as const }),
      (err: unknown) => ({ threw: true as const, error: err }),
    );

    // Advance timers to let all retries complete.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    const result = await resultPromise;
    expect(result.threw).toBe(true);
    if (result.threw) {
      expect(result.error).toBe(networkError);
    }

    // Initial + 2 retries = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns the last failed response after all retries exhausted (HTTP error)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(503, { error: 'unavailable' }));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data', undefined, {
      maxRetries: 2,
    });
    await vi.advanceTimersByTimeAsync(120_000);

    const response = await promise;
    expect(response.status).toBe(503);
    // Initial + 2 retries = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('forwards request options to underlying fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200));
    globalThis.fetch = mockFetch;

    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 }),
    };

    await fetchWithRetry('https://api.example.com/data', options);

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/data', options);
  });

  it('uses custom retry config when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(503));
    globalThis.fetch = mockFetch;

    const promise = fetchWithRetry('https://api.example.com/data', undefined, {
      maxRetries: 1,
      baseDelayMs: 500,
    });
    await vi.advanceTimersByTimeAsync(35_000);

    await promise;
    // Initial + 1 retry = 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. VendorRateLimiter
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorRateLimiter', () => {
  it('allows requests when under the limit', async () => {
    const limiter = new VendorRateLimiter({ requestsPerMinute: 10 });

    // Should not block for the first few requests
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // If we got here without advancing timers, they completed instantly
    expect(true).toBe(true);
  });

  it('does not block when requestsPerMinute is Infinity', async () => {
    const limiter = new VendorRateLimiter({ requestsPerMinute: Infinity });

    for (let i = 0; i < 100; i++) {
      await limiter.acquire();
    }

    // If we got here without advancing timers, they completed instantly
    expect(true).toBe(true);
  });

  it('blocks when rate limit is exceeded', async () => {
    // Create a limiter that allows only 2 requests per minute
    const limiter = new VendorRateLimiter({ requestsPerMinute: 2 });

    // Use the first two slots
    await limiter.acquire();
    await limiter.acquire();

    // The third call should block because the window is full.
    let resolved = false;
    const acquirePromise = limiter.acquire().then(() => {
      resolved = true;
    });

    // Without advancing time, it should still be pending
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    // Advance time past the 60-second window
    await vi.advanceTimersByTimeAsync(61_000);
    await acquirePromise;
    expect(resolved).toBe(true);
  });

  it('slides the window correctly, allowing requests after old ones expire', async () => {
    const limiter = new VendorRateLimiter({ requestsPerMinute: 2 });

    // Manually inject old timestamps to simulate expired requests
    const timestamps = (limiter as unknown as { timestamps: number[] }).timestamps;
    timestamps.push(Date.now() - 70_000); // 70 seconds ago — outside window
    timestamps.push(Date.now() - 65_000); // 65 seconds ago — outside window

    // Despite two entries, they're outside the 60s window, so acquire should not block
    let resolved = false;
    await limiter.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. VENDOR_RATE_LIMITS
// ═══════════════════════════════════════════════════════════════════════════

describe('VENDOR_RATE_LIMITS', () => {
  it('defines rate limits for all vendor types', () => {
    expect(VENDOR_RATE_LIMITS.PAX8).toEqual({ requestsPerMinute: 60 });
    expect(VENDOR_RATE_LIMITS.INGRAM).toEqual({ requestsPerMinute: 120 });
    expect(VENDOR_RATE_LIMITS.TDSYNNEX).toEqual({ requestsPerMinute: 100 });
    expect(VENDOR_RATE_LIMITS.DIRECT).toEqual({ requestsPerMinute: Infinity });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. createVendorFetch
// ═══════════════════════════════════════════════════════════════════════════

describe('createVendorFetch', () => {
  it('returns a function', () => {
    const vendorFetch = createVendorFetch('PAX8');
    expect(typeof vendorFetch).toBe('function');
  });

  it('returned function makes successful fetch calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, { data: 'test' }));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('PAX8');
    const response = await vendorFetch('https://api.pax8.com/v3/subscriptions');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returned function retries on transient errors', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('INGRAM');
    const promise = vendorFetch('https://api.ingram.com/data');
    await vi.advanceTimersByTimeAsync(35_000);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returned function does not retry on client errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(422));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('TDSYNNEX');
    const response = await vendorFetch('https://api.tdsynnex.com/data');

    expect(response.status).toBe(422);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses DIRECT rate limit (Infinity) without blocking', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('DIRECT');

    // Multiple calls should complete instantly — no rate limit blocking
    await vendorFetch('https://graph.microsoft.com/v1.0/me');
    await vendorFetch('https://graph.microsoft.com/v1.0/users');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('accepts custom retry config overrides', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(503));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('PAX8', { maxRetries: 1 });
    const promise = vendorFetch('https://api.pax8.com/v3/subscriptions');
    await vi.advanceTimersByTimeAsync(35_000);

    await promise;
    // Initial + 1 retry = 2 calls (not the default 4)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('forwards request options through to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200));
    globalThis.fetch = mockFetch;

    const vendorFetch = createVendorFetch('PAX8');
    await vendorFetch('https://api.pax8.com/v3/subscriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer token123' },
      body: JSON.stringify({ quantity: 10 }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pax8.com/v3/subscriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

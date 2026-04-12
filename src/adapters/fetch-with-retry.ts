// ---------------------------------------------------------------------------
// Resilient fetch wrapper for vendor API calls
// ---------------------------------------------------------------------------
// Provides retry logic with exponential backoff + jitter and per-vendor
// outbound rate limiting. This module is infrastructure-only — no logging,
// no adapter-specific logic.
// ---------------------------------------------------------------------------

import type { VendorType } from '@prisma/client';

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts (not including the initial request). */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs: number;
  /** Upper bound on computed delay in milliseconds. */
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/** HTTP status codes that are considered transient and safe to retry. */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the delay before the next retry attempt.
 *
 * Uses exponential backoff with jitter:
 *   delay = min(baseDelay × 2^attempt + random(0, baseDelay), maxDelay)
 *
 * If a `Retry-After` header is present (seconds or HTTP-date), its value
 * takes precedence but is still capped at `maxDelayMs`.
 */
function computeDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader !== null) {
    const parsed = parseRetryAfter(retryAfterHeader);
    if (parsed !== null) {
      return Math.min(parsed, config.maxDelayMs);
    }
  }

  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return Math.min(exponential + jitter, config.maxDelayMs);
}

/**
 * Parses a `Retry-After` header value.
 *
 * Supports two formats defined by RFC 7231 §7.1.3:
 *   - Seconds (integer string, e.g. "120")
 *   - HTTP-date (e.g. "Fri, 31 Dec 1999 23:59:59 GMT")
 *
 * Returns the delay in milliseconds, or `null` if unparseable.
 */
function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}

/** Internal sleep utility. Exported only for testing. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// fetchWithRetry
// ---------------------------------------------------------------------------

/**
 * Wraps the native `fetch()` with retry logic for transient failures.
 *
 * Retries on:
 *   - HTTP 429 (rate limited), 502, 503, 504
 *   - Network errors (when `fetch` itself throws)
 *
 * Does NOT retry on:
 *   - 4xx errors other than 429 (client errors are not transient)
 *
 * On final failure the last error is re-thrown (network error) or a new
 * error is thrown with the last Response status.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryConfig?: Partial<RetryConfig>,
): Promise<Response> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Wait before retrying (skip delay on first attempt)
    if (attempt > 0) {
      const retryAfter = lastResponse?.headers.get('Retry-After') ?? null;
      const delayMs = computeDelay(attempt - 1, config, retryAfter);
      await sleep(delayMs);
    }

    try {
      const response = await fetch(url, options);

      // Success — return immediately
      if (response.ok) {
        return response;
      }

      // Retryable HTTP status — record and continue
      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        lastResponse = response;
        lastError = null;
        continue;
      }

      // Non-retryable HTTP error — fail immediately
      return response;
    } catch (error: unknown) {
      // Network error (DNS, connection refused, etc.) — retryable
      lastError = error;
      lastResponse = null;
    }
  }

  // All retries exhausted
  if (lastError !== null) {
    throw lastError;
  }

  // Return the last failed response so the caller can inspect it
  return lastResponse!;
}

// ---------------------------------------------------------------------------
// VendorRateLimiter
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate limiter for outbound vendor API calls.
 *
 * Tracks request timestamps in an in-memory array and enforces a
 * maximum number of requests per 60-second sliding window.
 *
 * This is per-process / per-instance — no external store is required
 * because the rate limits protect our outbound calls, not inbound ones.
 */
export class VendorRateLimiter {
  private readonly requestsPerMinute: number;
  private readonly timestamps: number[] = [];

  constructor(config: { requestsPerMinute: number }) {
    this.requestsPerMinute = config.requestsPerMinute;
  }

  /**
   * Waits until a request slot is available within the rate limit window.
   *
   * If the current window already contains `requestsPerMinute` requests,
   * `acquire()` sleeps until the oldest request falls out of the window.
   */
  async acquire(): Promise<void> {
    // Infinite limit — no throttling
    if (!Number.isFinite(this.requestsPerMinute)) {
      return;
    }

    const now = Date.now();
    const windowStart = now - 60_000;

    // Slide the window — remove timestamps older than 60 s
    while (this.timestamps.length > 0 && this.timestamps[0]! < windowStart) {
      this.timestamps.shift();
    }

    // If we're at or above the limit, wait for the oldest entry to expire
    if (this.timestamps.length >= this.requestsPerMinute) {
      const oldest = this.timestamps[0]!;
      const waitMs = oldest + 60_000 - now + 1; // +1 ms to ensure it expires
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      // Slide window again after sleeping
      const newNow = Date.now();
      const newWindowStart = newNow - 60_000;
      while (this.timestamps.length > 0 && this.timestamps[0]! < newWindowStart) {
        this.timestamps.shift();
      }
    }

    this.timestamps.push(Date.now());
  }
}

// ---------------------------------------------------------------------------
// Per-vendor rate limit configuration
// ---------------------------------------------------------------------------

export const VENDOR_RATE_LIMITS: Record<VendorType, { requestsPerMinute: number }> = {
  PAX8: { requestsPerMinute: 60 },
  INGRAM: { requestsPerMinute: 120 },
  TDSYNNEX: { requestsPerMinute: 100 },
  DIRECT: { requestsPerMinute: Infinity },
};

// ---------------------------------------------------------------------------
// createVendorFetch
// ---------------------------------------------------------------------------

/**
 * Factory that returns a `fetch`-compatible function pre-configured with:
 *   - Retry logic (exponential backoff + jitter, Retry-After support)
 *   - Per-vendor outbound rate limiting
 *
 * Usage:
 * ```ts
 * const pax8Fetch = createVendorFetch('PAX8');
 * const response = await pax8Fetch('https://api.pax8.com/v3/subscriptions');
 * ```
 */
export function createVendorFetch(
  vendorType: VendorType,
  retryConfig?: Partial<RetryConfig>,
): (url: string, options?: RequestInit) => Promise<Response> {
  const limiter = new VendorRateLimiter(VENDOR_RATE_LIMITS[vendorType]);

  return async (url: string, options?: RequestInit): Promise<Response> => {
    await limiter.acquire();
    return fetchWithRetry(url, options, retryConfig);
  };
}

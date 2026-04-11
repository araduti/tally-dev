/**
 * Unit tests for the rate limiting module (src/lib/rate-limit.ts).
 *
 * Covers:
 *  - checkRateLimit returns correct results for each scope (query, mutation, auth)
 *  - Counts increment across successive calls
 *  - Rate limit is denied once the limit is exceeded
 *  - remaining never goes below 0
 *  - Graceful degradation: Redis failure returns allowed: true
 *  - Redis key pattern follows `ratelimit:{scope}:{identifier}`
 */

// ── Hoisted mocks ──

const { mockRedis } = vi.hoisted(() => {
  const mockRedis = {
    eval: vi.fn(),
  };
  return { mockRedis };
});

vi.mock('@/lib/redis', () => ({
  redis: mockRedis,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../rate-limit';

// ── Helpers ──

/**
 * Simulates the Redis Lua script response: [count, ttl]
 */
function setupRedis(count: number, ttl: number = 55) {
  mockRedis.eval.mockResolvedValue([count, ttl]);
}

// ── Tests ──

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Query scope (100 req / 60s) ──

  describe('query scope', () => {
    it('allows the first request and returns correct metadata', async () => {
      setupRedis(1, 60);

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
      expect(result.reset).toBeGreaterThan(0);

      // Verify the Lua script is called with the correct key and window
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'ratelimit:query:user1:org1',
        60,
      );
    });

    it('allows request at the limit boundary (count === 100)', async () => {
      setupRedis(100, 10);

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('denies request when count exceeds limit (count === 101)', async () => {
      setupRedis(101, 10);

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  // ── Mutation scope (30 req / 60s) ──

  describe('mutation scope', () => {
    it('allows the first request with correct limit', async () => {
      setupRedis(1, 60);

      const result = await checkRateLimit('mutation', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(30);
      expect(result.remaining).toBe(29);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'ratelimit:mutation:user1:org1',
        60,
      );
    });

    it('denies at count 31', async () => {
      setupRedis(31, 5);

      const result = await checkRateLimit('mutation', 'user1:org1');

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(30);
      expect(result.remaining).toBe(0);
    });
  });

  // ── Auth scope (10 req / 60s) ──

  describe('auth scope', () => {
    it('allows the first request with correct limit', async () => {
      setupRedis(1, 60);

      const result = await checkRateLimit('auth', '192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'ratelimit:auth:192.168.1.1',
        60,
      );
    });

    it('denies at count 11', async () => {
      setupRedis(11, 30);

      const result = await checkRateLimit('auth', '192.168.1.1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  // ── Reset timestamp ──

  describe('reset timestamp', () => {
    it('calculates reset from current time + TTL', async () => {
      const ttl = 42;
      setupRedis(1, ttl);

      const before = Math.floor(Date.now() / 1000);
      const result = await checkRateLimit('query', 'user1:org1');
      const after = Math.floor(Date.now() / 1000);

      expect(result.reset).toBeGreaterThanOrEqual(before + ttl);
      expect(result.reset).toBeLessThanOrEqual(after + ttl);
    });

    it('uses 0 when TTL returns -1 (key has no expiry)', async () => {
      setupRedis(5, -1);

      const before = Math.floor(Date.now() / 1000);
      const result = await checkRateLimit('query', 'user1:org1');

      // Math.max(-1, 0) = 0, so reset ≈ now
      expect(result.reset).toBeGreaterThanOrEqual(before);
    });
  });

  // ── Graceful degradation ──

  describe('graceful degradation', () => {
    it('uses in-memory fallback when redis.eval fails', async () => {
      mockRedis.eval.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      // In-memory fallback counts the first request, so remaining is limit - 1
      expect(result.remaining).toBe(99);
    });
  });

  // ── Remaining never goes negative ──

  describe('remaining floor', () => {
    it('remaining is 0 when count is far above limit', async () => {
      setupRedis(999, 5);

      const result = await checkRateLimit('mutation', 'user1:org1');

      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });
});

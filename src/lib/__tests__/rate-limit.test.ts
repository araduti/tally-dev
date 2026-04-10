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
 *  - TTL is set only on the first request in the window
 */

// ── Hoisted mocks ──

const { mockRedis } = vi.hoisted(() => {
  const mockRedis = {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  };
  return { mockRedis };
});

vi.mock('@/lib/redis', () => ({
  redis: mockRedis,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../rate-limit';

// ── Helpers ──

function setupRedis(count: number, ttl: number = 55) {
  mockRedis.incr.mockResolvedValue(count);
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(ttl);
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

      // Verify the correct Redis key
      expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:query:user1:org1');

      // TTL should be set on first request (count === 1)
      expect(mockRedis.expire).toHaveBeenCalledWith('ratelimit:query:user1:org1', 60);
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

    it('does not set TTL on subsequent requests (count > 1)', async () => {
      setupRedis(5, 45);

      await checkRateLimit('query', 'user1:org1');

      expect(mockRedis.expire).not.toHaveBeenCalled();
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
      expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:mutation:user1:org1');
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
      expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:auth:192.168.1.1');
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
    it('returns allowed: true when redis.incr fails', async () => {
      mockRedis.incr.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(100);
    });

    it('returns allowed: true when redis.expire fails after incr succeeds', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockRejectedValue(new Error('ECONNRESET'));

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(100);
    });

    it('returns allowed: true when redis.ttl fails', async () => {
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.ttl.mockRejectedValue(new Error('ECONNRESET'));

      const result = await checkRateLimit('query', 'user1:org1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
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

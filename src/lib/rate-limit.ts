import { redis } from '@/lib/redis';

// ── Types ──

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the current window resets */
  reset: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

// ── Configuration (API-Conventions §10) ──

const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  query:    { maxRequests: 100, windowSeconds: 60 },
  mutation: { maxRequests: 30,  windowSeconds: 60 },
  auth:     { maxRequests: 10,  windowSeconds: 60 },
} as const;

// ── Public API ──

/**
 * Check whether a request is within the rate limit for a given scope/identifier.
 *
 * Uses a fixed-window counter backed by Redis INCR + EXPIRE.
 * Redis key pattern: `ratelimit:{scope}:{identifier}`
 *
 * On Redis failure the function returns `allowed: true` so that a Redis
 * outage never blocks legitimate traffic (graceful degradation).
 */
export async function checkRateLimit(
  scope: 'query' | 'mutation' | 'auth',
  identifier: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_CONFIGS[scope];
  const key = `ratelimit:${scope}:${identifier}`;

  try {
    // INCR is atomic — creates the key with value 1 if it doesn't exist
    const count = await redis.incr(key);

    // Set TTL only on the first request in the window (count === 1)
    if (count === 1) {
      await redis.expire(key, config.windowSeconds);
    }

    // Retrieve the remaining TTL so we can report the reset timestamp
    const ttl = await redis.ttl(key);
    const reset = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);

    const remaining = Math.max(config.maxRequests - count, 0);
    const allowed = count <= config.maxRequests;

    return { allowed, limit: config.maxRequests, remaining, reset };
  } catch {
    // Graceful degradation: if Redis is unavailable, allow the request
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests,
      reset: Math.floor(Date.now() / 1000) + config.windowSeconds,
    };
  }
}

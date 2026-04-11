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

// ── In-Memory Fallback ──
// When Redis is unavailable, use an in-memory fixed-window counter so that
// rate limiting is not silently disabled during outages.

interface InMemoryEntry {
  count: number;
  expiresAt: number; // Unix epoch ms
}

const memoryStore = new Map<string, InMemoryEntry>();

// Periodic cleanup to prevent unbounded memory growth.
// Runs every 60 seconds. Only expires stale entries.
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
      if (entry.expiresAt <= now) {
        memoryStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow Node.js to exit cleanly even if the timer is active
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

function checkInMemoryRateLimit(
  scope: string,
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  ensureCleanupTimer();
  const key = `ratelimit:${scope}:${identifier}`;
  const now = Date.now();

  const entry = memoryStore.get(key);

  if (!entry || entry.expiresAt <= now) {
    // Start a new window
    memoryStore.set(key, {
      count: 1,
      expiresAt: now + config.windowSeconds * 1000,
    });
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      reset: Math.floor(now / 1000) + config.windowSeconds,
    };
  }

  entry.count += 1;
  const remaining = Math.max(config.maxRequests - entry.count, 0);
  const allowed = entry.count <= config.maxRequests;
  const reset = Math.floor(entry.expiresAt / 1000);

  return { allowed, limit: config.maxRequests, remaining, reset };
}

// ── Test Helpers ──

/**
 * Clears the in-memory rate limit store. Only for use in tests.
 */
export function _resetInMemoryStore(): void {
  memoryStore.clear();
}

// ── Public API ──

/**
 * Check whether a request is within the rate limit for a given scope/identifier.
 *
 * Uses a fixed-window counter backed by Redis INCR + EXPIRE.
 * Redis key pattern: `ratelimit:{scope}:{identifier}`
 *
 * On Redis failure the function falls back to an in-memory counter so that
 * rate limiting remains active even during Redis outages.
 */
export async function checkRateLimit(
  scope: 'query' | 'mutation' | 'auth',
  identifier: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_CONFIGS[scope];
  const key = `ratelimit:${scope}:${identifier}`;

  try {
    // Use a Lua script to make INCR + EXPIRE atomic and avoid race conditions
    // where concurrent first-requests each call EXPIRE separately.
    const luaScript = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      return {count, ttl}
    `;
    const [count, ttl] = await redis.eval(
      luaScript, 1, key, config.windowSeconds,
    ) as [number, number];
    const reset = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);

    const remaining = Math.max(config.maxRequests - count, 0);
    const allowed = count <= config.maxRequests;

    return { allowed, limit: config.maxRequests, remaining, reset };
  } catch {
    // Fallback: use in-memory rate limiting instead of silently disabling
    return checkInMemoryRateLimit(scope, identifier, config);
  }
}

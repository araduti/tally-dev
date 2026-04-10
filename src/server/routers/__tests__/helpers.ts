/**
 * Shared test helpers for tRPC router unit tests.
 *
 * These helpers mock the Prisma client, Redis, audit log, encryption,
 * and other infrastructure so router logic can be tested in isolation.
 */
import { vi } from 'vitest';

// ──────────────────────────────────────────────
// Prisma mock — a proxy that returns chainable stubs
// ──────────────────────────────────────────────

function createModelProxy(): any {
  const store: Record<string, any> = {};
  return new Proxy(store, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!store[prop]) {
        store[prop] = vi.fn().mockResolvedValue(null);
      }
      return store[prop];
    },
  });
}

function createDbProxy(): any {
  const models: Record<string, any> = {};
  return new Proxy(models, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!models[prop]) {
        models[prop] = createModelProxy();
      }
      return models[prop];
    },
  });
}

export function createMockDb() {
  return createDbProxy();
}

/**
 * Creates a minimal TRPCContext for testing.
 * All infrastructure dependencies are mocked.
 */
export function createTestContext(overrides: Record<string, any> = {}) {
  return {
    headers: new Headers(),
    userId: 'test-user-id',
    organizationId: 'test-org-id',
    effectiveRole: {
      platformRole: null,
      mspRole: null,
      orgRole: 'ORG_OWNER' as const,
    },
    db: createMockDb(),
    traceId: 'test-trace-id',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Global mocks for modules imported by routers
// ──────────────────────────────────────────────

// Mock @/lib/db
vi.mock('@/lib/db', () => {
  const mockPrisma = createDbProxy();
  return { prisma: mockPrisma, __mockPrisma: mockPrisma };
});

// Mock @/lib/audit
vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// Mock @/lib/encryption
vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn().mockReturnValue('encrypted-credentials'),
  decrypt: vi.fn().mockReturnValue('decrypted-credentials'),
}));

// Mock @/lib/redis
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
  IDEMPOTENCY_TTL: 86400,
}));

// Mock @/lib/rls-proxy
vi.mock('@/lib/rls-proxy', () => ({
  createRLSProxy: vi.fn(() => createDbProxy()),
}));

// ──────────────────────────────────────────────
// Valid CUID for testing (matches z.string().cuid())
// ──────────────────────────────────────────────
export const VALID_CUID = 'clh1234567890abcdefghij00';
export const VALID_CUID_2 = 'clh1234567890abcdefghij01';
export const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Extracts the Zod input schema from a tRPC procedure definition
 * using the _def._input_in property.
 */
export function getInputSchema(procedure: any) {
  return procedure._def?.$types?.input;
}

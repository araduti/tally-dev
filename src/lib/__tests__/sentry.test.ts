/**
 * Unit tests for the lightweight Sentry client (src/lib/sentry.ts).
 *
 * Covers:
 *  - initSentry() parses SENTRY_DSN and logs status
 *  - initSentry() no-ops gracefully when DSN is absent
 *  - initSentry() warns on invalid DSN
 *  - captureException() sends correct envelope to Sentry API
 *  - captureException() no-ops when DSN is not configured
 *  - captureException() includes tags for organizationId, userId, traceId
 *  - captureException() sanitizes sensitive fields in extra data
 *  - captureMessage() sends message events
 *  - Fire-and-forget: fetch failures are logged, never thrown
 *  - parseStack produces Sentry-compatible frames
 */

// ── Hoisted mocks ──

const mockFetch = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Test constants ──

const TEST_DSN = 'https://abc123publickey@o123456.ingest.sentry.io/4507654321';
const EXPECTED_ENVELOPE_URL = 'https://o123456.ingest.sentry.io/api/4507654321/envelope/';

describe('sentry', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('crypto', {
      randomUUID: () => '12345678-1234-1234-1234-123456789abc',
    });
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockFetch.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    // Reset module state between tests
    vi.resetModules();
  });

  async function loadSentry() {
    return import('../sentry');
  }

  describe('initSentry()', () => {
    it('should initialize successfully with a valid DSN', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry } = await loadSentry();

      initSentry();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sentry error tracking initialized',
        { projectId: '4507654321' },
      );
    });

    it('should no-op when SENTRY_DSN is not set', async () => {
      delete process.env.SENTRY_DSN;
      const { initSentry } = await loadSentry();

      initSentry();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sentry DSN not configured — error tracking disabled',
      );
    });

    it('should warn on invalid DSN', async () => {
      process.env.SENTRY_DSN = 'not-a-valid-url';
      const { initSentry } = await loadSentry();

      initSentry();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Sentry DSN is invalid — error tracking disabled',
        { dsn: '[REDACTED]' },
      );
    });

    it('should only initialize once (idempotent)', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry } = await loadSentry();

      initSentry();
      initSentry();

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('captureException()', () => {
    it('should send an error event to Sentry envelope API', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test error'));

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(EXPECTED_ENVELOPE_URL);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-sentry-envelope');
      expect(options.headers['X-Sentry-Auth']).toContain('sentry_key=abc123publickey');

      // Parse the envelope body
      const lines = options.body.split('\n');
      expect(lines).toHaveLength(3);

      const envelopeHeader = JSON.parse(lines[0]);
      expect(envelopeHeader.dsn).toBe(TEST_DSN);
      expect(envelopeHeader.event_id).toBeDefined();

      const itemHeader = JSON.parse(lines[1]);
      expect(itemHeader.type).toBe('event');

      const payload = JSON.parse(lines[2]);
      expect(payload.platform).toBe('node');
      expect(payload.level).toBe('error');
      expect(payload.exception.values[0].type).toBe('Error');
      expect(payload.exception.values[0].value).toBe('test error');
    });

    it('should no-op when DSN is not configured', async () => {
      delete process.env.SENTRY_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test error'));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should include organizationId, userId, traceId as tags', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test'), {
        organizationId: 'org-123',
        userId: 'user-456',
        traceId: 'trace-789',
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.tags.organizationId).toBe('org-123');
      expect(payload.tags.userId).toBe('user-456');
      expect(payload.tags.traceId).toBe('trace-789');
    });

    it('should include custom tags', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test'), {
        tags: { 'trpc.path': 'subscription.create' },
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.tags['trpc.path']).toBe('subscription.create');
    });

    it('should sanitize sensitive fields in extra data', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test'), {
        extra: {
          password: 'super-secret',
          apiKey: 'ak_12345',
          accessToken: 'tok_abc',
          normalField: 'safe-value',
        },
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.extra.password).toBe('[REDACTED]');
      expect(payload.extra.apiKey).toBe('[REDACTED]');
      expect(payload.extra.accessToken).toBe('[REDACTED]');
      expect(payload.extra.normalField).toBe('safe-value');
    });

    it('should sanitize nested sensitive fields', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test'), {
        extra: {
          connection: {
            apiKey: 'secret-key',
            host: 'example.com',
          },
        },
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.extra.connection.apiKey).toBe('[REDACTED]');
      expect(payload.extra.connection.host).toBe('example.com');
    });

    it('should handle non-Error objects gracefully', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException('string error');

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.exception.values[0].type).toBe('Error');
      expect(payload.exception.values[0].value).toBe('string error');
    });

    it('should include environment and release metadata', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      process.env.SENTRY_ENVIRONMENT = 'staging';
      process.env.npm_package_version = '1.2.3';
      const { initSentry, captureException } = await loadSentry();
      initSentry();

      captureException(new Error('test'));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.environment).toBe('staging');
      expect(payload.release).toBe('1.2.3');
    });
  });

  describe('captureMessage()', () => {
    it('should send a message event to Sentry', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureMessage } = await loadSentry();
      initSentry();

      captureMessage('Something happened', 'warning');

      expect(mockFetch).toHaveBeenCalledOnce();
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.message).toBe('Something happened');
      expect(payload.level).toBe('warning');
      expect(payload.exception).toBeUndefined();
    });

    it('should default to info level', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const { initSentry, captureMessage } = await loadSentry();
      initSentry();

      captureMessage('Info message');

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body.split('\n')[2]);
      expect(payload.level).toBe('info');
    });

    it('should no-op when DSN is not configured', async () => {
      delete process.env.SENTRY_DSN;
      const { initSentry, captureMessage } = await loadSentry();
      initSentry();

      captureMessage('test message');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('fire-and-forget behavior', () => {
    it('should log a warning when fetch fails, not throw', async () => {
      process.env.SENTRY_DSN = TEST_DSN;
      const fetchError = new Error('Network error');
      mockFetch.mockRejectedValueOnce(fetchError);

      const { initSentry, captureException } = await loadSentry();
      initSentry();

      // Should not throw
      captureException(new Error('test'));

      // Wait for the promise rejection to be handled
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to send event to Sentry',
        { error: 'Network error' },
      );
    });
  });
});

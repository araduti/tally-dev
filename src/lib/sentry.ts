/**
 * Lightweight Sentry error-tracking client for the Tally application.
 *
 * Sends error events directly to Sentry's envelope API using `fetch`.
 * No heavy @sentry/nextjs dependency — keeps the bundle small.
 *
 * Usage:
 *   import { captureException, captureMessage } from '@/lib/sentry';
 *   captureException(error, { organizationId, userId, traceId });
 *   captureMessage('Something happened', 'warning', { tags: { path: 'subscription.create' } });
 *
 * The client no-ops gracefully when SENTRY_DSN is not set (common in dev).
 */

import { logger } from '@/lib/logger';
import { sanitize } from '@/lib/sensitive-keys';

// ── DSN parsing ────────────────────────────────────────────────────────

interface ParsedDSN {
  publicKey: string;
  host: string;
  projectId: string;
  /** Full envelope endpoint URL */
  envelopeUrl: string;
  /** Original DSN string (used in envelope headers) */
  dsn: string;
}

function parseDSN(dsn: string): ParsedDSN | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    if (!publicKey) return null;

    // Project ID is the last path segment
    const pathParts = url.pathname.split('/').filter(Boolean);
    const projectId = pathParts[pathParts.length - 1];
    if (!projectId) return null;

    // Build the host (without credentials)
    const host = url.host;
    const protocol = url.protocol;

    return {
      publicKey,
      host,
      projectId,
      envelopeUrl: `${protocol}//${host}/api/${projectId}/envelope/`,
      dsn,
    };
  } catch {
    return null;
  }
}

// ── Module-level state ─────────────────────────────────────────────────

const DEFAULT_SERVER_NAME = 'tally-server';

let parsedDSN: ParsedDSN | null = null;
let initialized = false;

// ── Public API ─────────────────────────────────────────────────────────

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface SentryContext {
  /** User / tenant identifiers — attached as Sentry tags */
  organizationId?: string;
  userId?: string;
  traceId?: string;
  /** Extra tags (e.g. procedure path, error code) */
  tags?: Record<string, string>;
  /** Arbitrary extra data (will be sanitized) */
  extra?: Record<string, unknown>;
}

/**
 * Validates the SENTRY_DSN at startup. Call from instrumentation.ts or
 * a top-level server module. Logs a warning if the DSN is absent (dev).
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry DSN not configured — error tracking disabled');
    return;
  }

  const parsed = parseDSN(dsn);
  if (!parsed) {
    logger.warn('Sentry DSN is invalid — error tracking disabled', { dsn: '[REDACTED]' });
    return;
  }

  parsedDSN = parsed;
  logger.info('Sentry error tracking initialized', { projectId: parsed.projectId });
}

/**
 * Captures an exception and sends it to Sentry as a fire-and-forget event.
 * No-ops when SENTRY_DSN is not configured.
 */
export function captureException(error: unknown, context?: SentryContext): void {
  if (!parsedDSN) return;

  const err = error instanceof Error ? error : new Error(String(error));

  const event = buildEvent('error', context);
  event.exception = {
    values: [
      {
        type: err.name,
        value: err.message,
        stacktrace: err.stack ? parseStack(err.stack) : undefined,
      },
    ],
  };

  sendEnvelope(event);
}

/**
 * Captures a message and sends it to Sentry as a fire-and-forget event.
 * No-ops when SENTRY_DSN is not configured.
 */
export function captureMessage(
  message: string,
  level: SentryLevel = 'info',
  context?: SentryContext,
): void {
  if (!parsedDSN) return;

  const event = buildEvent(level, context);
  event.message = message;

  sendEnvelope(event);
}

// ── Internal helpers ───────────────────────────────────────────────────

interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: string;
  level: SentryLevel;
  server_name?: string;
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<StackFrame> };
    }>;
  };
  message?: string;
}

interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

function buildEvent(level: SentryLevel, context?: SentryContext): SentryEvent {
  const tags: Record<string, string> = { ...context?.tags };

  if (context?.organizationId) tags['organizationId'] = context.organizationId;
  if (context?.userId) tags['userId'] = context.userId;
  if (context?.traceId) tags['traceId'] = context.traceId;

  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level,
    server_name: process.env.HOSTNAME ?? DEFAULT_SERVER_NAME,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.npm_package_version ?? undefined,
    tags: Object.keys(tags).length > 0 ? tags : undefined,
    extra: context?.extra ? sanitize(context.extra) : undefined,
  };
}

/**
 * Parses a V8-style stack trace string into Sentry-compatible frames.
 * V8 stack traces list the most recent call first, but Sentry expects
 * frames ordered oldest-first (callers before callees), so we reverse.
 */
function parseStack(stack: string): { frames: StackFrame[] } {
  const frames: StackFrame[] = [];
  const lines = stack.split('\n').slice(1); // skip the error message line

  for (const line of lines) {
    const match = line.match(/^\s+at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?$/);
    if (match) {
      frames.push({
        function: match[1] ?? '<anonymous>',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: !match[2]?.includes('node_modules'),
      });
    }
  }

  // Sentry expects frames in reverse order (oldest first)
  return { frames: frames.reverse() };
}

/**
 * Serializes an event into a Sentry envelope and sends it via fetch.
 * Fire-and-forget: errors are logged but never thrown.
 */
function sendEnvelope(event: SentryEvent): void {
  if (!parsedDSN) return;

  const { envelopeUrl, publicKey, dsn } = parsedDSN;

  // Envelope format: 3 newline-separated JSON lines
  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    dsn,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({
    type: 'event',
    content_type: 'application/json',
  });
  const payload = JSON.stringify(event);
  const body = `${envelopeHeader}\n${itemHeader}\n${payload}`;

  // Fire-and-forget — never block the request
  fetch(envelopeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=tally-sentry/1.0, sentry_key=${publicKey}`,
    },
    body,
  }).catch((fetchError: unknown) => {
    // Log but never throw — Sentry delivery failure must not affect requests
    logger.warn('Failed to send event to Sentry', {
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
    });
  });
}

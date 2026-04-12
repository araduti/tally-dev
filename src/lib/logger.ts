/**
 * Structured logger for the Tally application.
 *
 * Provides a thin abstraction over console methods that outputs structured
 * JSON logs suitable for aggregation tools (Datadog, ELK, CloudWatch, etc.).
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Subscription created', { subscriptionId, organizationId });
 *   logger.error('Vendor API failed', { vendorType, error: err.message });
 *
 * Output format (JSON):
 *   {"level":"info","message":"Subscription created","timestamp":"...","subscriptionId":"...","organizationId":"..."}
 */

import { sanitize } from '@/lib/sensitive-keys';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Minimum log level — configurable via LOG_LEVEL env var.
// Defaults to 'info' in production, 'debug' in development.
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) return envLevel as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

// Use JSON format in production, human-readable in development
function isJsonMode(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const minLevel = getMinLevel();
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta ? sanitize(meta) : {}),
  };

  if (isJsonMode()) {
    const output = JSON.stringify(entry);
    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
        break;
    }
  } else {
    // Human-readable format for development
    const prefix = `[${entry.timestamp}] ${level.toUpperCase()}`;
    const metaStr = meta ? ` ${JSON.stringify(sanitize(meta))}` : '';
    switch (level) {
      case 'error':
        console.error(`${prefix}: ${message}${metaStr}`);
        break;
      case 'warn':
        console.warn(`${prefix}: ${message}${metaStr}`);
        break;
      default:
        console.log(`${prefix}: ${message}${metaStr}`);
        break;
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),

  /**
   * Creates a child logger with pre-bound context fields.
   * Useful for request-scoped logging (traceId, organizationId).
   */
  child: (context: Record<string, unknown>) => ({
    debug: (message: string, meta?: Record<string, unknown>) =>
      log('debug', message, { ...context, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      log('info', message, { ...context, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      log('warn', message, { ...context, ...meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      log('error', message, { ...context, ...meta }),
  }),
};

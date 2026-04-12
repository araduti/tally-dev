/**
 * Shared sensitive-key sanitisation for logs and error reports.
 *
 * Every module that serialises data for external consumption (structured
 * logger, Sentry client, audit exports, etc.) should use `sanitize()` from
 * this module instead of rolling its own redaction logic.
 *
 * The canonical key list lives here so additions propagate everywhere.
 */

/**
 * Keys whose values must never appear in logs, error reports, or analytics.
 * Includes authentication credentials, API keys, encryption material, and
 * vendor-connection identifiers that could be used to impersonate a tenant.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'credentials',
  'token',
  'secret',
  'accessToken',
  'refreshToken',
  'apiKey',
  'encryptionKey',
  'ENCRYPTION_KEY',
  'clientSecret',
  'clientId',
]);

/**
 * Recursively walks an object and replaces values of sensitive keys with
 * `'[REDACTED]'`.  Handles nested plain objects and `Error` instances
 * (extracting message / name / stack, with stack omitted in production).
 *
 * Always returns a **new** object — the input is never mutated.
 */
export function sanitize(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (value instanceof Error) {
      result[key] = {
        message: value.message,
        name: value.name,
        stack:
          process.env.NODE_ENV !== 'production' ? value.stack : undefined,
      };
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Validate environment variables before anything else.
  // This prevents the server from starting with missing or malformed
  // secrets, database URLs, or encryption keys.
  const { validateEnv } = await import('@/lib/env');
  validateEnv();
}

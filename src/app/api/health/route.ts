import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Lightweight health-check endpoint for load-balancer and orchestrator probes.
 * Intentionally avoids database or Redis checks to stay fast and dependency-free.
 */
export function GET() {
  return NextResponse.json(
    {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

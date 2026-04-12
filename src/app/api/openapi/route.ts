import { NextResponse } from 'next/server';

import { buildOpenApiSpec } from '@/lib/openapi';

/**
 * GET /api/openapi
 *
 * Serves the machine-readable OpenAPI 3.1.0 specification for Tally's tRPC API.
 * External consumers (SDK generators, Postman, etc.) fetch this endpoint to
 * discover available procedures.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const spec = buildOpenApiSpec();

  return NextResponse.json(spec, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

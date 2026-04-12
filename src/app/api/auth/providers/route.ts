import { NextResponse } from 'next/server';
import { enabledProviders } from '@/lib/auth';

/**
 * GET /api/auth/providers
 *
 * Returns which social login providers are configured.
 * This endpoint is public — it only exposes boolean flags, never secrets.
 */
export function GET() {
  return NextResponse.json(enabledProviders);
}

import { serializePrometheus } from '@/lib/metrics';

/**
 * GET /api/metrics
 *
 * Prometheus-compatible metrics endpoint.  Returns all registered
 * application metrics in the Prometheus text exposition format.
 *
 * No authentication is required — scrape access should be restricted
 * at the network / infrastructure level (e.g. Kubernetes NetworkPolicy,
 * reverse-proxy ACL, or security group rules).
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body = serializePrometheus();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

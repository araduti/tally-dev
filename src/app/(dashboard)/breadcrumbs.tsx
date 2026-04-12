'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Map URL path segments to human-readable labels. */
const segmentLabels: Record<string, string> = {
  marketplace: 'Marketplace',
  licenses: 'Licenses',
  subscriptions: 'Subscriptions',
  billing: 'Billing',
  compliance: 'Compliance',
  settings: 'Settings',
  import: 'Import',
  create: 'Create',
};

/** UUIDs and other long hex IDs are truncated for display. */
function isIdSegment(segment: string): boolean {
  // Matches UUIDs (with or without dashes) and hex strings ≥ 8 chars
  return /^[0-9a-f]{8,}(?:-[0-9a-f]{4,})*$/i.test(segment);
}

function formatSegment(segment: string): string {
  if (segmentLabels[segment]) return segmentLabels[segment];
  if (isIdSegment(segment)) return `${segment.slice(0, 8)}…`;
  // Fallback: capitalise first letter and replace dashes with spaces
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}

export default function Breadcrumbs() {
  const pathname = usePathname();

  // Root page — no breadcrumbs needed
  if (pathname === '/') return null;

  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = formatSegment(segment);
    const isLast = index === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-slate-400">
        {/* Root "Dashboard" crumb */}
        <li className="flex items-center gap-1.5">
          <Link
            href="/"
            className="hover:text-blue-400 transition-colors"
          >
            Dashboard
          </Link>
        </li>

        {crumbs.map(({ href, label, isLast }) => (
          <li key={href} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-slate-600">/</span>
            {isLast ? (
              <span className="text-slate-200 font-medium" aria-current="page">
                {label}
              </span>
            ) : (
              <Link
                href={href}
                className="hover:text-blue-400 transition-colors"
              >
                {label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

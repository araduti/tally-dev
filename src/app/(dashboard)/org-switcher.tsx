'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/trpc/client';

/** Deterministic background color from the first character of a name. */
function avatarColor(name: string): string {
  const colors = [
    'bg-blue-600',
    'bg-emerald-600',
    'bg-violet-600',
    'bg-amber-600',
    'bg-rose-600',
    'bg-cyan-600',
    'bg-fuchsia-600',
    'bg-lime-600',
  ];
  const code = name.charCodeAt(0) || 0;
  return colors[code % colors.length]!;
}

/** Badge colors per organization type. */
const typeBadge: Record<string, { label: string; className: string }> = {
  MSP: {
    label: 'MSP',
    className: 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30',
  },
  CLIENT: {
    label: 'Client',
    className: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30',
  },
  DIRECT: {
    label: 'Direct',
    className: 'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/30',
  },
};

interface OrgEntry {
  id: string;
  name: string;
  organizationType: string;
}

function OrgTypeBadge({ type }: { type: string }) {
  const badge = typeBadge[type] ?? typeBadge.DIRECT!;
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

function OrgRow({
  org,
  isActive,
  onSelect,
}: {
  org: OrgEntry;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={isActive ? 'true' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition
        ${isActive ? 'bg-slate-600/60 text-white' : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'}`}
      onClick={() => onSelect(org.id)}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(org.name)}`}
        aria-hidden="true"
      >
        {org.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{org.name}</span>
      <OrgTypeBadge type={org.organizationType} />
    </button>
  );
}

function SkeletonPulse() {
  return (
    <div className="flex items-center gap-2 px-3 py-2" aria-busy="true" aria-label="Loading organization">
      <div className="h-8 w-8 animate-pulse rounded-full bg-slate-600" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-24 animate-pulse rounded bg-slate-600" />
        <div className="h-2.5 w-16 animate-pulse rounded bg-slate-600" />
      </div>
    </div>
  );
}

export default function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Data fetching --------------------------------------------------------
  const orgQuery = api.organization.get.useQuery({});
  const currentOrg = orgQuery.data;
  const isMsp = currentOrg?.organizationType === 'MSP';

  const clientsQuery = api.organization.listClients.useQuery(
    {},
    { enabled: isMsp },
  );

  // --- Close dropdown on outside click or Escape ----------------------------
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  // --- Org switch handler ---------------------------------------------------
  const handleSwitch = useCallback(
    (orgId: string) => {
      if (orgId === currentOrg?.id) {
        setOpen(false);
        return;
      }
      window.location.href = `/api/auth/switch-org?orgId=${encodeURIComponent(orgId)}`;
    },
    [currentOrg?.id],
  );

  // --- Loading state --------------------------------------------------------
  if (orgQuery.isLoading) {
    return <SkeletonPulse />;
  }

  if (!currentOrg) {
    return null;
  }

  const clients = clientsQuery.data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch organization, current: ${currentOrg.name}`}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-slate-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(currentOrg.name)}`}
          aria-hidden="true"
        >
          {currentOrg.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-white">
            {currentOrg.name}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {typeBadge[currentOrg.organizationType]?.label ?? 'Organization'}
          </span>
        </span>
        {/* Chevron icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          role="menu"
          aria-label="Organization list"
          className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[220px] overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
        >
          {/* Current organization section */}
          <div className="border-b border-slate-700 p-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Current Organization
            </p>
            <OrgRow
              org={currentOrg}
              isActive
              onSelect={handleSwitch}
            />
          </div>

          {/* Client organizations section (MSP only) */}
          {isMsp && (
            <div className="p-2">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Client Organizations
              </p>

              {clientsQuery.isLoading && (
                <div className="space-y-1 px-2 py-1" aria-busy="true" aria-label="Loading clients">
                  <div className="h-7 animate-pulse rounded bg-slate-700" />
                  <div className="h-7 animate-pulse rounded bg-slate-700" />
                </div>
              )}

              {!clientsQuery.isLoading && clients.length === 0 && (
                <p className="px-2 py-2 text-xs text-slate-500">
                  No client organizations yet.
                </p>
              )}

              {clients.length > 0 && (
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {clients.map((client) => (
                    <OrgRow
                      key={client.id}
                      org={client}
                      isActive={client.id === currentOrg.id}
                      onSelect={handleSwitch}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

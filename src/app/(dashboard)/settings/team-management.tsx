'use client';

import { useState, useCallback, useMemo } from 'react';
import { api } from '@/trpc/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  orgRole: string | null;
  mspRole: string | null;
  createdAt: string;
}

const ORG_ROLES = ['ORG_OWNER', 'ORG_ADMIN', 'ORG_MEMBER'] as const;

function roleBadge(role: string | null): { label: string; className: string } {
  switch (role) {
    case 'ORG_OWNER':
    case 'MSP_OWNER':
      return {
        label: role === 'MSP_OWNER' ? 'MSP Owner' : 'Owner',
        className:
          'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30',
      };
    case 'ORG_ADMIN':
    case 'MSP_ADMIN':
      return {
        label: role === 'MSP_ADMIN' ? 'MSP Admin' : 'Admin',
        className:
          'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30',
      };
    case 'ORG_MEMBER':
      return {
        label: 'Member',
        className:
          'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/30',
      };
    case 'MSP_TECHNICIAN':
      return {
        label: 'Technician',
        className:
          'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30',
      };
    default:
      return {
        label: role ?? 'Unknown',
        className:
          'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/30',
      };
  }
}

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return (name.charAt(0) || '?').toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TeamManagement() {
  const utils = api.useUtils();

  // Data fetching — list members
  const membersQuery = api.organization.listMembers.useQuery({});
  const members = (membersQuery.data?.items ?? []) as MemberRow[];

  // Mutations
  const changeRoleMutation = api.organization.changeMemberRole.useMutation({
    onSuccess: () => utils.organization.listMembers.invalidate(),
  });
  const removeMemberMutation = api.organization.removeMember.useMutation({
    onSuccess: () => utils.organization.listMembers.invalidate(),
  });

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<string>('');
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);

  const allSelected =
    members.length > 0 && selectedIds.size === members.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(members.map((m) => m.id)));
    }
  }, [allSelected, members]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Bulk change role
  const handleBulkChangeRole = useCallback(async () => {
    if (!bulkRole || selectedIds.size === 0) return;
    setBulkActionInProgress(true);
    try {
      const promises = Array.from(selectedIds).map((memberId) =>
        changeRoleMutation.mutateAsync({
          memberId,
          role: bulkRole,
          idempotencyKey: `bulk-role-${memberId}-${bulkRole}-${Date.now()}`,
        }),
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setBulkRole('');
    } finally {
      setBulkActionInProgress(false);
    }
  }, [bulkRole, selectedIds, changeRoleMutation]);

  // Bulk remove
  const handleBulkRemove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkActionInProgress(true);
    try {
      const promises = Array.from(selectedIds).map((memberId) =>
        removeMemberMutation.mutateAsync({
          memberId,
          idempotencyKey: `bulk-remove-${memberId}-${Date.now()}`,
        }),
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
    } finally {
      setBulkActionInProgress(false);
    }
  }, [selectedIds, removeMemberMutation]);

  // Effective role for a member
  const effectiveRole = useCallback(
    (m: MemberRow) => m.orgRole ?? m.mspRole ?? null,
    [],
  );

  // Loading state
  if (membersQuery.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading team members">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-700/50" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Team Members</h2>

      {/* Floating action bar when items are selected */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <span className="text-sm font-medium text-blue-300">
            {selectedIds.size} selected
          </span>

          <div className="flex items-center gap-2 ml-auto">
            {/* Change role dropdown */}
            <select
              aria-label="Bulk change role"
              className="rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={bulkRole}
              onChange={(e) => setBulkRole(e.target.value)}
            >
              <option value="">Change Role…</option>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleBadge(r).label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkRole || bulkActionInProgress}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleBulkChangeRole}
            >
              Apply
            </button>

            {/* Remove button */}
            <button
              type="button"
              disabled={bulkActionInProgress}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleBulkRemove}
            >
              Remove
            </button>

            {/* Deselect */}
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition hover:text-white"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Deselect all"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Member table */}
      <div className="overflow-hidden rounded-lg border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/80">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all members"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                />
              </th>
              <th className="px-4 py-3 font-medium text-slate-400">Member</th>
              <th className="px-4 py-3 font-medium text-slate-400">Role</th>
              <th className="px-4 py-3 font-medium text-slate-400">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No team members found.
                </td>
              </tr>
            )}
            {members.map((member) => {
              const isSelected = selectedIds.has(member.id);
              const role = effectiveRole(member);
              const badge = roleBadge(role);
              const name = member.user.name || 'Unknown';

              return (
                <tr
                  key={member.id}
                  className={`border-b border-slate-700/50 transition ${
                    isSelected ? 'bg-blue-500/5' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${name}`}
                      checked={isSelected}
                      onChange={() => toggleSelect(member.id)}
                      className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
                        aria-hidden="true"
                      >
                        {initials(name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                          {name}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

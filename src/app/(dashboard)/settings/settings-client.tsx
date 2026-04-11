'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/trpc/client';

// ---------- Sync status helpers ----------

const STALE_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Returns true when lastSyncAt is more than 24 hours ago. */
function isSyncStale(lastSyncAt: string | null): boolean {
  if (!lastSyncAt) return false; // never-synced handled separately
  return Date.now() - new Date(lastSyncAt).getTime() > STALE_SYNC_THRESHOLD_MS;
}

/** Human-readable relative time, e.g. "5 minutes ago". */
function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Spinning sync icon (CSS animation). */
function SyncSpinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-blue-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/** Warning icon for stale sync. */
function StaleWarningIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-amber-400 flex-shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Check icon for success. */
function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-green-400 flex-shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ---------- Serialized types ----------

interface SerializedOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  organizationType: string | null;
}

interface SerializedVendorConnection {
  id: string;
  vendorType: string;
  status: string;
  lastSyncAt: string | null;
  createdAt: string;
}

interface SerializedMemberUser {
  id: string;
  name: string | null;
  email: string;
}

interface SerializedMember {
  id: string;
  user: SerializedMemberUser;
  orgRole: string | null;
  mspRole: string | null;
  createdAt: string;
}

interface SerializedInvitation {
  id: string;
  email: string;
  orgRole: string | null;
  mspRole: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface SettingsClientProps {
  initialOrganization: SerializedOrganization | null;
  initialConnections: SerializedVendorConnection[];
  initialMembers: SerializedMember[];
  initialInvitations: SerializedInvitation[];
}

// ---------- Connection status badge ----------

const connectionStatusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-900/50 text-green-400 border-green-700' },
  PENDING: { label: 'Pending', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
  ERROR: { label: 'Error', className: 'bg-red-900/50 text-red-400 border-red-700' },
  DISCONNECTED: { label: 'Disconnected', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
};

function ConnectionStatusBadge({ status }: { status: string }) {
  const config = connectionStatusConfig[status] ?? {
    label: status,
    className: 'bg-slate-700/50 text-slate-400 border-slate-600',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}

// ---------- Organization Section ----------

function OrganizationSection({ initialOrganization }: { initialOrganization: SerializedOrganization | null }) {
  const [orgName, setOrgName] = useState(initialOrganization?.name ?? '');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const updateOrg = api.organization.update.useMutation({
    onSuccess: () => {
      setIsEditing(false);
      setIdempotencyKey(null);
      setSuccessMsg('Organization updated successfully.');
      setTimeout(() => setSuccessMsg(null), 3000);
    },
  });

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setIdempotencyKey(crypto.randomUUID());
    setSuccessMsg(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!idempotencyKey || !orgName.trim()) return;
    updateOrg.mutate({ name: orgName.trim(), idempotencyKey });
  }, [idempotencyKey, orgName, updateOrg]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setIdempotencyKey(null);
    setOrgName(initialOrganization?.name ?? '');
  }, [initialOrganization]);

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
      <h2 className="text-lg font-semibold text-white mb-4">Organization</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="org-name" className="block text-sm font-medium text-slate-300 mb-1">
            Organization Name
          </label>
          <input
            id="org-name"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!isEditing}
            className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            placeholder="Your Organization"
          />
        </div>

        {updateOrg.isError && (
          <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
            {updateOrg.error.message}
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-sm" role="status">
            {successMsg}
          </div>
        )}

        <div className="flex gap-3">
          {!isEditing ? (
            <button
              type="button"
              onClick={handleStartEdit}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateOrg.isPending || !orgName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {updateOrg.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={updateOrg.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Vendor Connection Card (per-connection sync state) ----------

type SyncUiState = 'idle' | 'enqueuing' | 'enqueued' | 'polling' | 'success' | 'error';

function VendorConnectionCard({
  conn,
  onDisconnect,
  disconnectPending,
}: {
  conn: SerializedVendorConnection;
  onDisconnect: (id: string) => void;
  disconnectPending: boolean;
}) {
  const utils = api.useUtils();
  const [syncState, setSyncState] = useState<SyncUiState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncTriggeredAt, setSyncTriggeredAt] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLastSyncAtRef = useRef<string | null>(conn.lastSyncAt);

  const stale = isSyncStale(conn.lastSyncAt);
  const neverSynced = !conn.lastSyncAt;

  const syncMutation = api.vendor.syncCatalog.useMutation({
    onSuccess: () => {
      setSyncState('enqueued');
      setSyncTriggeredAt(new Date().toISOString());
      setSyncError(null);
      // Start polling to detect when the background sync completes
      startPolling();
    },
    onError: (err) => {
      setSyncState('error');
      setSyncError(err.message);
    },
  });

  // Poll listConnections to detect when lastSyncAt changes (sync complete)
  const startPolling = useCallback(() => {
    // Clear existing interval if any
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    setSyncState('polling');
    const baselineLastSyncAt = prevLastSyncAtRef.current;
    let pollCount = 0;
    const maxPolls = 30; // 30 × 5s = 150s max

    pollingRef.current = setInterval(() => {
      pollCount++;
      if (pollCount > maxPolls) {
        // Stop polling after timeout — sync may still be running
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setSyncState('idle');
        return;
      }
      void utils.vendor.listConnections.invalidate();
    }, 5000);

    // Store baseline to compare against
    prevLastSyncAtRef.current = baselineLastSyncAt;
  }, [utils.vendor.listConnections]);

  // Detect sync completion by watching for lastSyncAt changes
  useEffect(() => {
    if (syncState !== 'polling' && syncState !== 'enqueued') return;

    const baseline = prevLastSyncAtRef.current;
    if (conn.lastSyncAt && conn.lastSyncAt !== baseline) {
      // lastSyncAt updated — sync completed
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      prevLastSyncAtRef.current = conn.lastSyncAt;
      setSyncState('success');
      // Clear success indicator after 5 seconds
      const timer = setTimeout(() => setSyncState('idle'), 5000);
      return () => clearTimeout(timer);
    }

    // Also detect ERROR status change during polling
    if (conn.status === 'ERROR' && syncState === 'polling') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setSyncState('error');
      setSyncError('Catalog sync failed. Check your credentials and try again.');
    }
  }, [conn.lastSyncAt, conn.status, syncState]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  const handleSync = useCallback(() => {
    setSyncError(null);
    prevLastSyncAtRef.current = conn.lastSyncAt;
    syncMutation.mutate({
      vendorConnectionId: conn.id,
      idempotencyKey: crypto.randomUUID(),
    });
    setSyncState('enqueuing');
  }, [conn.id, conn.lastSyncAt, syncMutation]);

  const isBusy = syncState === 'enqueuing' || syncState === 'enqueued' || syncState === 'polling';

  return (
    <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
      {/* Row 1: Vendor name, status badge, and action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{conn.vendorType}</span>
          <ConnectionStatusBadge status={conn.status} />
        </div>
        {conn.status !== 'DISCONNECTED' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={isBusy || disconnectPending}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
              aria-label={`Sync catalog for ${conn.vendorType}`}
            >
              {isBusy && <SyncSpinner />}
              {isBusy ? 'Syncing…' : 'Sync Now'}
            </button>
            <button
              type="button"
              onClick={() => onDisconnect(conn.id)}
              disabled={disconnectPending || isBusy}
              className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
              aria-label={`Disconnect ${conn.vendorType}`}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Sync status details */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Last sync timestamp */}
        <div className="text-xs text-slate-400">
          {conn.lastSyncAt ? (
            <>
              Last sync:{' '}
              <time dateTime={conn.lastSyncAt} title={new Date(conn.lastSyncAt).toLocaleString()}>
                {formatRelativeTime(conn.lastSyncAt)}
              </time>
            </>
          ) : (
            <span className="text-slate-500">Never synced</span>
          )}
        </div>

        {/* Sync progress indicator */}
        {syncState === 'enqueuing' && (
          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
            <SyncSpinner /> Requesting sync…
          </span>
        )}
        {(syncState === 'enqueued' || syncState === 'polling') && (
          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
            <SyncSpinner /> Catalog sync in progress…
          </span>
        )}
        {syncState === 'success' && (
          <span className="inline-flex items-center gap-1 text-xs text-green-400" role="status">
            <CheckIcon /> Sync completed successfully
          </span>
        )}
      </div>

      {/* Stale sync warning (DATA:SYNC:STALE) */}
      {stale && syncState === 'idle' && (
        <div
          className="mt-2 flex items-start gap-2 p-2 rounded-md bg-amber-900/20 border border-amber-700/50 text-xs text-amber-300"
          role="alert"
          data-error-code="DATA:SYNC:STALE"
        >
          <StaleWarningIcon />
          <span>
            Catalog data may be outdated — last sync was over 24 hours ago.{' '}
            <button
              type="button"
              onClick={handleSync}
              className="font-medium text-amber-200 underline underline-offset-2 hover:text-white transition"
            >
              Sync Now
            </button>
          </span>
        </div>
      )}

      {/* Never-synced prompt */}
      {neverSynced && conn.status !== 'DISCONNECTED' && syncState === 'idle' && (
        <div
          className="mt-2 flex items-start gap-2 p-2 rounded-md bg-blue-900/20 border border-blue-700/50 text-xs text-blue-300"
          role="status"
        >
          <StaleWarningIcon />
          <span>
            This connection has never been synced.{' '}
            <button
              type="button"
              onClick={handleSync}
              className="font-medium text-blue-200 underline underline-offset-2 hover:text-white transition"
            >
              Run your first sync
            </button>
          </span>
        </div>
      )}

      {/* Sync error with retry */}
      {syncState === 'error' && syncError && (
        <div
          className="mt-2 flex items-start justify-between gap-2 p-2 rounded-md bg-red-900/30 border border-red-700 text-xs text-red-300"
          role="alert"
        >
          <span>{syncError}</span>
          <button
            type="button"
            onClick={handleSync}
            className="flex-shrink-0 font-medium text-red-200 underline underline-offset-2 hover:text-white transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Sync triggered timestamp */}
      {syncTriggeredAt && isBusy && (
        <div className="mt-1 text-xs text-slate-500">
          Sync triggered at{' '}
          <time dateTime={syncTriggeredAt}>
            {new Date(syncTriggeredAt).toLocaleTimeString()}
          </time>
        </div>
      )}
    </div>
  );
}

// ---------- Vendor Connections Section ----------

function VendorConnectionsSection({ initialConnections }: { initialConnections: SerializedVendorConnection[] }) {
  const utils = api.useUtils();
  const [showAddForm, setShowAddForm] = useState(false);
  const [vendorType, setVendorType] = useState('PAX8');
  const [credentials, setCredentials] = useState('');
  const [addIdempotencyKey, setAddIdempotencyKey] = useState<string | null>(null);

  const { data } = api.vendor.listConnections.useQuery(
    {},
    { initialData: { items: initialConnections as any, nextCursor: null } },
  );

  const connections: SerializedVendorConnection[] = (data?.items ?? initialConnections).map((item: any) => ({
    id: item.id,
    vendorType: item.vendorType,
    status: item.status,
    lastSyncAt: item.lastSyncAt
      ? (typeof item.lastSyncAt === 'string' ? item.lastSyncAt : item.lastSyncAt?.toISOString?.() ?? null)
      : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
  }));

  const connectMutation = api.vendor.connect.useMutation({
    onSuccess: () => {
      setShowAddForm(false);
      setAddIdempotencyKey(null);
      setCredentials('');
      void utils.vendor.listConnections.invalidate();
    },
  });

  const disconnectMutation = api.vendor.disconnect.useMutation({
    onSuccess: () => {
      void utils.vendor.listConnections.invalidate();
    },
  });

  const handleOpenAddForm = useCallback(() => {
    setShowAddForm(true);
    setAddIdempotencyKey(crypto.randomUUID());
  }, []);

  const handleCloseAddForm = useCallback(() => {
    setShowAddForm(false);
    setAddIdempotencyKey(null);
    setCredentials('');
  }, []);

  const handleAddConnection = useCallback(() => {
    if (!addIdempotencyKey || !credentials.trim()) return;
    connectMutation.mutate({
      vendorType: vendorType as any,
      credentials: credentials.trim(),
      idempotencyKey: addIdempotencyKey,
    });
  }, [addIdempotencyKey, credentials, vendorType, connectMutation]);

  const handleDisconnect = useCallback((connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    if (conn && window.confirm(`Disconnect ${conn.vendorType}? This will remove stored credentials.`)) {
      disconnectMutation.mutate({ vendorConnectionId: connectionId, idempotencyKey: crypto.randomUUID() });
    }
  }, [connections, disconnectMutation]);

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Vendor Connections</h2>
        {!showAddForm && (
          <button
            type="button"
            onClick={handleOpenAddForm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            Add Connection
          </button>
        )}
      </div>

      {/* Add Connection Form */}
      {showAddForm && (
        <div className="mb-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
          <h3 className="text-sm font-medium text-white mb-3">New Vendor Connection</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="vendor-type" className="block text-sm font-medium text-slate-300 mb-1">
                Vendor Type
              </label>
              <select
                id="vendor-type"
                value={vendorType}
                onChange={(e) => setVendorType(e.target.value)}
                className="w-full max-w-xs px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="PAX8">Pax8</option>
                <option value="INGRAM">Ingram Micro</option>
                <option value="TDSYNNEX">TD Synnex</option>
                <option value="DIRECT">Direct</option>
              </select>
            </div>
            <div>
              <label htmlFor="vendor-credentials" className="block text-sm font-medium text-slate-300 mb-1">
                Credentials (API key or token)
              </label>
              <input
                id="vendor-credentials"
                type="password"
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
                placeholder="Enter API key or token"
                className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {connectMutation.isError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
                {connectMutation.error.message}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleAddConnection}
                disabled={connectMutation.isPending || !credentials.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {connectMutation.isPending ? 'Connecting…' : 'Connect'}
              </button>
              <button
                type="button"
                onClick={handleCloseAddForm}
                disabled={connectMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connections List */}
      {connections.length === 0 ? (
        <p className="text-slate-400 text-sm">
          No vendor connections configured. Connect a distributor to enable catalog sync and purchasing.
        </p>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
            <VendorConnectionCard
              key={conn.id}
              conn={conn}
              onDisconnect={handleDisconnect}
              disconnectPending={disconnectMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Team Members Section ----------

function TeamMembersSection({ initialMembers }: { initialMembers: SerializedMember[] }) {
  const utils = api.useUtils();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'orgRole' | 'mspRole'>('orgRole');
  const [inviteRoleValue, setInviteRoleValue] = useState('ORG_MEMBER');
  const [inviteIdempotencyKey, setInviteIdempotencyKey] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editRoleType, setEditRoleType] = useState<'orgRole' | 'mspRole'>('orgRole');
  const [editRoleValue, setEditRoleValue] = useState('');

  const { data } = api.admin.listMembers.useQuery(
    {},
    { initialData: { items: initialMembers as any, nextCursor: null } },
  );

  const members: SerializedMember[] = (data?.items ?? initialMembers).map((item: any) => ({
    id: item.id,
    user: {
      id: item.user?.id ?? '',
      name: item.user?.name ?? null,
      email: item.user?.email ?? '',
    },
    orgRole: item.orgRole ?? null,
    mspRole: item.mspRole ?? null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
  }));

  const inviteMutation = api.admin.inviteMember.useMutation({
    onSuccess: () => {
      setShowInviteForm(false);
      setInviteIdempotencyKey(null);
      setInviteEmail('');
      void utils.admin.listMembers.invalidate();
    },
  });

  const updateRoleMutation = api.admin.updateRole.useMutation({
    onSuccess: () => {
      setEditingMemberId(null);
      void utils.admin.listMembers.invalidate();
    },
  });

  const removeMemberMutation = api.admin.removeMember.useMutation({
    onSuccess: () => {
      void utils.admin.listMembers.invalidate();
    },
  });

  const handleOpenInviteForm = useCallback(() => {
    setShowInviteForm(true);
    setInviteIdempotencyKey(crypto.randomUUID());
  }, []);

  const handleCloseInviteForm = useCallback(() => {
    setShowInviteForm(false);
    setInviteIdempotencyKey(null);
    setInviteEmail('');
  }, []);

  const handleInvite = useCallback(() => {
    if (!inviteIdempotencyKey || !inviteEmail.trim()) return;
    const input: any = {
      email: inviteEmail.trim(),
      idempotencyKey: inviteIdempotencyKey,
    };
    if (inviteRole === 'orgRole') {
      input.orgRole = inviteRoleValue;
    } else {
      input.mspRole = inviteRoleValue;
    }
    inviteMutation.mutate(input);
  }, [inviteIdempotencyKey, inviteEmail, inviteRole, inviteRoleValue, inviteMutation]);

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Team Members</h2>
        {!showInviteForm && (
          <button
            type="button"
            onClick={handleOpenInviteForm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            Invite Member
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="mb-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
          <h3 className="text-sm font-medium text-white mb-3">Invite Team Member</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-slate-300 mb-1">
                Email Address
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-4">
              <div>
                <label htmlFor="invite-role-type" className="block text-sm font-medium text-slate-300 mb-1">
                  Role Type
                </label>
                <select
                  id="invite-role-type"
                  value={inviteRole}
                  onChange={(e) => {
                    const val = e.target.value as 'orgRole' | 'mspRole';
                    setInviteRole(val);
                    setInviteRoleValue(val === 'orgRole' ? 'ORG_MEMBER' : 'MSP_TECHNICIAN');
                  }}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="orgRole">Organization Role</option>
                  <option value="mspRole">MSP Role</option>
                </select>
              </div>
              <div>
                <label htmlFor="invite-role-value" className="block text-sm font-medium text-slate-300 mb-1">
                  Role
                </label>
                <select
                  id="invite-role-value"
                  value={inviteRoleValue}
                  onChange={(e) => setInviteRoleValue(e.target.value)}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {inviteRole === 'orgRole' ? (
                    <>
                      <option value="ORG_MEMBER">Member</option>
                      <option value="ORG_ADMIN">Admin</option>
                      <option value="ORG_OWNER">Owner</option>
                    </>
                  ) : (
                    <>
                      <option value="MSP_TECHNICIAN">Technician</option>
                      <option value="MSP_ADMIN">Admin</option>
                      <option value="MSP_OWNER">Owner</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {inviteMutation.isError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
                {inviteMutation.error.message}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleInvite}
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {inviteMutation.isPending ? 'Sending…' : 'Send Invitation'}
              </button>
              <button
                type="button"
                onClick={handleCloseInviteForm}
                disabled={inviteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members List */}
      {members.length === 0 ? (
        <p className="text-slate-400 text-sm">
          Manage your team and their roles within the organization.
        </p>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full" aria-label="Team members">
            <thead>
              <tr className="border-b border-slate-700 text-left">
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Email</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Joined</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-slate-700/30 transition">
                  <td className="py-3 text-sm text-white">
                    {member.user.name ?? <span className="text-slate-500">—</span>}
                  </td>
                  <td className="py-3 text-sm text-slate-300">{member.user.email}</td>
                  <td className="py-3 text-sm text-slate-300">
                    {editingMemberId === member.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={editRoleType}
                          onChange={(e) => {
                            const val = e.target.value as 'orgRole' | 'mspRole';
                            setEditRoleType(val);
                            setEditRoleValue(val === 'orgRole' ? 'ORG_MEMBER' : 'MSP_TECHNICIAN');
                          }}
                          className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="orgRole">Org</option>
                          <option value="mspRole">MSP</option>
                        </select>
                        <select
                          value={editRoleValue}
                          onChange={(e) => setEditRoleValue(e.target.value)}
                          className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {editRoleType === 'orgRole' ? (
                            <>
                              <option value="ORG_MEMBER">Member</option>
                              <option value="ORG_ADMIN">Admin</option>
                              <option value="ORG_OWNER">Owner</option>
                            </>
                          ) : (
                            <>
                              <option value="MSP_TECHNICIAN">Technician</option>
                              <option value="MSP_ADMIN">Admin</option>
                              <option value="MSP_OWNER">Owner</option>
                            </>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const input: any = {
                              memberId: member.id,
                              idempotencyKey: crypto.randomUUID(),
                            };
                            if (editRoleType === 'orgRole') input.orgRole = editRoleValue;
                            else input.mspRole = editRoleValue;
                            updateRoleMutation.mutate(input);
                          }}
                          disabled={updateRoleMutation.isPending}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded text-xs font-medium text-white transition"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingMemberId(null)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-white transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      member.orgRole ?? member.mspRole ?? <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-slate-400">
                    <time dateTime={member.createdAt}>
                      {new Date(member.createdAt).toLocaleDateString()}
                    </time>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {editingMemberId !== member.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMemberId(member.id);
                            const currentRole = member.orgRole ?? member.mspRole ?? '';
                            const roleType = member.mspRole ? 'mspRole' : 'orgRole';
                            setEditRoleType(roleType);
                            setEditRoleValue(currentRole);
                          }}
                          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-slate-300 transition"
                          aria-label={`Edit role for ${member.user.name ?? member.user.email}`}
                        >
                          Edit Role
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Remove ${member.user.name ?? member.user.email} from this organization?`)) {
                            removeMemberMutation.mutate({ memberId: member.id, idempotencyKey: crypto.randomUUID() });
                          }
                        }}
                        disabled={removeMemberMutation.isPending}
                        className="px-2 py-1 bg-red-700/50 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-red-300 transition"
                        aria-label={`Remove ${member.user.name ?? member.user.email}`}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(updateRoleMutation.isError || removeMemberMutation.isError) && (
        <div className="mt-3 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
          {updateRoleMutation.error?.message ?? removeMemberMutation.error?.message}
        </div>
      )}
    </div>
  );
}

// ---------- Invitations Section ----------

function InvitationsSection({ initialInvitations }: { initialInvitations: SerializedInvitation[] }) {
  const utils = api.useUtils();

  const { data } = api.admin.listInvitations.useQuery(
    {},
    { initialData: { items: initialInvitations as any, nextCursor: null } },
  );

  const invitations: SerializedInvitation[] = (data?.items ?? initialInvitations).map((item: any) => ({
    id: item.id,
    email: item.email,
    orgRole: item.orgRole ?? null,
    mspRole: item.mspRole ?? null,
    status: item.status,
    expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : item.expiresAt?.toISOString?.() ?? '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
  }));

  const revokeMutation = api.admin.revokeInvitation.useMutation({
    onSuccess: () => {
      void utils.admin.listInvitations.invalidate();
    },
  });

  const statusConfig: Record<string, { label: string; className: string }> = {
    PENDING: { label: 'Pending', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
    ACCEPTED: { label: 'Accepted', className: 'bg-green-900/50 text-green-400 border-green-700' },
    REVOKED: { label: 'Revoked', className: 'bg-red-900/50 text-red-400 border-red-700' },
    EXPIRED: { label: 'Expired', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
      <h2 className="text-lg font-semibold text-white mb-4">Invitations</h2>

      {revokeMutation.isError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
          {revokeMutation.error.message}
        </div>
      )}

      {invitations.length === 0 ? (
        <p className="text-slate-400 text-sm">
          No invitations found. Use the Team Members section above to invite new members.
        </p>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full" aria-label="Invitations">
            <thead>
              <tr className="border-b border-slate-700 text-left">
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Email</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Expires</th>
                <th className="pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {invitations.map((inv) => {
                const config = statusConfig[inv.status] ?? { label: inv.status, className: 'bg-slate-700/50 text-slate-400 border-slate-600' };
                return (
                  <tr key={inv.id} className="hover:bg-slate-700/30 transition">
                    <td className="py-3 text-sm text-white">{inv.email}</td>
                    <td className="py-3 text-sm text-slate-300">
                      {inv.orgRole ?? inv.mspRole ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
                        {config.label}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-slate-400">
                      <time dateTime={inv.expiresAt}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </time>
                    </td>
                    <td className="py-3">
                      {inv.status === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => revokeMutation.mutate({ invitationId: inv.id, idempotencyKey: crypto.randomUUID() })}
                          disabled={revokeMutation.isPending}
                          className="px-2 py-1 bg-red-700/50 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-red-300 transition"
                          aria-label={`Revoke invitation for ${inv.email}`}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- MSP Client Section ----------

function MspClientSection() {
  const utils = api.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientSlug, setClientSlug] = useState('');
  const [billingType, setBillingType] = useState('MANUAL_INVOICE');

  const createClientMutation = api.organization.createClient.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setClientName('');
      setClientSlug('');
      void utils.organization.listClients.invalidate();
    },
  });

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">MSP Client Organizations</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            Create Client
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
          <h3 className="text-sm font-medium text-white mb-3">New Client Organization</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="client-name" className="block text-sm font-medium text-slate-300 mb-1">
                Organization Name
              </label>
              <input
                id="client-name"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="client-slug" className="block text-sm font-medium text-slate-300 mb-1">
                Slug (URL-friendly identifier)
              </label>
              <input
                id="client-slug"
                type="text"
                value={clientSlug}
                onChange={(e) => setClientSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-corp"
                className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="client-billing" className="block text-sm font-medium text-slate-300 mb-1">
                Billing Type
              </label>
              <select
                id="client-billing"
                value={billingType}
                onChange={(e) => setBillingType(e.target.value)}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="MANUAL_INVOICE">Manual Invoice</option>
                <option value="AUTO_CHARGE">Auto Charge</option>
              </select>
            </div>

            {createClientMutation.isError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
                {createClientMutation.error.message}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => createClientMutation.mutate({
                  name: clientName.trim(),
                  slug: clientSlug.trim(),
                  billingType: billingType as any,
                  idempotencyKey: crypto.randomUUID(),
                })}
                disabled={createClientMutation.isPending || !clientName.trim() || !clientSlug.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {createClientMutation.isPending ? 'Creating…' : 'Create Client'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setClientName(''); setClientSlug(''); }}
                disabled={createClientMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-slate-400 text-sm">
        Create and manage client organizations under your MSP. Use the organization switcher to navigate between clients.
      </p>
    </div>
  );
}

// ---------- Danger Zone Section ----------

function DangerZoneSection() {
  const deactivateMutation = api.organization.deactivate.useMutation({
    onSuccess: () => {
      window.location.href = '/';
    },
  });

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-red-700/50">
      <h2 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h2>
      <p className="text-sm text-slate-400 mb-4">
        Deactivating your organization will soft-delete it and prevent all members from accessing it.
        This action can only be reversed by a platform administrator.
      </p>

      {deactivateMutation.isError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
          {deactivateMutation.error.message}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (window.confirm('Are you sure you want to deactivate this organization? This action cannot be easily reversed.')) {
            deactivateMutation.mutate({ idempotencyKey: crypto.randomUUID() });
          }
        }}
        disabled={deactivateMutation.isPending}
        className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
      >
        {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate Organization'}
      </button>
    </div>
  );
}

// ---------- Main SettingsClient component ----------

export function SettingsClient({ initialOrganization, initialConnections, initialMembers, initialInvitations }: SettingsClientProps) {
  const isMsp = initialOrganization?.organizationType === 'MSP';

  return (
    <div>
      <OrganizationSection initialOrganization={initialOrganization} />
      <VendorConnectionsSection initialConnections={initialConnections} />
      <TeamMembersSection initialMembers={initialMembers} />
      <InvitationsSection initialInvitations={initialInvitations} />
      {isMsp && <MspClientSection />}
      <DangerZoneSection />
    </div>
  );
}

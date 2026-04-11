'use client';

import { useState, useCallback } from 'react';
import { api } from '@/trpc/client';

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

  const syncMutation = api.vendor.syncCatalog.useMutation({
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
            <div
              key={conn.id}
              className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg border border-slate-600/50"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white">{conn.vendorType}</span>
                <ConnectionStatusBadge status={conn.status} />
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-slate-400">
                  {conn.lastSyncAt ? (
                    <>
                      Last sync:{' '}
                      <time dateTime={conn.lastSyncAt}>
                        {new Date(conn.lastSyncAt).toLocaleString()}
                      </time>
                    </>
                  ) : (
                    'Never synced'
                  )}
                </div>
                {conn.status !== 'DISCONNECTED' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => syncMutation.mutate({ vendorConnectionId: conn.id, idempotencyKey: crypto.randomUUID() })}
                      disabled={syncMutation.isPending}
                      className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                      aria-label={`Sync catalog for ${conn.vendorType}`}
                    >
                      {syncMutation.isPending ? 'Syncing…' : 'Sync'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Disconnect ${conn.vendorType}? This will remove stored credentials.`)) {
                          disconnectMutation.mutate({ vendorConnectionId: conn.id, idempotencyKey: crypto.randomUUID() });
                        }
                      }}
                      disabled={disconnectMutation.isPending}
                      className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                      aria-label={`Disconnect ${conn.vendorType}`}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>
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

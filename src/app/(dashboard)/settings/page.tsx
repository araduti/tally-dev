import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { SettingsClient } from './settings-client';

function SettingsLoadingSkeleton() {
  return (
    <>
      {/* Organization skeleton */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="h-5 w-24 bg-slate-700 rounded animate-pulse mb-4" />
        <div className="h-10 w-full max-w-md bg-slate-700/50 rounded-lg animate-pulse mb-4" />
        <div className="h-9 w-20 bg-slate-700 rounded-lg animate-pulse" />
      </div>
      {/* Vendor Connections skeleton */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-36 bg-slate-700 rounded animate-pulse" />
          <div className="h-9 w-28 bg-slate-700 rounded-lg animate-pulse" />
        </div>
        <div className="h-4 w-64 bg-slate-700/50 rounded animate-pulse" />
      </div>
      {/* Team Members skeleton */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-28 bg-slate-700 rounded animate-pulse" />
          <div className="h-9 w-28 bg-slate-700 rounded-lg animate-pulse" />
        </div>
        <div className="h-4 w-48 bg-slate-700/50 rounded animate-pulse" />
      </div>
    </>
  );
}

async function SettingsContent() {
  const [orgResult, connectionsResult, membersResult, invitationsResult] = await Promise.allSettled([
    api.organization.get({}),
    api.vendor.listConnections({}),
    api.admin.listMembers({}),
    api.admin.listInvitations({}),
  ]);

  // Serialize organization
  let serializedOrg = null;
  if (orgResult.status === 'fulfilled') {
    const org: any = orgResult.value;
    serializedOrg = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo ?? null,
      organizationType: org.organizationType ?? null,
    };
  }

  // Serialize vendor connections
  let serializedConnections: any[] = [];
  if (connectionsResult.status === 'fulfilled') {
    serializedConnections = connectionsResult.value.items.map((item: any) => ({
      id: item.id,
      vendorType: item.vendorType,
      status: item.status,
      lastSyncAt: item.lastSyncAt instanceof Date
        ? item.lastSyncAt.toISOString()
        : (item.lastSyncAt ?? null),
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    }));
  }

  // Serialize team members
  let serializedMembers: any[] = [];
  if (membersResult.status === 'fulfilled') {
    serializedMembers = membersResult.value.items.map((item: any) => ({
      id: item.id,
      user: {
        id: item.user.id,
        name: item.user.name ?? null,
        email: item.user.email,
      },
      orgRole: item.orgRole ?? null,
      mspRole: item.mspRole ?? null,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    }));
  }

  // Serialize invitations
  let serializedInvitations: any[] = [];
  if (invitationsResult.status === 'fulfilled') {
    serializedInvitations = invitationsResult.value.items.map((item: any) => ({
      id: item.id,
      email: item.email,
      orgRole: item.orgRole ?? null,
      mspRole: item.mspRole ?? null,
      status: item.status,
      expiresAt: item.expiresAt instanceof Date ? item.expiresAt.toISOString() : item.expiresAt,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    }));
  }

  return (
    <SettingsClient
      initialOrganization={serializedOrg}
      initialConnections={serializedConnections}
      initialMembers={serializedMembers}
      initialInvitations={serializedInvitations}
    />
  );
}

export default async function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">Organization settings, vendor connections, and team management</p>
      </div>

      <Suspense fallback={<SettingsLoadingSkeleton />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

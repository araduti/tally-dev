import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { ComplianceClient } from './compliance-client';

function ComplianceLoadingSkeleton() {
  return (
    <>
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="h-5 w-24 skeleton-shimmer rounded-lg mb-4" />
          <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="h-5 w-28 skeleton-shimmer rounded-lg mb-4" />
          <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="h-5 w-20 skeleton-shimmer rounded-lg" />
        </div>
        <div className="p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 skeleton-shimmer rounded-lg" />
          ))}
        </div>
      </div>
    </>
  );
}

async function ComplianceContent() {
  // Use Promise.allSettled so one failure doesn't block the others
  const [auditLogsResult, dpaResult] = await Promise.allSettled([
    api.admin.listAuditLogs({}),
    api.organization.getDpaStatus({}),
  ]);

  // Parse audit logs
  let serializedAuditLogs: any[] = [];
  let auditLogNextCursor: string | null = null;

  if (auditLogsResult.status === 'fulfilled') {
    serializedAuditLogs = auditLogsResult.value.items.map((item: any) => ({
      id: item.id,
      action: item.action,
      entityId: item.entityId ?? null,
      userId: item.userId ?? null,
      user: item.user
        ? { name: item.user.name ?? null, email: item.user.email }
        : null,
      traceId: item.traceId ?? null,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    }));
    auditLogNextCursor = auditLogsResult.value.nextCursor;
  }

  // Parse DPA status — serialize acceptedAt to ISO string and acceptedBy to display name
  const rawDpa = dpaResult.status === 'fulfilled'
    ? dpaResult.value
    : { accepted: false, requiredVersion: '1.0', acceptedVersion: null, isOutdated: true, acceptedAt: null, acceptedBy: null };

  const dpaStatus = {
    accepted: rawDpa.accepted,
    version: rawDpa.acceptedVersion,
    requiredVersion: rawDpa.requiredVersion,
    isOutdated: rawDpa.isOutdated,
    acceptedAt: rawDpa.acceptedAt instanceof Date
      ? rawDpa.acceptedAt.toISOString()
      : rawDpa.acceptedAt,
    acceptedBy: rawDpa.acceptedBy && typeof rawDpa.acceptedBy === 'object'
      ? (rawDpa.acceptedBy.name ?? rawDpa.acceptedBy.email)
      : rawDpa.acceptedBy,
  };

  return (
    <ComplianceClient
      dpaStatus={dpaStatus}
      initialAuditLogs={serializedAuditLogs}
      initialNextCursor={auditLogNextCursor}
    />
  );
}

export default async function CompliancePage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Compliance</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">DPA status, contract signing, and audit trail</p>
      </div>

      <Suspense fallback={<ComplianceLoadingSkeleton />}>
        <ComplianceContent />
      </Suspense>
    </div>
  );
}

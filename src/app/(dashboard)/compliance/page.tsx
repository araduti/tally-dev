import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { ComplianceClient } from './compliance-client';

function ComplianceLoadingSkeleton() {
  return (
    <>
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-24 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-28 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
        </div>
      </div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="h-5 w-20 bg-slate-700 rounded animate-pulse" />
        </div>
        <div className="p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-slate-700/50 rounded animate-pulse" />
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
    : { accepted: false, version: null, acceptedAt: null, acceptedBy: null };

  const dpaStatus = {
    accepted: rawDpa.accepted,
    version: rawDpa.version,
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
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Compliance</h1>
        <p className="mt-1 text-slate-400">DPA status, contract signing, and audit trail</p>
      </div>

      <Suspense fallback={<ComplianceLoadingSkeleton />}>
        <ComplianceContent />
      </Suspense>
    </div>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { api } from '@/trpc/client';

// ---------- Serialized types ----------

interface SerializedAuditLogUser {
  name: string | null;
  email: string;
}

interface SerializedAuditLog {
  id: string;
  action: string;
  entityId: string | null;
  userId: string | null;
  user: SerializedAuditLogUser | null;
  traceId: string | null;
  createdAt: string;
}

interface DpaStatusData {
  accepted: boolean;
  version: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export interface ComplianceClientProps {
  dpaStatus: DpaStatusData;
  initialAuditLogs: SerializedAuditLog[];
  initialNextCursor: string | null;
}

// ---------- DPA Status Card ----------

function DpaStatusCard({ dpaStatus }: { dpaStatus: DpaStatusData }) {
  const utils = api.useUtils();

  const acceptDpaMutation = api.organization.acceptDpa.useMutation({
    onSuccess: () => {
      void utils.organization.getDpaStatus.invalidate();
    },
  });

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <h2 className="text-lg font-semibold text-white mb-4">DPA Status</h2>
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`w-3 h-3 rounded-full ${dpaStatus.accepted ? 'bg-green-400' : 'bg-yellow-400'}`}
          aria-hidden="true"
        />
        <span className="text-slate-300">
          {dpaStatus.accepted ? 'Accepted' : 'Not yet accepted'}
        </span>
      </div>
      {dpaStatus.accepted && (
        <div className="space-y-1 text-sm text-slate-400">
          {dpaStatus.version && <p>Version: <span className="text-slate-300">{dpaStatus.version}</span></p>}
          {dpaStatus.acceptedAt && (
            <p>
              Accepted on:{' '}
              <time dateTime={dpaStatus.acceptedAt} className="text-slate-300">
                {new Date(dpaStatus.acceptedAt).toLocaleDateString()}
              </time>
            </p>
          )}
          {dpaStatus.acceptedBy && <p>By: <span className="text-slate-300">{dpaStatus.acceptedBy}</span></p>}
        </div>
      )}
      {!dpaStatus.accepted && (
        <div>
          <p className="text-sm text-slate-400 mt-2 mb-4">
            Accept the Data Processing Agreement to enable vendor connections and purchasing.
          </p>

          {acceptDpaMutation.isError && (
            <div className="mb-3 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
              {acceptDpaMutation.error.message}
            </div>
          )}

          {acceptDpaMutation.isSuccess && (
            <div className="mb-3 p-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-sm" role="status">
              DPA accepted successfully.
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              acceptDpaMutation.mutate({
                version: '2024-01',
                idempotencyKey: crypto.randomUUID(),
              });
            }}
            disabled={acceptDpaMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
          >
            {acceptDpaMutation.isPending ? 'Accepting…' : 'Accept DPA (v2024-01)'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Contract Status Card ----------

function ContractStatusCard() {
  const utils = api.useUtils();

  const { data: contractStatus } = api.organization.getContractStatus.useQuery({});
  const signContractMutation = api.organization.signContract.useMutation({
    onSuccess: () => {
      void utils.organization.getContractStatus.invalidate();
    },
  });

  const isSigned = contractStatus?.isContractSigned ?? false;

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <h2 className="text-lg font-semibold text-white mb-4">Contract Status</h2>
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`w-3 h-3 rounded-full ${isSigned ? 'bg-green-400' : 'bg-yellow-400'}`}
          aria-hidden="true"
        />
        <span className="text-slate-300">
          {isSigned ? 'Signed' : 'Unsigned'}
        </span>
      </div>
      {isSigned ? (
        <div className="space-y-1 text-sm text-slate-400">
          <p>Contract signed. Provisioning is enabled.</p>
        </div>
      ) : (
        <div>
          <p className="text-sm text-slate-400 mt-2 mb-4">
            Contract signing is required before provisioning can be enabled.
          </p>

          {signContractMutation.isError && (
            <div className="mb-3 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
              {signContractMutation.error.message}
            </div>
          )}

          {signContractMutation.isSuccess && (
            <div className="mb-3 p-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-sm" role="status">
              Contract signed successfully. Provisioning is now enabled.
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              signContractMutation.mutate({
                idempotencyKey: crypto.randomUUID(),
              });
            }}
            disabled={signContractMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
          >
            {signContractMutation.isPending ? 'Signing…' : 'Sign Contract'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Main ComplianceClient component ----------

export function ComplianceClient({ dpaStatus, initialAuditLogs, initialNextCursor }: ComplianceClientProps) {
  const [cursor, setCursor] = useState<string | null>(null);

  // Client-side pagination for audit logs
  const { data, isLoading } = api.admin.listAuditLogs.useQuery(
    { cursor: cursor ?? undefined },
    {
      initialData: !cursor ? { items: initialAuditLogs as any, nextCursor: initialNextCursor } : undefined,
    },
  );

  const auditLogs: SerializedAuditLog[] = (data?.items ?? initialAuditLogs).map((item: any) => ({
    id: item.id,
    action: item.action,
    entityId: item.entityId ?? null,
    userId: item.userId ?? null,
    user: item.user
      ? { name: item.user.name ?? null, email: item.user.email }
      : null,
    traceId: item.traceId ?? null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
  }));

  const nextCursor = data?.nextCursor ?? null;

  const handleNextPage = useCallback(() => {
    if (nextCursor) setCursor(nextCursor);
  }, [nextCursor]);

  const handleFirstPage = useCallback(() => {
    setCursor(null);
  }, []);

  return (
    <div>
      {/* Status Cards */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <DpaStatusCard dpaStatus={dpaStatus} />
        <ContractStatusCard />
      </div>

      {/* Audit Log Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Audit Log</h2>
          {cursor && (
            <button
              type="button"
              onClick={handleFirstPage}
              className="text-sm text-blue-400 hover:text-blue-300 transition"
            >
              ← Back to first page
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3" aria-label="Loading audit logs">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-slate-700/50 rounded animate-pulse" />
            ))}
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No audit entries yet. Actions will be logged here automatically.
          </div>
        ) : (
          <>
            <table className="w-full" aria-label="Audit log entries">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Action</th>
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Entity</th>
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-700/30 transition">
                    <td className="px-6 py-4 text-sm">
                      <code className="text-blue-400 bg-blue-900/20 px-1.5 py-0.5 rounded text-xs">
                        {log.action}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {log.user?.name ?? log.user?.email ?? <span className="text-slate-500">System</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 font-mono text-xs">
                      {log.entityId ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {log.createdAt ? (
                        <time dateTime={log.createdAt}>
                          {new Date(log.createdAt).toLocaleString()}
                        </time>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {nextCursor && (
              <div className="px-6 py-3 border-t border-slate-700 flex justify-end">
                <button
                  type="button"
                  onClick={handleNextPage}
                  className="px-4 py-2 text-sm text-blue-400 hover:text-blue-300 transition"
                >
                  Load more →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

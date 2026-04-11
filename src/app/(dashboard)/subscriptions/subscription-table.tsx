'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/trpc/client';

// ---------- Serialized types ----------

interface SerializedBundle {
  id: string;
  name: string;
}

interface SerializedSubscription {
  id: string;
  status: string;
  externalId: string | null;
  commitmentEndDate: string | null;
  createdAt: string;
  bundle: SerializedBundle;
  vendorType: string | null;
}

export interface SubscriptionTableProps {
  initialSubscriptions: SerializedSubscription[];
  initialNextCursor: string | null;
}

// ---------- Status badge ----------

const statusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-900/50 text-green-400 border-green-700' },
  SUSPENDED: { label: 'Suspended', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-900/50 text-red-400 border-red-700' },
  EXPIRED: { label: 'Expired', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? {
    label: status,
    className: 'bg-slate-700/50 text-slate-400 border-slate-600',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}

// ---------- Cancel Dialog ----------

interface CancelDialogProps {
  subscription: SerializedSubscription;
  onClose: () => void;
  onSuccess: () => void;
}

function CancelDialog({ subscription, onClose, onSuccess }: CancelDialogProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = api.subscription.cancel.useMutation({
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const commitmentEnd = subscription.commitmentEndDate;
  const isCommitted = commitmentEnd && new Date(commitmentEnd) > new Date();

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel subscription"
    >
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold text-white mb-2">Cancel Subscription</h3>
        <p className="text-sm text-slate-400 mb-4">
          Are you sure you want to cancel <strong className="text-white">{subscription.bundle.name}</strong>?
        </p>

        {isCommitted && (
          <div
            className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700 text-yellow-300 text-sm"
            role="alert"
          >
            <strong>⚠ Non-refundable until {new Date(commitmentEnd).toLocaleDateString()}.</strong>{' '}
            Cancellation will be scheduled for the commitment end date.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={cancelMutation.isPending}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
          >
            Keep Subscription
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              cancelMutation.mutate({
                subscriptionId: subscription.id,
                idempotencyKey,
              });
            }}
            disabled={cancelMutation.isPending}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
          >
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Subscription'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main SubscriptionTable component ----------

export function SubscriptionTable({ initialSubscriptions, initialNextCursor }: SubscriptionTableProps) {
  const utils = api.useUtils();
  const router = useRouter();

  const { data } = api.subscription.list.useQuery(
    {},
    { initialData: { items: initialSubscriptions as any, nextCursor: initialNextCursor } },
  );

  const subscriptions: SerializedSubscription[] = (data?.items ?? initialSubscriptions).map((item: any) => ({
    id: item.id,
    status: item.status,
    externalId: item.externalId ?? null,
    commitmentEndDate: item.commitmentEndDate
      ? (typeof item.commitmentEndDate === 'string'
        ? item.commitmentEndDate
        : item.commitmentEndDate?.toISOString?.() ?? null)
      : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
    bundle: {
      id: item.bundle?.id ?? '',
      name: item.bundle?.name ?? 'Unknown',
    },
    vendorType: item.vendorConnection?.vendorType ?? item.vendorType ?? null,
  }));

  const [cancelTarget, setCancelTarget] = useState<SerializedSubscription | null>(null);

  const handleCancelSuccess = useCallback(() => {
    setCancelTarget(null);
    void utils.subscription.list.invalidate();
  }, [utils]);

  const handleRowClick = useCallback((subscriptionId: string) => {
    router.push(`/subscriptions/${subscriptionId}`);
  }, [router]);

  return (
    <>
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full" aria-label="Subscriptions">
          <thead>
            <tr className="border-b border-slate-700 text-left">
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Bundle</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distributor</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Commitment End</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {subscriptions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  No subscriptions found. Visit the Marketplace to purchase.
                </td>
              </tr>
            ) : (
              subscriptions.map((sub) => (
                <tr
                  key={sub.id}
                  className="hover:bg-slate-700/30 transition cursor-pointer"
                  onClick={() => handleRowClick(sub.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(sub.id);
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`View details for ${sub.bundle.name} subscription`}
                >
                  <td className="px-6 py-4 text-sm text-white font-medium">
                    <span className="text-blue-400 hover:text-blue-300">
                      {sub.bundle.name}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">
                    {sub.vendorType ?? <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={sub.status} />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">
                    {sub.commitmentEndDate ? (
                      <time dateTime={sub.commitmentEndDate}>
                        {new Date(sub.commitmentEndDate).toLocaleDateString()}
                      </time>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {sub.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelTarget(sub);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs font-medium text-white transition"
                        aria-label={`Cancel ${sub.bundle.name} subscription`}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {cancelTarget && (
        <CancelDialog
          subscription={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSuccess={handleCancelSuccess}
        />
      )}
    </>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { api } from '@/trpc/client';

// ---------- Serialized types (Date→ISO string, Decimal→string) ----------

interface SerializedProductOffering {
  id: string;
  effectiveUnitCost: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
}

interface SerializedBundle {
  id: string;
  name: string;
}

interface SerializedSubscription {
  id: string;
  commitmentEndDate: string | null;
  bundle: SerializedBundle;
}

interface SerializedLicense {
  id: string;
  quantity: number;
  pendingQuantity: number | null;
  inngestRunId: string | null;
  createdAt: string;
  subscription: SerializedSubscription;
  productOffering: SerializedProductOffering | null;
}

export interface LicenseTableProps {
  initialLicenses: SerializedLicense[];
  initialNextCursor: string | null;
}

// ---------- Status badge ----------

type LicenseStatus = 'ACTIVE' | 'PENDING_SCALE_DOWN' | 'INACTIVE';

function deriveLicenseStatus(license: SerializedLicense): LicenseStatus {
  if (license.pendingQuantity !== null) return 'PENDING_SCALE_DOWN';
  if (license.quantity > 0) return 'ACTIVE';
  return 'INACTIVE';
}

const statusConfig: Record<LicenseStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-900/50 text-green-400 border-green-700' },
  PENDING_SCALE_DOWN: { label: 'Pending Scale Down', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
  INACTIVE: { label: 'Inactive', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
};

function StatusBadge({ status }: { status: LicenseStatus }) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}

// ---------- Scale Modal ----------

interface ScaleModalProps {
  license: SerializedLicense;
  direction: 'up' | 'down';
  onClose: () => void;
  onSuccess: () => void;
}

function ScaleModal({ license, direction, onClose, onSuccess }: ScaleModalProps) {
  const [newQuantity, setNewQuantity] = useState<number>(
    direction === 'up' ? license.quantity + 1 : Math.max(0, license.quantity - 1),
  );
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const scaleUp = api.license.scaleUp.useMutation({
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const scaleDown = api.license.scaleDown.useMutation({
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const isLoading = scaleUp.isPending || scaleDown.isPending;

  const handleSubmit = () => {
    setError(null);
    if (direction === 'up') {
      scaleUp.mutate({ licenseId: license.id, newQuantity, idempotencyKey });
    } else {
      scaleDown.mutate({ licenseId: license.id, newQuantity, idempotencyKey });
    }
  };

  const min = direction === 'up'
    ? license.quantity + 1
    : (license.productOffering?.minQuantity ?? 0);
  const max = direction === 'up'
    ? (license.productOffering?.maxQuantity ?? 999999)
    : license.quantity - 1;

  const commitmentEnd = license.subscription.commitmentEndDate;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Scale ${direction} license`}
    >
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold text-white mb-4">
          Scale {direction === 'up' ? 'Up' : 'Down'}: {license.subscription.bundle.name}
        </h3>

        {direction === 'down' && commitmentEnd && (
          <div
            className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700 text-yellow-300 text-sm"
            role="alert"
          >
            <strong>⚠ Non-refundable until {new Date(commitmentEnd).toLocaleDateString()}.</strong>{' '}
            This scale-down will be staged and applied after the commitment window ends.
          </div>
        )}

        <div className="mb-4">
          <p className="text-sm text-slate-400 mb-2">
            Current quantity: <span className="text-white font-medium">{license.quantity}</span>
          </p>
          <label htmlFor="new-quantity" className="block text-sm font-medium text-slate-300 mb-1">
            New Quantity
          </label>
          <input
            id="new-quantity"
            type="number"
            min={min}
            max={max}
            value={newQuantity}
            onChange={(e) => setNewQuantity(parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
          >
            {isLoading ? 'Processing…' : `Scale ${direction === 'up' ? 'Up' : 'Down'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main LicenseTable component ----------

export function LicenseTable({ initialLicenses, initialNextCursor }: LicenseTableProps) {
  const utils = api.useUtils();

  // Client-side refetch for real-time updates
  const { data } = api.license.list.useQuery(
    {},
    { initialData: { items: initialLicenses as any, nextCursor: initialNextCursor } },
  );

  const licenses: SerializedLicense[] = (data?.items ?? initialLicenses).map((item: any) => ({
    id: item.id,
    quantity: item.quantity,
    pendingQuantity: item.pendingQuantity ?? null,
    inngestRunId: item.inngestRunId ?? null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
    subscription: {
      id: item.subscription?.id ?? '',
      commitmentEndDate: item.subscription?.commitmentEndDate
        ? (typeof item.subscription.commitmentEndDate === 'string'
          ? item.subscription.commitmentEndDate
          : item.subscription.commitmentEndDate?.toISOString?.() ?? null)
        : null,
      bundle: {
        id: item.subscription?.bundle?.id ?? '',
        name: item.subscription?.bundle?.name ?? 'Unknown',
      },
    },
    productOffering: item.productOffering
      ? {
          id: item.productOffering.id,
          effectiveUnitCost: item.productOffering.effectiveUnitCost?.toString() ?? null,
          minQuantity: item.productOffering.minQuantity ?? null,
          maxQuantity: item.productOffering.maxQuantity ?? null,
        }
      : null,
  }));

  const [scaleModal, setScaleModal] = useState<{
    license: SerializedLicense;
    direction: 'up' | 'down';
  } | null>(null);

  const [cancelIdempotencyKey, setCancelIdempotencyKey] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const cancelPending = api.license.cancelPendingScaleDown.useMutation({
    onSuccess: () => {
      setCancelTarget(null);
      setCancelIdempotencyKey(null);
      void utils.license.list.invalidate();
    },
  });

  const handleCancelPending = useCallback((licenseId: string) => {
    setCancelTarget(licenseId);
    setCancelIdempotencyKey(crypto.randomUUID());
  }, []);

  const confirmCancelPending = useCallback(() => {
    if (!cancelTarget || !cancelIdempotencyKey) return;
    cancelPending.mutate({ licenseId: cancelTarget, idempotencyKey: cancelIdempotencyKey });
  }, [cancelTarget, cancelIdempotencyKey, cancelPending]);

  const handleScaleSuccess = useCallback(() => {
    setScaleModal(null);
    void utils.license.list.invalidate();
  }, [utils]);

  return (
    <>
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full" aria-label="Licenses">
          <thead>
            <tr className="border-b border-slate-700 text-left">
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Bundle</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Quantity</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Pending</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {licenses.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  No licenses found. Create a subscription to get started.
                </td>
              </tr>
            ) : (
              licenses.map((license) => {
                const status = deriveLicenseStatus(license);
                return (
                  <tr key={license.id} className="hover:bg-slate-700/30 transition">
                    <td className="px-6 py-4 text-sm text-white font-medium">
                      {license.subscription.bundle.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{license.quantity}</td>
                    <td className="px-6 py-4 text-sm">
                      {license.pendingQuantity !== null ? (
                        <span className="text-yellow-400">{license.pendingQuantity}</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setScaleModal({ license, direction: 'up' })}
                          className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-xs font-medium text-white transition"
                          aria-label={`Scale up ${license.subscription.bundle.name}`}
                        >
                          Scale Up
                        </button>
                        <button
                          type="button"
                          onClick={() => setScaleModal({ license, direction: 'down' })}
                          disabled={license.pendingQuantity !== null}
                          className="px-3 py-1 bg-orange-700 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                          aria-label={`Scale down ${license.subscription.bundle.name}`}
                        >
                          Scale Down
                        </button>
                        {license.pendingQuantity !== null && (
                          <button
                            type="button"
                            onClick={() => handleCancelPending(license.id)}
                            disabled={cancelPending.isPending}
                            className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                            aria-label={`Cancel pending scale down for ${license.subscription.bundle.name}`}
                          >
                            Cancel Pending
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Scale Modal */}
      {scaleModal && (
        <ScaleModal
          license={scaleModal.license}
          direction={scaleModal.direction}
          onClose={() => setScaleModal(null)}
          onSuccess={handleScaleSuccess}
        />
      )}

      {/* Cancel Pending Confirmation Dialog */}
      {cancelTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel pending scale down"
        >
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">Cancel Pending Scale Down</h3>
            <p className="text-sm text-slate-400 mb-4">
              Are you sure you want to cancel this pending scale-down? The current quantity will be maintained.
            </p>
            {cancelPending.isError && (
              <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
                {cancelPending.error.message}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setCancelTarget(null); setCancelIdempotencyKey(null); }}
                disabled={cancelPending.isPending}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
              >
                Keep Pending
              </button>
              <button
                type="button"
                onClick={confirmCancelPending}
                disabled={cancelPending.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {cancelPending.isPending ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

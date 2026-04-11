'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { api } from '@/trpc/client';

// ---------- Serialized types ----------

interface SerializedProductOffering {
  id: string;
  sourceType: string | null;
  externalSku: string | null;
  effectiveUnitCost: string | null;
  currency: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
}

interface SerializedLicense {
  id: string;
  quantity: number;
  pendingQuantity: number | null;
  inngestRunId: string | null;
  createdAt: string;
  productOffering: SerializedProductOffering | null;
}

interface SerializedVendorConnection {
  id: string;
  vendorType: string;
  status: string;
}

interface SerializedSubscription {
  id: string;
  status: string;
  externalId: string | null;
  commitmentEndDate: string | null;
  createdAt: string;
  bundle: {
    id: string;
    name: string;
    friendlyName: string | null;
    category: string | null;
  };
  vendorConnection: SerializedVendorConnection | null;
  licenses: SerializedLicense[];
}

export interface SubscriptionDetailProps {
  subscription: SerializedSubscription;
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

// ---------- Vendor connection status ----------

const vendorStatusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Connected', className: 'text-green-400' },
  PENDING: { label: 'Pending', className: 'text-yellow-400' },
  ERROR: { label: 'Error', className: 'text-red-400' },
  DISCONNECTED: { label: 'Disconnected', className: 'text-slate-400' },
};

// ---------- License status ----------

type LicenseStatus = 'ACTIVE' | 'PENDING_SCALE_DOWN' | 'INACTIVE';

function deriveLicenseStatus(license: SerializedLicense): LicenseStatus {
  if (license.pendingQuantity !== null) return 'PENDING_SCALE_DOWN';
  if (license.quantity > 0) return 'ACTIVE';
  return 'INACTIVE';
}

const licenseStatusConfig: Record<LicenseStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-900/50 text-green-400 border-green-700' },
  PENDING_SCALE_DOWN: { label: 'Pending Scale Down', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
  INACTIVE: { label: 'Inactive', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
};

function LicenseStatusBadge({ status }: { status: LicenseStatus }) {
  const config = licenseStatusConfig[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}

// ---------- Format currency ----------

function formatCurrency(value: string, currency: string | null): string {
  const dec = new Decimal(value);
  const symbol = currency === 'EUR' ? '€' : '$';
  return `${symbol}${dec.toFixed(2)}`;
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

// ---------- Scale Modal ----------

interface ScaleModalProps {
  license: SerializedLicense;
  bundleName: string;
  commitmentEndDate: string | null;
  direction: 'up' | 'down';
  onClose: () => void;
  onSuccess: () => void;
}

function ScaleModal({ license, bundleName, commitmentEndDate, direction, onClose, onSuccess }: ScaleModalProps) {
  const [newQuantity, setNewQuantity] = useState<number>(
    direction === 'up' ? license.quantity + 1 : Math.max(0, license.quantity - 1),
  );
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const scaleUp = api.license.scaleUp.useMutation({
    onSuccess: () => onSuccess(),
    onError: (err) => setError(err.message),
  });

  const scaleDown = api.license.scaleDown.useMutation({
    onSuccess: () => onSuccess(),
    onError: (err) => setError(err.message),
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

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Scale ${direction} license`}
    >
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold text-white mb-4">
          Scale {direction === 'up' ? 'Up' : 'Down'}: {bundleName}
        </h3>

        {direction === 'down' && commitmentEndDate && (
          <div
            className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700 text-yellow-300 text-sm"
            role="alert"
          >
            <strong>⚠ Non-refundable until {new Date(commitmentEndDate).toLocaleDateString()}.</strong>{' '}
            This scale-down will be staged and applied after the commitment window ends.
          </div>
        )}

        <div className="mb-4">
          <p className="text-sm text-slate-400 mb-2">
            Current quantity: <span className="text-white font-medium">{license.quantity}</span>
          </p>
          <label htmlFor="scale-quantity" className="block text-sm font-medium text-slate-300 mb-1">
            New Quantity
          </label>
          <input
            id="scale-quantity"
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

// ---------- Main Detail Component ----------

export function SubscriptionDetail({ subscription: initialSubscription }: SubscriptionDetailProps) {
  const utils = api.useUtils();

  // Client-side refetch for real-time updates
  const { data: freshData } = api.subscription.get.useQuery(
    { subscriptionId: initialSubscription.id },
    { initialData: initialSubscription as any },
  );

  // Normalize the subscription data (handles both serialized + raw shapes)
  const sub: SerializedSubscription = (() => {
    const raw = freshData ?? initialSubscription;
    return {
      id: raw.id,
      status: raw.status,
      externalId: (raw as any).externalId ?? null,
      commitmentEndDate: raw.commitmentEndDate
        ? (typeof raw.commitmentEndDate === 'string'
          ? raw.commitmentEndDate
          : (raw.commitmentEndDate as any)?.toISOString?.() ?? null)
        : null,
      createdAt: typeof raw.createdAt === 'string'
        ? raw.createdAt
        : (raw.createdAt as any)?.toISOString?.() ?? '',
      bundle: {
        id: raw.bundle?.id ?? '',
        name: raw.bundle?.name ?? 'Unknown',
        friendlyName: (raw.bundle as any)?.friendlyName ?? null,
        category: (raw.bundle as any)?.category ?? null,
      },
      vendorConnection: raw.vendorConnection
        ? {
            id: raw.vendorConnection.id,
            vendorType: raw.vendorConnection.vendorType,
            status: raw.vendorConnection.status,
          }
        : null,
      licenses: (raw.licenses ?? []).map((lic: any) => ({
        id: lic.id,
        quantity: lic.quantity,
        pendingQuantity: lic.pendingQuantity ?? null,
        inngestRunId: lic.inngestRunId ?? null,
        createdAt: typeof lic.createdAt === 'string'
          ? lic.createdAt
          : lic.createdAt?.toISOString?.() ?? '',
        productOffering: lic.productOffering
          ? {
              id: lic.productOffering.id,
              sourceType: lic.productOffering.sourceType ?? null,
              externalSku: lic.productOffering.externalSku ?? null,
              effectiveUnitCost: lic.productOffering.effectiveUnitCost?.toString() ?? null,
              currency: lic.productOffering.currency ?? null,
              minQuantity: lic.productOffering.minQuantity ?? null,
              maxQuantity: lic.productOffering.maxQuantity ?? null,
            }
          : null,
      })),
    };
  })();

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [scaleModal, setScaleModal] = useState<{
    license: SerializedLicense;
    direction: 'up' | 'down';
  } | null>(null);
  const [cancelPendingTarget, setCancelPendingTarget] = useState<string | null>(null);
  const [cancelPendingKey, setCancelPendingKey] = useState<string | null>(null);

  const cancelPending = api.license.cancelPendingScaleDown.useMutation({
    onSuccess: () => {
      setCancelPendingTarget(null);
      setCancelPendingKey(null);
      void utils.subscription.get.invalidate({ subscriptionId: sub.id });
    },
  });

  const handleCancelSuccess = useCallback(() => {
    setShowCancelDialog(false);
    void utils.subscription.get.invalidate({ subscriptionId: initialSubscription.id });
    void utils.subscription.list.invalidate();
  }, [utils, initialSubscription.id]);

  const handleScaleSuccess = useCallback(() => {
    setScaleModal(null);
    void utils.subscription.get.invalidate({ subscriptionId: initialSubscription.id });
    void utils.license.list.invalidate();
  }, [utils, initialSubscription.id]);

  const handleCancelPending = useCallback((licenseId: string) => {
    setCancelPendingTarget(licenseId);
    setCancelPendingKey(crypto.randomUUID());
  }, []);

  const confirmCancelPending = useCallback(() => {
    if (!cancelPendingTarget || !cancelPendingKey) return;
    cancelPending.mutate({ licenseId: cancelPendingTarget, idempotencyKey: cancelPendingKey });
  }, [cancelPendingTarget, cancelPendingKey, cancelPending]);

  const isCommitted = sub.commitmentEndDate && new Date(sub.commitmentEndDate) > new Date();
  const totalLicenseQuantity = sub.licenses.reduce((sum, l) => sum + l.quantity, 0);

  const vendorStatus = sub.vendorConnection
    ? vendorStatusConfig[sub.vendorConnection.status] ?? { label: sub.vendorConnection.status, className: 'text-slate-400' }
    : null;

  return (
    <div>
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
        >
          <span aria-hidden="true">←</span>
          Back to Subscriptions
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {sub.bundle.friendlyName ?? sub.bundle.name}
          </h1>
          <p className="mt-1 text-slate-400 text-sm">
            {sub.bundle.category && (
              <span className="mr-2">{sub.bundle.category}</span>
            )}
            <span>Created {new Date(sub.createdAt).toLocaleDateString()}</span>
            {sub.externalId && (
              <span className="ml-2 text-slate-500">· ID: {sub.externalId}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={sub.status} />
          {sub.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => setShowCancelDialog(true)}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-white text-sm font-medium transition"
              aria-label="Cancel subscription"
            >
              Cancel Subscription
            </button>
          )}
        </div>
      </div>

      {/* Commitment warning */}
      {isCommitted && (
        <div
          className="mb-6 p-4 rounded-xl bg-yellow-900/20 border border-yellow-700/50 text-yellow-300 text-sm flex items-start gap-3"
          role="alert"
        >
          <span className="text-lg mt-0.5" aria-hidden="true">⚠</span>
          <div>
            <strong className="block mb-1">Active Commitment</strong>
            Non-refundable until{' '}
            <strong>{new Date(sub.commitmentEndDate!).toLocaleDateString()}</strong>.
            Scale-downs and cancellations will be staged until the commitment window ends.
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Vendor Connection */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
            Distributor
          </h3>
          {sub.vendorConnection ? (
            <div>
              <p className="text-white font-medium">{sub.vendorConnection.vendorType}</p>
              <p className={`text-sm mt-1 ${vendorStatus?.className}`}>
                {vendorStatus?.label}
              </p>
            </div>
          ) : (
            <p className="text-slate-500">No vendor connection</p>
          )}
        </div>

        {/* Commitment End Date */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
            Commitment End
          </h3>
          {sub.commitmentEndDate ? (
            <time dateTime={sub.commitmentEndDate} className="text-white font-medium">
              {new Date(sub.commitmentEndDate).toLocaleDateString()}
            </time>
          ) : (
            <p className="text-slate-500">No commitment (flexible)</p>
          )}
        </div>

        {/* Total Licenses */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
            Total Licenses
          </h3>
          <p className="text-white font-medium" aria-label={`${totalLicenseQuantity} seats across ${sub.licenses.length} ${sub.licenses.length === 1 ? 'license' : 'licenses'}`}>
            {totalLicenseQuantity}{' '}
            <span className="text-slate-400 font-normal text-sm">
              across {sub.licenses.length} {sub.licenses.length === 1 ? 'license' : 'licenses'}
            </span>
          </p>
        </div>
      </div>

      {/* Licenses table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Licenses</h2>
        </div>

        <table className="w-full" aria-label="Subscription licenses">
          <thead>
            <tr className="border-b border-slate-700 text-left">
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Product</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Quantity</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Pending</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Unit Cost</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sub.licenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                  No licenses found for this subscription.
                </td>
              </tr>
            ) : (
              sub.licenses.map((license) => {
                const status = deriveLicenseStatus(license);
                return (
                  <tr key={license.id} className="hover:bg-slate-700/30 transition">
                    <td className="px-6 py-4 text-sm text-white font-medium">
                      {license.productOffering?.externalSku ?? (
                        <span className="text-slate-500">Unknown SKU</span>
                      )}
                      {license.productOffering?.sourceType && (
                        <span className="block text-xs text-slate-400 mt-0.5">
                          {license.productOffering.sourceType}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {license.quantity}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {license.pendingQuantity !== null ? (
                        <span className="text-yellow-400">
                          → {license.pendingQuantity}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {license.productOffering?.effectiveUnitCost ? (
                        formatCurrency(
                          license.productOffering.effectiveUnitCost,
                          license.productOffering.currency,
                        )
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <LicenseStatusBadge status={status} />
                    </td>
                    <td className="px-6 py-4">
                      {sub.status === 'ACTIVE' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setScaleModal({ license, direction: 'up' })}
                            className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-xs font-medium text-white transition"
                            aria-label={`Scale up license ${license.productOffering?.externalSku ?? license.id}`}
                          >
                            Scale Up
                          </button>
                          <button
                            type="button"
                            onClick={() => setScaleModal({ license, direction: 'down' })}
                            disabled={license.pendingQuantity !== null}
                            className="px-3 py-1 bg-orange-700 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                            aria-label={`Scale down license ${license.productOffering?.externalSku ?? license.id}`}
                          >
                            Scale Down
                          </button>
                          {license.pendingQuantity !== null && (
                            <button
                              type="button"
                              onClick={() => handleCancelPending(license.id)}
                              disabled={cancelPending.isPending}
                              className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition"
                              aria-label={`Cancel pending scale down for license ${license.productOffering?.externalSku ?? license.id}`}
                            >
                              Cancel Pending
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Cancel Subscription Dialog */}
      {showCancelDialog && (
        <CancelDialog
          subscription={sub}
          onClose={() => setShowCancelDialog(false)}
          onSuccess={handleCancelSuccess}
        />
      )}

      {/* Scale Modal */}
      {scaleModal && (
        <ScaleModal
          license={scaleModal.license}
          bundleName={sub.bundle.name}
          commitmentEndDate={sub.commitmentEndDate}
          direction={scaleModal.direction}
          onClose={() => setScaleModal(null)}
          onSuccess={handleScaleSuccess}
        />
      )}

      {/* Cancel Pending Scale Down Dialog */}
      {cancelPendingTarget && (
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
                onClick={() => { setCancelPendingTarget(null); setCancelPendingKey(null); }}
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
    </div>
  );
}

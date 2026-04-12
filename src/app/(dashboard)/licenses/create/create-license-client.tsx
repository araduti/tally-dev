'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/trpc/client';
import Decimal from 'decimal.js';

// ---------- Types ----------

interface SerializedBundle {
  id: string;
  name: string;
  category: string | null;
}

interface SerializedOffering {
  id: string;
  sourceType: string;
  effectiveUnitCost: string | null;
  currency: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  availability: string | null;
}

// ---------- Helpers ----------

function formatCurrency(value: Decimal, currency: string | null): string {
  const symbol = currency === 'EUR' ? '€' : '$';
  return `${symbol}${value.toFixed(2)}`;
}

// ---------- Main Component ----------

export function CreateLicenseClient() {
  const router = useRouter();

  // --- Step 1: Bundle selection ---
  const [bundleSearch, setBundleSearch] = useState('');
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);

  const bundlesQuery = api.catalog.listBundles.useQuery(
    {
      limit: 50,
      ...(bundleSearch.trim()
        ? { where: { name: bundleSearch.trim() } }
        : {}),
    },
  );

  const bundles: SerializedBundle[] = useMemo(
    () =>
      (bundlesQuery.data?.items ?? []).map((b: any) => ({
        id: b.id,
        name: b.name,
        category: b.category ?? null,
      })),
    [bundlesQuery.data],
  );

  // --- Step 2: Product offering selection ---
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);

  const offeringsQuery = api.catalog.listProductOfferings.useQuery(
    { limit: 50, where: { bundleId: selectedBundleId! } },
    { enabled: !!selectedBundleId },
  );

  const offerings: SerializedOffering[] = useMemo(
    () =>
      (offeringsQuery.data?.items ?? []).map((o: any) => ({
        id: o.id,
        sourceType: o.sourceType,
        effectiveUnitCost: o.effectiveUnitCost?.toString() ?? null,
        currency: o.currency ?? null,
        minQuantity: o.minQuantity ?? null,
        maxQuantity: o.maxQuantity ?? null,
        availability: o.availability ?? null,
      })),
    [offeringsQuery.data],
  );

  const selectedOffering = offerings.find((o) => o.id === selectedOfferingId) ?? null;

  // --- Step 3: Quantity ---
  const [quantity, setQuantity] = useState<number>(1);

  // --- Price preview ---
  const pricePreview = useMemo(() => {
    if (!selectedOffering?.effectiveUnitCost) return null;
    const unitCost = new Decimal(selectedOffering.effectiveUnitCost);
    const total = unitCost.mul(quantity);
    return {
      unitCost: formatCurrency(unitCost, selectedOffering.currency),
      total: formatCurrency(total, selectedOffering.currency),
    };
  }, [selectedOffering, quantity]);

  // --- Quantity bounds ---
  const minQuantity = selectedOffering?.minQuantity ?? 1;
  const maxQuantity = selectedOffering?.maxQuantity ?? 999999;

  // --- Mutation ---
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const createMutation = api.subscription.create.useMutation({
    onSuccess: () => {
      router.push('/licenses');
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedOfferingId) {
      setError('Please select a product offering');
      return;
    }
    if (quantity < minQuantity || quantity > maxQuantity) {
      setError(`Quantity must be between ${minQuantity} and ${maxQuantity}`);
      return;
    }

    createMutation.mutate({
      productOfferingId: selectedOfferingId,
      quantity,
      idempotencyKey,
    });
  };

  // --- Reset offering when bundle changes ---
  const handleBundleChange = (bundleId: string) => {
    setSelectedBundleId(bundleId || null);
    setSelectedOfferingId(null);
    setQuantity(1);
    setError(null);
  };

  const isSubmitDisabled =
    !selectedOfferingId ||
    quantity < minQuantity ||
    quantity > maxQuantity ||
    createMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Error Banner */}
      {error && (
        <div
          className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Step 1: Select Bundle */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 className="text-lg font-semibold text-white mb-4">1. Select Bundle</h2>

        <div className="mb-4">
          <label htmlFor="bundle-search" className="block text-sm font-medium text-slate-300 mb-1">
            Search Bundles
          </label>
          <input
            id="bundle-search"
            type="text"
            value={bundleSearch}
            onChange={(e) => setBundleSearch(e.target.value)}
            placeholder="Type to search bundles…"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="bundle-select" className="block text-sm font-medium text-slate-300 mb-1">
            Bundle
          </label>
          {bundlesQuery.isLoading ? (
            <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
          ) : (
            <select
              id="bundle-select"
              value={selectedBundleId ?? ''}
              onChange={(e) => handleBundleChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Select a bundle"
            >
              <option value="">— Select a bundle —</option>
              {bundles.map((bundle) => (
                <option key={bundle.id} value={bundle.id}>
                  {bundle.name}
                  {bundle.category ? ` (${bundle.category})` : ''}
                </option>
              ))}
            </select>
          )}
          {bundlesQuery.isError && (
            <p className="mt-1 text-xs text-red-400">Failed to load bundles</p>
          )}
        </div>
      </div>

      {/* Step 2: Select Product Offering */}
      {selectedBundleId && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">2. Select Product Offering</h2>

          {offeringsQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
              <div className="h-4 w-48 bg-slate-700 rounded animate-pulse" />
            </div>
          ) : offerings.length === 0 ? (
            <p className="text-sm text-slate-400">
              No product offerings available for this bundle.
            </p>
          ) : (
            <>
              <label htmlFor="offering-select" className="block text-sm font-medium text-slate-300 mb-1">
                Offering
              </label>
              <select
                id="offering-select"
                value={selectedOfferingId ?? ''}
                onChange={(e) => {
                  setSelectedOfferingId(e.target.value || null);
                  setQuantity(1);
                  setError(null);
                }}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Select a product offering"
              >
                <option value="">— Select an offering —</option>
                {offerings.map((offering) => {
                  const costLabel = offering.effectiveUnitCost
                    ? formatCurrency(new Decimal(offering.effectiveUnitCost), offering.currency)
                    : 'Price N/A';
                  return (
                    <option key={offering.id} value={offering.id}>
                      {offering.sourceType} — {costLabel}/seat
                      {offering.availability ? ` (${offering.availability})` : ''}
                    </option>
                  );
                })}
              </select>

              {/* Offering Details */}
              {selectedOffering && (
                <div className="mt-3 p-3 bg-slate-700/50 rounded-lg border border-slate-600">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-slate-400">Distributor</span>
                      <p className="text-white font-medium">{selectedOffering.sourceType}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Unit Cost</span>
                      <p className="text-white font-medium">
                        {selectedOffering.effectiveUnitCost
                          ? formatCurrency(new Decimal(selectedOffering.effectiveUnitCost), selectedOffering.currency)
                          : '—'}
                      </p>
                    </div>
                    {selectedOffering.minQuantity !== null && (
                      <div>
                        <span className="text-slate-400">Min Quantity</span>
                        <p className="text-white font-medium">{selectedOffering.minQuantity}</p>
                      </div>
                    )}
                    {selectedOffering.maxQuantity !== null && (
                      <div>
                        <span className="text-slate-400">Max Quantity</span>
                        <p className="text-white font-medium">{selectedOffering.maxQuantity}</p>
                      </div>
                    )}
                    {selectedOffering.availability && (
                      <div>
                        <span className="text-slate-400">Availability</span>
                        <p className="text-white font-medium">{selectedOffering.availability}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 3: Quantity & Price Preview */}
      {selectedOfferingId && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">3. Set Quantity</h2>

          <div className="mb-4">
            <label htmlFor="quantity" className="block text-sm font-medium text-slate-300 mb-1">
              Number of Seats
            </label>
            <input
              id="quantity"
              type="number"
              min={minQuantity}
              max={maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {selectedOffering && (selectedOffering.minQuantity !== null || selectedOffering.maxQuantity !== null) && (
              <p className="mt-1 text-xs text-slate-400">
                {selectedOffering.minQuantity !== null && `Min: ${selectedOffering.minQuantity}`}
                {selectedOffering.minQuantity !== null && selectedOffering.maxQuantity !== null && ' · '}
                {selectedOffering.maxQuantity !== null && `Max: ${selectedOffering.maxQuantity}`}
              </p>
            )}
          </div>

          {/* Price Preview */}
          {pricePreview && (
            <div className="p-4 bg-slate-700/50 rounded-lg border border-slate-600">
              <h3 className="text-sm font-medium text-slate-300 mb-2">Price Preview</h3>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="text-sm text-slate-400">Unit Cost</span>
                  <p className="text-lg font-semibold text-white">{pricePreview.unitCost}</p>
                </div>
                <div className="text-slate-600 text-lg">×</div>
                <div>
                  <span className="text-sm text-slate-400">Qty</span>
                  <p className="text-lg font-semibold text-white">{quantity}</p>
                </div>
                <div className="text-slate-600 text-lg">=</div>
                <div>
                  <span className="text-sm text-slate-400">Total</span>
                  <p className="text-xl font-bold text-blue-400">{pricePreview.total}</p>
                </div>
              </div>
            </div>
          )}

          {!selectedOffering?.effectiveUnitCost && (
            <div
              className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-sm"
              role="alert"
            >
              ⚠ Price information is unavailable for this offering. The license will still be created.
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg text-white font-medium transition"
        >
          {createMutation.isPending ? 'Creating…' : 'Create License'}
        </button>
        <a
          href="/licenses"
          className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition"
        >
          Cancel
        </a>
      </div>

      {/* Success feedback is handled by redirect, but show mutation error inline */}
      {createMutation.isError && !error && (
        <div
          className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm"
          role="alert"
        >
          {createMutation.error.message}
        </div>
      )}
    </form>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { api } from '@/trpc/client';

// ---------- Serialized types ----------

interface SerializedProduct {
  id: string;
  name: string;
}

interface SerializedBundleProduct {
  product: SerializedProduct;
}

interface SerializedBundle {
  id: string;
  name: string;
  category: string | null;
  createdAt: string;
  products: SerializedBundleProduct[];
}

interface PricingOption {
  productOfferingId: string;
  sourceType: string;
  effectiveUnitCost: string;
  totalCost: string;
  partnerMarginPercent: string | null;
  currency: string;
  availability: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  isEligible: boolean;
}

interface PricingResult {
  bundleId: string;
  bundleName: string;
  quantity: number;
  options: PricingOption[];
}

export interface MarketplaceClientProps {
  initialBundles: SerializedBundle[];
  initialNextCursor: string | null;
}

// ---------- Main MarketplaceClient component ----------

export function MarketplaceClient({ initialBundles, initialNextCursor }: MarketplaceClientProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [compareBundle, setCompareBundle] = useState<SerializedBundle | null>(null);
  const [compareQuantity, setCompareQuantity] = useState(1);

  // Debounced search handler
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    // Simple debounce using setTimeout
    const timer = setTimeout(() => setDebouncedSearch(value), 300);
    return () => clearTimeout(timer);
  };

  // Client-side query with search filter
  const { data: bundlesData, isLoading: bundlesLoading } = api.catalog.listBundles.useQuery(
    {
      where: debouncedSearch ? { name: debouncedSearch } : undefined,
    },
    {
      initialData: !debouncedSearch ? { items: initialBundles as any, nextCursor: initialNextCursor } : undefined,
    },
  );

  const bundles: SerializedBundle[] = useMemo(() =>
    (bundlesData?.items ?? initialBundles).map((item: any) => ({
      id: item.id,
      name: item.name,
      category: item.category ?? null,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
      products: (item.products ?? []).map((bp: any) => ({
        product: {
          id: bp.product?.id ?? '',
          name: bp.product?.name ?? 'Unknown',
        },
      })),
    })),
  [bundlesData?.items, initialBundles]);

  // Pricing comparison query — only enabled when a bundle is selected
  const { data: pricingData, isLoading: pricingLoading, error: pricingError } = api.catalog.comparePricing.useQuery(
    { bundleId: compareBundle?.id ?? '', quantity: compareQuantity },
    { enabled: !!compareBundle },
  );

  const pricingResult: PricingResult | null = pricingData
    ? {
        bundleId: pricingData.bundleId,
        bundleName: pricingData.bundleName,
        quantity: pricingData.quantity,
        options: pricingData.options.map((opt: any) => ({
          productOfferingId: opt.productOfferingId,
          sourceType: opt.sourceType,
          effectiveUnitCost: opt.effectiveUnitCost,
          totalCost: opt.totalCost,
          partnerMarginPercent: opt.partnerMarginPercent ?? null,
          currency: opt.currency,
          availability: opt.availability ?? null,
          minQuantity: opt.minQuantity ?? null,
          maxQuantity: opt.maxQuantity ?? null,
          isEligible: opt.isEligible,
        }))
      }
    : null;

  return (
    <div>
      {/* Search */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="flex items-center gap-4">
          <input
            type="search"
            placeholder="Search bundles (e.g., Microsoft 365 E3)..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search bundles"
          />
          {bundlesLoading && (
            <div className="text-slate-400 text-sm" aria-live="polite">Searching…</div>
          )}
        </div>
      </div>

      {/* Bundle Cards */}
      {bundles.length === 0 && !bundlesLoading ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-6 text-center">
            <p className="text-slate-400">
              {debouncedSearch
                ? `No bundles found matching "${debouncedSearch}".`
                : 'No bundles available. Connect a vendor to sync the catalog.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {bundles.map((bundle) => (
            <div
              key={bundle.id}
              className="bg-slate-800 rounded-xl p-5 border border-slate-700 hover:border-slate-600 transition"
            >
              <h3 className="text-white font-semibold mb-1">{bundle.name}</h3>
              {bundle.category && (
                <span className="inline-block text-xs text-slate-400 mb-3">{bundle.category}</span>
              )}
              {bundle.products.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-slate-500 mb-1">Products:</p>
                  <ul className="space-y-0.5">
                    {bundle.products.slice(0, 3).map((bp) => (
                      <li key={bp.product.id} className="text-sm text-slate-300">
                        • {bp.product.name}
                      </li>
                    ))}
                    {bundle.products.length > 3 && (
                      <li className="text-xs text-slate-500">
                        +{bundle.products.length - 3} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setCompareBundle(bundle);
                  setCompareQuantity(1);
                }}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
                aria-label={`Compare pricing for ${bundle.name}`}
              >
                Compare Pricing
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pricing Comparison Panel */}
      {compareBundle && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Pricing Comparison: {compareBundle.name}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Compare prices across all connected distributors
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompareBundle(null)}
              className="text-slate-400 hover:text-white transition"
              aria-label="Close pricing comparison"
            >
              ✕
            </button>
          </div>

          <div className="px-6 py-4 border-b border-slate-700">
            <label htmlFor="compare-quantity" className="block text-sm font-medium text-slate-300 mb-1">
              Quantity
            </label>
            <input
              id="compare-quantity"
              type="number"
              min={1}
              value={compareQuantity}
              onChange={(e) => setCompareQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-32 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {pricingLoading && (
            <div className="p-6 text-center text-slate-400" aria-live="polite">
              Loading pricing data…
            </div>
          )}

          {pricingError && (
            <div className="p-6">
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm" role="alert">
                {pricingError.message}
              </div>
            </div>
          )}

          {pricingResult && !pricingLoading && (
            <div className="overflow-x-auto">
              {pricingResult.options.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  No pricing options available for this bundle.
                </div>
              ) : (
                <table className="w-full" aria-label="Pricing comparison">
                  <thead>
                    <tr className="border-b border-slate-700 text-left">
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distributor</th>
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Unit Cost</th>
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Total Cost</th>
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Margin</th>
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Availability</th>
                      <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Eligible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {pricingResult.options.map((option) => (
                      <tr
                        key={option.productOfferingId}
                        className={`transition ${
                          option.isEligible
                            ? 'hover:bg-slate-700/30'
                            : 'opacity-50'
                        }`}
                      >
                        <td className="px-6 py-4 text-sm text-white font-medium">{option.sourceType}</td>
                        <td className="px-6 py-4 text-sm text-slate-300">
                          {option.currency} {option.effectiveUnitCost}
                        </td>
                        <td className="px-6 py-4 text-sm text-white font-medium">
                          {option.currency} {option.totalCost}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-300">
                          {option.partnerMarginPercent ? `${option.partnerMarginPercent}%` : '—'}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {option.availability ? (
                            <span className={
                              option.availability === 'available'
                                ? 'text-green-400'
                                : 'text-yellow-400'
                            }>
                              {option.availability}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {option.isEligible ? (
                            <span className="text-green-400">✓ Eligible</span>
                          ) : (
                            <span className="text-red-400">
                              ✗ Not eligible
                              {option.minQuantity !== null || option.maxQuantity !== null
                                ? ` (${option.minQuantity ?? 0}–${option.maxQuantity ?? '∞'})`
                                : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { LicenseTable } from './license-table';

function LicensesLoadingSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex gap-6">
        {['Bundle', 'Quantity', 'Pending', 'Status', 'Actions'].map((h) => (
          <div key={h} className="h-3 w-20 skeleton-shimmer rounded-lg" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex gap-6">
          <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-24 skeleton-shimmer rounded-lg" />
        </div>
      ))}
    </div>
  );
}

async function LicensesContent() {
  try {
    const result = await api.license.list({});

    // Serialize Date → ISO string, Decimal → string
    const serializedItems = result.items.map((item: any) => ({
      id: item.id,
      quantity: item.quantity,
      pendingQuantity: item.pendingQuantity ?? null,
      inngestRunId: item.inngestRunId ?? null,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      subscription: {
        id: item.subscription.id,
        commitmentEndDate: item.subscription.commitmentEndDate instanceof Date
          ? item.subscription.commitmentEndDate.toISOString()
          : (item.subscription.commitmentEndDate ?? null),
        bundle: {
          id: item.subscription.bundle.id,
          name: item.subscription.bundle.name,
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

    return (
      <LicenseTable
        initialLicenses={serializedItems}
        initialNextCursor={result.nextCursor}
      />
    );
  } catch {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-700/50 p-6 shadow-sm">
        <p className="text-red-600 dark:text-red-400 text-sm">
          Unable to load licenses. Please try refreshing the page.
        </p>
      </div>
    );
  }
}

export default async function LicensesPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">License Management</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Manage seat quantities, scale up/down, and track pending changes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/licenses/create"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            ＋ Create License
          </a>
          <a
            href="/licenses/import"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm font-medium transition"
          >
            📤 Import CSV
          </a>
        </div>
      </div>

      <Suspense fallback={<LicensesLoadingSkeleton />}>
        <LicensesContent />
      </Suspense>
    </div>
  );
}

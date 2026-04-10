import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { LicenseTable } from './license-table';

function LicensesLoadingSkeleton() {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-700 flex gap-6">
        {['Bundle', 'Quantity', 'Pending', 'Status', 'Actions'].map((h) => (
          <div key={h} className="h-3 w-20 bg-slate-700 rounded animate-pulse" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="px-6 py-4 border-b border-slate-700/50 flex gap-6">
          <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
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
      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-6">
        <p className="text-red-400 text-sm">
          Unable to load licenses. Please try refreshing the page.
        </p>
      </div>
    );
  }
}

export default async function LicensesPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">License Management</h1>
        <p className="mt-1 text-slate-400">
          Manage seat quantities, scale up/down, and track pending changes
        </p>
      </div>

      <Suspense fallback={<LicensesLoadingSkeleton />}>
        <LicensesContent />
      </Suspense>
    </div>
  );
}

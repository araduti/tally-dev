import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { SubscriptionTable } from './subscription-table';

function SubscriptionsLoadingSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex gap-6">
        {['Bundle', 'Distributor', 'Status', 'Commitment End', 'Actions'].map((h) => (
          <div key={h} className="h-3 w-20 skeleton-shimmer rounded-lg" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex gap-6">
          <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-20 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-24 skeleton-shimmer rounded-lg" />
          <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
        </div>
      ))}
    </div>
  );
}

async function SubscriptionsContent() {
  try {
    const result = await api.subscription.list({});

    // Serialize Date → ISO string, Decimal → string
    const serializedItems = result.items.map((item: any) => ({
      id: item.id,
      status: item.status,
      externalId: item.externalId ?? null,
      commitmentEndDate: item.commitmentEndDate instanceof Date
        ? item.commitmentEndDate.toISOString()
        : (item.commitmentEndDate ?? null),
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      bundle: {
        id: item.bundle.id,
        name: item.bundle.name,
      },
      vendorType: item.vendorConnection?.vendorType ?? null,
    }));

    return (
      <SubscriptionTable
        initialSubscriptions={serializedItems}
        initialNextCursor={result.nextCursor}
      />
    );
  } catch {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-700/50 p-6 shadow-sm">
        <p className="text-red-600 dark:text-red-400 text-sm">
          Unable to load subscriptions. Please try refreshing the page.
        </p>
      </div>
    );
  }
}

export default async function SubscriptionsPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Subscriptions</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Active subscriptions and their lifecycle status
        </p>
      </div>

      <Suspense fallback={<SubscriptionsLoadingSkeleton />}>
        <SubscriptionsContent />
      </Suspense>
    </div>
  );
}

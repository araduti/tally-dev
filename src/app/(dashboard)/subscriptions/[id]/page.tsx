import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { SubscriptionDetail } from './subscription-detail';

function DetailLoadingSkeleton() {
  return (
    <div>
      {/* Back link skeleton */}
      <div className="mb-6">
        <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
      </div>

      {/* Header skeleton */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="h-8 w-64 bg-slate-700 rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="h-6 w-20 bg-slate-700 rounded-full animate-pulse" />
      </div>

      {/* Info cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <div className="h-3 w-24 bg-slate-700 rounded animate-pulse mb-3" />
            <div className="h-5 w-32 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Licenses table skeleton */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="h-5 w-24 bg-slate-700 rounded animate-pulse" />
        </div>
        <div className="px-6 py-3 border-b border-slate-700 flex gap-6">
          {['Product', 'Quantity', 'Pending', 'Unit Cost', 'Status', 'Actions'].map((h) => (
            <div key={h} className="h-3 w-20 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-700/50 flex gap-6">
            <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function SubscriptionDetailContent({ id }: { id: string }) {
  try {
    const subscription = await api.subscription.get({ subscriptionId: id });

    if (!subscription) {
      notFound();
    }

    // Serialize Date → ISO string, Decimal → string for client component
    const serialized = {
      id: subscription.id,
      status: subscription.status,
      externalId: subscription.externalId ?? null,
      commitmentEndDate: subscription.commitmentEndDate instanceof Date
        ? subscription.commitmentEndDate.toISOString()
        : (subscription.commitmentEndDate ?? null),
      createdAt: subscription.createdAt instanceof Date
        ? subscription.createdAt.toISOString()
        : subscription.createdAt,
      bundle: {
        id: subscription.bundle.id,
        name: subscription.bundle.name,
        friendlyName: subscription.bundle.friendlyName ?? null,
        category: subscription.bundle.category ?? null,
      },
      vendorConnection: subscription.vendorConnection
        ? {
            id: subscription.vendorConnection.id,
            vendorType: subscription.vendorConnection.vendorType,
            status: subscription.vendorConnection.status,
          }
        : null,
      licenses: subscription.licenses.map((license: any) => ({
        id: license.id,
        quantity: license.quantity,
        pendingQuantity: license.pendingQuantity ?? null,
        inngestRunId: license.inngestRunId ?? null,
        createdAt: license.createdAt instanceof Date
          ? license.createdAt.toISOString()
          : license.createdAt,
        productOffering: license.productOffering
          ? {
              id: license.productOffering.id,
              sourceType: license.productOffering.sourceType ?? null,
              externalSku: license.productOffering.externalSku ?? null,
              effectiveUnitCost: license.productOffering.effectiveUnitCost?.toString() ?? null,
              currency: license.productOffering.currency ?? null,
              minQuantity: license.productOffering.minQuantity ?? null,
              maxQuantity: license.productOffering.maxQuantity ?? null,
            }
          : null,
      })),
    };

    return <SubscriptionDetail subscription={serialized} />;
  } catch {
    return (
      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-semibold text-white mb-2">Subscription not found</h2>
        <p className="text-slate-400 text-sm mb-4">
          This subscription may have been removed or you don&apos;t have access to it.
        </p>
        <Link
          href="/subscriptions"
          className="inline-flex px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
        >
          Back to Subscriptions
        </Link>
      </div>
    );
  }
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<DetailLoadingSkeleton />}>
      <SubscriptionDetailContent id={id} />
    </Suspense>
  );
}

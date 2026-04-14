import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { BillingClient } from './billing-client';

function BillingLoadingSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="h-5 w-40 skeleton-shimmer rounded-lg" />
      </div>
      <div className="p-6 space-y-3" aria-label="Loading transactions">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 skeleton-shimmer rounded-lg" />
        ))}
      </div>
    </div>
  );
}

async function BillingContent() {
  const result = await api.billing.listTransactions({}).catch(() => null);

  const serializedTransactions = (result?.items ?? []).map((item: any) => ({
    id: item.id,
    quantity: item.quantity,
    grossAmount: item.grossAmount?.toString() ?? '0',
    ourMarginEarned: item.ourMarginEarned?.toString() ?? '0',
    status: item.status,
    idempotencyKey: item.idempotencyKey ?? null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : (item.createdAt ?? ''),
    productOffering: item.productOffering
      ? {
          id: item.productOffering.id,
          sourceType: item.productOffering.sourceType,
          bundle: item.productOffering.bundle
            ? { id: item.productOffering.bundle.id, name: item.productOffering.bundle.name }
            : null,
        }
      : null,
  }));

  return (
    <BillingClient
      initialTransactions={serializedTransactions}
      initialNextCursor={result?.nextCursor ?? null}
    />
  );
}

export default async function BillingPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Billing</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Projected invoices, purchase transactions, and billing history</p>
      </div>

      <Suspense fallback={<BillingLoadingSkeleton />}>
        <BillingContent />
      </Suspense>
    </div>
  );
}

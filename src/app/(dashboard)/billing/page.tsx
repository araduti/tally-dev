import { Suspense } from 'react';
import { api } from '@/trpc/server';
import { BillingClient } from './billing-client';

function BillingLoadingSkeleton() {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="h-5 w-40 bg-slate-700 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3" aria-label="Loading transactions">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-slate-700/50 rounded animate-pulse" />
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
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-slate-400">Projected invoices, purchase transactions, and billing history</p>
      </div>

      <Suspense fallback={<BillingLoadingSkeleton />}>
        <BillingContent />
      </Suspense>
    </div>
  );
}

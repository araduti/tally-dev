'use client';

import { useState, useCallback } from 'react';
import { api } from '@/trpc/client';
import Decimal from 'decimal.js';

// ---------- Serialized types ----------

interface SerializedBundle {
  id: string;
  name: string;
}

interface SerializedProductOffering {
  id: string;
  sourceType: string;
  bundle: SerializedBundle | null;
}

interface SerializedTransaction {
  id: string;
  quantity: number;
  grossAmount: string;
  ourMarginEarned: string;
  status: string;
  idempotencyKey: string | null;
  createdAt: string;
  productOffering: SerializedProductOffering | null;
}

export interface BillingClientProps {
  initialTransactions: SerializedTransaction[];
  initialNextCursor: string | null;
}

// ---------- Status badge ----------

const txStatusConfig: Record<string, { label: string; className: string }> = {
  COMPLETED: { label: 'Completed', className: 'bg-green-900/50 text-green-400 border-green-700' },
  PENDING: { label: 'Pending', className: 'bg-yellow-900/50 text-yellow-400 border-yellow-700' },
  FAILED: { label: 'Failed', className: 'bg-red-900/50 text-red-400 border-red-700' },
  REFUNDED: { label: 'Refunded', className: 'bg-slate-700/50 text-slate-400 border-slate-600' },
};

// ---------- Main BillingClient component ----------

export function BillingClient({ initialTransactions, initialNextCursor }: BillingClientProps) {
  const [cursor, setCursor] = useState<string | null>(null);

  const { data, isLoading } = api.billing.listTransactions.useQuery(
    { cursor: cursor ?? undefined },
    {
      initialData: !cursor ? { items: initialTransactions as any, nextCursor: initialNextCursor } : undefined,
    },
  );

  const transactions: SerializedTransaction[] = (data?.items ?? initialTransactions).map((item: any) => ({
    id: item.id,
    quantity: item.quantity,
    grossAmount: item.grossAmount?.toString() ?? '0',
    ourMarginEarned: item.ourMarginEarned?.toString() ?? '0',
    status: item.status,
    idempotencyKey: item.idempotencyKey ?? null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.createdAt?.toISOString?.() ?? '',
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

  const nextCursor = data?.nextCursor ?? null;

  const handleNextPage = useCallback(() => {
    if (nextCursor) setCursor(nextCursor);
  }, [nextCursor]);

  const handleFirstPage = useCallback(() => {
    setCursor(null);
  }, []);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Purchase Transactions</h2>
        {cursor && (
          <button
            type="button"
            onClick={handleFirstPage}
            className="text-sm text-blue-400 hover:text-blue-300 transition"
          >
            ← Back to first page
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="p-6 space-y-3" aria-label="Loading transactions">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-slate-700/50 rounded animate-pulse" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="p-6 text-center text-slate-400">
          No transactions yet. Purchase a subscription from the Marketplace to see transactions here.
        </div>
      ) : (
        <>
          <table className="w-full" aria-label="Purchase transactions">
            <thead>
              <tr className="border-b border-slate-700 text-left">
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Bundle</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distributor</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Quantity</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Margin</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {transactions.map((tx) => {
                const config = txStatusConfig[tx.status] ?? { label: tx.status, className: 'bg-slate-700/50 text-slate-400 border-slate-600' };
                const grossAmount = new Decimal(tx.grossAmount);
                const marginEarned = new Decimal(tx.ourMarginEarned);

                return (
                  <tr key={tx.id} className="hover:bg-slate-700/30 transition">
                    <td className="px-6 py-4 text-sm text-white font-medium">
                      {tx.productOffering?.bundle?.name ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {tx.productOffering?.sourceType ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{tx.quantity}</td>
                    <td className="px-6 py-4 text-sm text-white font-medium">
                      ${grossAmount.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-400">
                      ${marginEarned.toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
                        {config.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      <time dateTime={tx.createdAt}>
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {nextCursor && (
            <div className="px-6 py-3 border-t border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={handleNextPage}
                className="px-4 py-2 text-sm text-blue-400 hover:text-blue-300 transition"
              >
                Load more →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

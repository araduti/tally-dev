import { Suspense } from 'react';
import { api } from '@/trpc/server';
import Decimal from 'decimal.js';

function StatsLoadingSkeleton() {
  return (
    <div className="grid md:grid-cols-3 gap-6 mb-8">
      {['Active Licenses', 'Monthly Spend', 'Potential Savings'].map((label) => (
        <div key={label} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">{label}</p>
          <div className="h-9 w-20 bg-slate-700/50 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

async function DashboardStats() {
  let licenseCount: number | null = null;
  let monthlySpend: string | null = null;

  try {
    const [licenseResult, invoiceResult] = await Promise.all([
      api.license.list({}).catch(() => null),
      api.billing.projectInvoice({}).catch(() => null),
    ]);

    if (licenseResult) {
      licenseCount = licenseResult.items.length;
    }

    if (invoiceResult?.totalProjectedAmount) {
      const amount = new Decimal(invoiceResult.totalProjectedAmount);
      monthlySpend = `$${amount.toFixed(2)}`;
    }
  } catch {
    // Fallback to showing dashes on complete failure
  }

  return (
    <div className="grid md:grid-cols-3 gap-6 mb-8">
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <p className="text-sm text-slate-400 mb-1">Active Licenses</p>
        <p className="text-3xl font-bold text-white">
          {licenseCount !== null ? licenseCount : '—'}
        </p>
      </div>
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <p className="text-sm text-slate-400 mb-1">Monthly Spend</p>
        <p className="text-3xl font-bold text-white">
          {monthlySpend ?? '—'}
        </p>
      </div>
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <p className="text-sm text-slate-400 mb-1">Potential Savings</p>
        <p className="text-3xl font-bold text-green-400">—</p>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-slate-400">AI-powered insights and recommendations</p>
      </div>

      <Suspense fallback={<StatsLoadingSkeleton />}>
        <DashboardStats />
      </Suspense>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">AI Recommendations</h2>
          <p className="text-slate-400 text-sm">
            Connect a vendor to receive AI-powered optimization recommendations.
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">Waste Alerts</h2>
          <p className="text-slate-400 text-sm">
            No waste detected. Connect vendors to start monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}

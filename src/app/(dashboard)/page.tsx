import { Suspense } from 'react';
import { api } from '@/trpc/server';
import Decimal from 'decimal.js';
import { DashboardInsights } from './dashboard-insights';

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

function InsightsLoadingSkeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {['AI Recommendations', 'Waste Alerts'].map((title) => (
        <div key={title} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-40 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-slate-700/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

async function DashboardStats() {
  let licenseCount: number | null = null;
  let monthlySpend: string | null = null;
  let potentialSavings: string | null = null;

  try {
    const [licenseResult, invoiceResult, recResult] = await Promise.all([
      api.license.list({}).catch(() => null),
      api.billing.projectInvoice({}).catch(() => null),
      api.insights.getRecommendations({}).catch(() => null),
    ]);

    if (licenseResult) {
      licenseCount = licenseResult.items.length;
    }

    if (invoiceResult?.totalProjectedAmount) {
      const amount = new Decimal(invoiceResult.totalProjectedAmount);
      monthlySpend = `$${amount.toFixed(2)}`;
    }

    if (recResult?.recommendations) {
      let totalSavings = new Decimal(0);
      for (const rec of recResult.recommendations) {
        if (rec.potentialSavings) {
          totalSavings = totalSavings.add(new Decimal(rec.potentialSavings));
        }
      }
      if (totalSavings.gt(0)) {
        potentialSavings = `$${totalSavings.toFixed(2)}`;
      }
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
        <p className="text-3xl font-bold text-green-400">
          {potentialSavings ?? '—'}
        </p>
      </div>
    </div>
  );
}

async function DashboardInsightsContent() {
  try {
    const [recResult, alertResult] = await Promise.all([
      api.insights.getRecommendations({}).catch(() => null),
      api.insights.getWasteAlerts({}).catch(() => null),
    ]);

    const serializedRecs = (recResult?.recommendations ?? []).map((rec: any) => ({
      id: rec.id,
      type: rec.type,
      title: rec.title,
      description: rec.description,
      potentialSavings: rec.potentialSavings ?? null,
      severity: rec.severity,
      entityId: rec.entityId,
      entityType: rec.entityType,
    }));

    const serializedAlerts = (alertResult?.alerts ?? []).map((alert: any) => ({
      id: alert.id,
      type: alert.type,
      title: alert.title,
      description: alert.description,
      estimatedWaste: alert.estimatedWaste ?? null,
      severity: alert.severity,
      entityId: alert.entityId,
      entityType: alert.entityType,
      suggestedAction: alert.suggestedAction,
    }));

    return (
      <DashboardInsights
        initialRecommendations={serializedRecs}
        initialAlerts={serializedAlerts}
      />
    );
  } catch {
    return (
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">AI Recommendations</h2>
          <p className="text-slate-400 text-sm">
            Unable to load recommendations. Please try refreshing.
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">Waste Alerts</h2>
          <p className="text-slate-400 text-sm">
            Unable to load waste alerts. Please try refreshing.
          </p>
        </div>
      </div>
    );
  }
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

      <Suspense fallback={<InsightsLoadingSkeleton />}>
        <DashboardInsightsContent />
      </Suspense>
    </div>
  );
}

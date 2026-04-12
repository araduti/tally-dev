import { Suspense } from 'react';
import { api } from '@/trpc/server';
import Decimal from 'decimal.js';
import { DashboardInsights } from './dashboard-insights';

function StatsLoadingSkeleton() {
  return (
    <div className="grid md:grid-cols-3 gap-5 mb-8 stagger-children">
      {['Active Licenses', 'Monthly Spend', 'Potential Savings'].map((label) => (
        <div key={label} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{label}</p>
          <div className="h-9 w-24 skeleton-shimmer rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function InsightsLoadingSkeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-5">
      {['AI Recommendations', 'Waste Alerts'].map((title) => (
        <div key={title} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="h-5 w-40 skeleton-shimmer rounded-lg mb-4" />
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 skeleton-shimmer rounded-xl" />
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

  const statCards = [
    {
      label: 'Active Licenses',
      value: licenseCount !== null ? licenseCount.toString() : '—',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
        </svg>
      ),
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-500/10',
      textColor: 'text-slate-900 dark:text-white',
    },
    {
      label: 'Monthly Spend',
      value: monthlySpend ?? '—',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
        </svg>
      ),
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10',
      textColor: 'text-slate-900 dark:text-white',
    },
    {
      label: 'Potential Savings',
      value: potentialSavings ?? '—',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
        </svg>
      ),
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
      textColor: 'text-emerald-600 dark:text-emerald-400',
    },
  ];

  return (
    <div className="grid md:grid-cols-3 gap-5 mb-8 stagger-children">
      {statCards.map((card) => (
        <div
          key={card.label}
          className="group bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md dark:hover:border-slate-700 transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{card.label}</p>
            <div className={`p-2 rounded-xl ${card.iconBg} ${card.iconColor}`}>
              {card.icon}
            </div>
          </div>
          <p className={`text-3xl font-bold ${card.textColor}`}>
            {card.value}
          </p>
        </div>
      ))}
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
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">AI Recommendations</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Unable to load recommendations. Please try refreshing.
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Waste Alerts</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Unable to load waste alerts. Please try refreshing.
          </p>
        </div>
      </div>
    );
  }
}

export default async function DashboardPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">AI-powered insights and recommendations</p>
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

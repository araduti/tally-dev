'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/trpc/client';

// ---------- Serialized types ----------

interface SerializedRecommendation {
  id: string;
  type: 'RIGHT_SIZE' | 'COST_OPTIMIZATION' | 'COMMITMENT_SUGGESTION';
  title: string;
  description: string;
  potentialSavings: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  entityId: string;
  entityType: 'LICENSE' | 'SUBSCRIPTION';
}

interface SerializedWasteAlert {
  id: string;
  type: 'UNUSED_LICENSE' | 'OVER_PROVISIONED' | 'STALE_SUBSCRIPTION' | 'STALE_PENDING_SCALEDOWN';
  title: string;
  description: string;
  estimatedWaste: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  entityId: string;
  entityType: 'LICENSE' | 'SUBSCRIPTION';
  suggestedAction: string;
}

export interface DashboardInsightsProps {
  initialRecommendations: SerializedRecommendation[];
  initialAlerts: SerializedWasteAlert[];
}

// ---------- Helpers ----------

/**
 * Build the "Investigate" URL for a given entity.
 * LICENSE entities link to the licenses page (no detail page exists yet).
 * SUBSCRIPTION entities link to the subscription detail page.
 */
function entityHref(entityType: 'LICENSE' | 'SUBSCRIPTION', entityId: string): string {
  if (entityType === 'SUBSCRIPTION') {
    return `/subscriptions/${entityId}`;
  }
  // Licenses don't have a detail page yet — link to the licenses list
  return '/licenses';
}

/**
 * Choose which action buttons to show for a recommendation type.
 * - RIGHT_SIZE / COST_OPTIMIZATION → "Apply" (goes to entity page to act)
 * - COMMITMENT_SUGGESTION          → "Investigate" only
 */
function recActionLabel(type: SerializedRecommendation['type']): string {
  if (type === 'RIGHT_SIZE' || type === 'COST_OPTIMIZATION') {
    return 'Apply';
  }
  return 'Investigate';
}

// ---------- Severity badge ----------

const severityColors: Record<string, string> = {
  HIGH: 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20',
  MEDIUM: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  LOW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
};

const typeIcons: Record<string, string> = {
  RIGHT_SIZE: '📐',
  COST_OPTIMIZATION: '💰',
  COMMITMENT_SUGGESTION: '📅',
  UNUSED_LICENSE: '🚫',
  OVER_PROVISIONED: '📈',
  STALE_SUBSCRIPTION: '💤',
  STALE_PENDING_SCALEDOWN: '⏳',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${severityColors[severity] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
      {severity}
    </span>
  );
}

// ---------- Main component ----------

export function DashboardInsights({ initialRecommendations, initialAlerts }: DashboardInsightsProps) {
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());

  const dismissAlert = useCallback((alertId: string) => {
    setDismissedAlertIds((prev) => new Set(prev).add(alertId));
  }, []);

  const { data: recData } = api.insights.getRecommendations.useQuery(
    {},
    { initialData: { recommendations: initialRecommendations as any, generatedAt: new Date() } },
  );

  const { data: alertData } = api.insights.getWasteAlerts.useQuery(
    {},
    { initialData: { alerts: initialAlerts as any, analyzedAt: new Date() } },
  );

  const recommendations = (recData?.recommendations ?? initialRecommendations) as SerializedRecommendation[];
  const allAlerts = (alertData?.alerts ?? initialAlerts) as SerializedWasteAlert[];
  const alerts = allAlerts.filter((a) => !dismissedAlertIds.has(a.id));
  const dismissedCount = allAlerts.length - alerts.length;

  return (
    <div className="grid md:grid-cols-2 gap-5">
      {/* AI Recommendations Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06a.75.75 0 1 1-1.06 1.06L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM3 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 8ZM14 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 14 8ZM7.172 10.828a.75.75 0 0 1 0 1.06L6.11 12.95a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM10.766 7.51a.75.75 0 0 0-1.37.365l-.492 6.861a.75.75 0 0 0 1.204.65l1.043-.799.985 3.678a.75.75 0 0 0 1.45-.388l-.978-3.646 1.292.204a.75.75 0 0 0 .536-1.26l-3.67-5.664Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">AI Recommendations</h2>
          </div>
          {recommendations.length > 0 && (
            <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
              {recommendations.length}
            </span>
          )}
        </div>

        {recommendations.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            No recommendations at this time. Your licenses look well-optimized!
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-colors duration-200"
              >
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-sm" aria-hidden="true">{typeIcons[rec.type] ?? '💡'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate">{rec.title}</p>
                      <SeverityBadge severity={rec.severity} />
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{rec.description}</p>
                    {rec.potentialSavings && (
                      <p className="mt-1 text-xs font-medium text-green-400">
                        Potential savings: ${rec.potentialSavings}/mo
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
                  <Link
                    href={entityHref(rec.entityType, rec.entityId)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-slate-800"
                  >
                    {recActionLabel(rec.type)}
                  </Link>
                  {rec.type !== 'COMMITMENT_SUGGESTION' && (
                    <Link
                      href={entityHref(rec.entityType, rec.entityId)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-slate-600 hover:bg-slate-500 text-slate-200 transition focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 focus:ring-offset-slate-800"
                    >
                      Investigate
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waste Alerts Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Waste Alerts</h2>
          </div>
          <div className="flex items-center gap-2">
            {dismissedCount > 0 && (
              <span className="text-xs text-slate-500">{dismissedCount} dismissed</span>
            )}
            {alerts.length > 0 && (
              <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                {alerts.length}
              </span>
            )}
          </div>
        </div>

        {alerts.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {dismissedCount > 0
              ? 'All waste alerts have been dismissed.'
              : 'No waste detected. Your subscriptions and licenses are in good shape.'}
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-colors duration-200"
              >
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-sm" aria-hidden="true">{typeIcons[alert.type] ?? '⚠️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate">{alert.title}</p>
                      <SeverityBadge severity={alert.severity} />
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{alert.description}</p>
                    {alert.estimatedWaste && alert.estimatedWaste !== '0.00' && (
                      <p className="mt-1 text-xs font-medium text-red-400">
                        Estimated waste: ${alert.estimatedWaste}/mo
                      </p>
                    )}
                    <p className="mt-1 text-xs text-blue-400">
                      💡 {alert.suggestedAction}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
                  <Link
                    href={entityHref(alert.entityType, alert.entityId)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-slate-800"
                  >
                    Investigate
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismissAlert(alert.id)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-slate-600 hover:bg-slate-500 text-slate-200 transition focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 focus:ring-offset-slate-800"
                    aria-label={`Dismiss alert: ${alert.title}`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

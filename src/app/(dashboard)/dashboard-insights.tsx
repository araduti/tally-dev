'use client';

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

// ---------- Severity badge ----------

const severityColors: Record<string, string> = {
  HIGH: 'bg-red-900/40 text-red-300 border-red-700',
  MEDIUM: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',
  LOW: 'bg-blue-900/40 text-blue-300 border-blue-700',
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
  const { data: recData } = api.insights.getRecommendations.useQuery(
    {},
    { initialData: { recommendations: initialRecommendations as any, generatedAt: new Date() } },
  );

  const { data: alertData } = api.insights.getWasteAlerts.useQuery(
    {},
    { initialData: { alerts: initialAlerts as any, analyzedAt: new Date() } },
  );

  const recommendations = (recData?.recommendations ?? initialRecommendations) as SerializedRecommendation[];
  const alerts = (alertData?.alerts ?? initialAlerts) as SerializedWasteAlert[];

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* AI Recommendations Panel */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">AI Recommendations</h2>
          {recommendations.length > 0 && (
            <span className="text-xs text-slate-400">{recommendations.length} suggestion{recommendations.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {recommendations.length === 0 ? (
          <p className="text-slate-400 text-sm">
            No recommendations at this time. Your licenses look well-optimized!
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-3 rounded-lg bg-slate-700/30 border border-slate-700 hover:border-slate-600 transition"
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
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waste Alerts Panel */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Waste Alerts</h2>
          {alerts.length > 0 && (
            <span className="text-xs text-slate-400">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {alerts.length === 0 ? (
          <p className="text-slate-400 text-sm">
            No waste detected. Your subscriptions and licenses are in good shape.
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-3 rounded-lg bg-slate-700/30 border border-slate-700 hover:border-slate-600 transition"
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubscriptionDetailLoading() {
  return (
    <div>
      {/* Back link skeleton */}
      <div className="mb-6">
        <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
      </div>

      {/* Header skeleton */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="h-8 w-64 skeleton-shimmer rounded-lg mb-2" />
          <div className="h-4 w-48 skeleton-shimmer rounded-lg" />
        </div>
        <div className="h-6 w-20 skeleton-shimmer rounded-full" />
      </div>

      {/* Info cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
            <div className="h-3 w-24 skeleton-shimmer rounded-lg mb-3" />
            <div className="h-5 w-32 skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>

      {/* Licenses table skeleton */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="h-5 w-24 skeleton-shimmer rounded-lg" />
        </div>
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex gap-6">
          {['Product', 'Quantity', 'Pending', 'Unit Cost', 'Status', 'Actions'].map((h) => (
            <div key={h} className="h-3 w-20 skeleton-shimmer rounded-lg" />
          ))}
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex gap-6">
            <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-20 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-24 skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

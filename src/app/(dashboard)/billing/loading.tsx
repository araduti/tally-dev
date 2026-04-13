export default function BillingLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-24 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-56 skeleton-shimmer rounded-lg" />
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="h-5 w-40 skeleton-shimmer rounded-lg" />
        </div>
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex gap-6">
          {['Bundle', 'Distributor', 'Qty', 'Amount', 'Status', 'Date'].map((h) => (
            <div key={h} className="h-3 w-16 skeleton-shimmer rounded-lg" />
          ))}
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex gap-6">
            <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-20 skeleton-shimmer rounded-lg" />
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

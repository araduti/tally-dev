export default function LicensesLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-48 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-72 skeleton-shimmer rounded-lg" />
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex gap-6">
          {['Bundle', 'Quantity', 'Pending', 'Status', 'Actions'].map((h) => (
            <div key={h} className="h-3 w-20 skeleton-shimmer rounded-lg" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex gap-6">
            <div className="h-4 w-32 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-12 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
            <div className="h-4 w-24 skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

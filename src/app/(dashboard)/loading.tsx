export default function DashboardLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-40 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-64 skeleton-shimmer rounded-lg" />
      </div>
      <div className="grid md:grid-cols-3 gap-5 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="h-3 w-24 skeleton-shimmer rounded-lg" />
              <div className="h-9 w-9 skeleton-shimmer rounded-xl" />
            </div>
            <div className="h-9 w-24 skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
            <div className="h-5 w-40 skeleton-shimmer rounded-lg mb-4" />
            <div className="space-y-3">
              <div className="h-20 skeleton-shimmer rounded-xl" />
              <div className="h-20 skeleton-shimmer rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

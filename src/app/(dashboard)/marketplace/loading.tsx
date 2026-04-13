export default function MarketplaceLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-36 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-72 skeleton-shimmer rounded-lg" />
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 mb-6">
        <div className="h-10 w-full skeleton-shimmer rounded-lg" />
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800">
            <div className="h-5 w-40 skeleton-shimmer rounded-lg mb-3" />
            <div className="h-3 w-24 skeleton-shimmer rounded-lg mb-3" />
            <div className="space-y-1.5 mb-3">
              <div className="h-3 w-32 skeleton-shimmer rounded-lg" />
              <div className="h-3 w-28 skeleton-shimmer rounded-lg" />
            </div>
            <div className="h-9 w-full skeleton-shimmer rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

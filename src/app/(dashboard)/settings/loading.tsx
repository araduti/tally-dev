export default function SettingsLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-28 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-64 skeleton-shimmer rounded-lg" />
      </div>
      <div className="space-y-6">
        {/* Organization Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
          <div className="h-5 w-36 skeleton-shimmer rounded-lg mb-4" />
          <div className="space-y-3">
            <div className="h-4 w-48 skeleton-shimmer rounded-lg" />
            <div className="h-10 w-full skeleton-shimmer rounded-lg" />
          </div>
        </div>
        {/* Vendor Connections Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
          <div className="h-5 w-44 skeleton-shimmer rounded-lg mb-4" />
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-20 skeleton-shimmer rounded-lg" />
                  <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
                </div>
                <div className="h-8 w-24 skeleton-shimmer rounded-lg" />
              </div>
            ))}
          </div>
        </div>
        {/* Team Members Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
          <div className="h-5 w-32 skeleton-shimmer rounded-lg mb-4" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 skeleton-shimmer rounded-full" />
                  <div>
                    <div className="h-4 w-28 skeleton-shimmer rounded-lg mb-1" />
                    <div className="h-3 w-36 skeleton-shimmer rounded-lg" />
                  </div>
                </div>
                <div className="h-4 w-16 skeleton-shimmer rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

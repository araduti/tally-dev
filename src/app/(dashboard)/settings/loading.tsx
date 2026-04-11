export default function SettingsLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-28 bg-slate-700 rounded animate-pulse mb-2" />
        <div className="h-4 w-64 bg-slate-700/50 rounded animate-pulse" />
      </div>
      <div className="space-y-6">
        {/* Organization Section */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-36 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            <div className="h-4 w-48 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-10 w-full bg-slate-700/50 rounded-lg animate-pulse" />
          </div>
        </div>
        {/* Vendor Connections Section */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-44 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-20 bg-slate-700/50 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
                </div>
                <div className="h-8 w-24 bg-slate-700/50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
        {/* Team Members Section */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-32 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between py-3 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-slate-700/50 rounded-full animate-pulse" />
                  <div>
                    <div className="h-4 w-28 bg-slate-700/50 rounded animate-pulse mb-1" />
                    <div className="h-3 w-36 bg-slate-700/50 rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

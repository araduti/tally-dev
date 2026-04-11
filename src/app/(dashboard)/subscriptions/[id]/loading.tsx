export default function SubscriptionDetailLoading() {
  return (
    <div>
      {/* Back link skeleton */}
      <div className="mb-6">
        <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
      </div>

      {/* Header skeleton */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="h-8 w-64 bg-slate-700 rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="h-6 w-20 bg-slate-700 rounded-full animate-pulse" />
      </div>

      {/* Info cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <div className="h-3 w-24 bg-slate-700 rounded animate-pulse mb-3" />
            <div className="h-5 w-32 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Licenses table skeleton */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="h-5 w-24 bg-slate-700 rounded animate-pulse" />
        </div>
        <div className="px-6 py-3 border-b border-slate-700 flex gap-6">
          {['Product', 'Quantity', 'Pending', 'Unit Cost', 'Status', 'Actions'].map((h) => (
            <div key={h} className="h-3 w-20 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-700/50 flex gap-6">
            <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

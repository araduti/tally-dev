export default function MarketplaceLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-36 bg-slate-700 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-700/50 rounded animate-pulse" />
      </div>
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="h-10 w-full bg-slate-700 rounded-lg animate-pulse" />
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="h-5 w-40 bg-slate-700/50 rounded animate-pulse mb-3" />
            <div className="h-3 w-24 bg-slate-700/50 rounded animate-pulse mb-3" />
            <div className="space-y-1.5 mb-3">
              <div className="h-3 w-32 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-3 w-28 bg-slate-700/50 rounded animate-pulse" />
            </div>
            <div className="h-9 w-full bg-slate-700 rounded-lg animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

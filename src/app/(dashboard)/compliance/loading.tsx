export default function ComplianceLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-36 bg-slate-700 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-700/50 rounded animate-pulse" />
      </div>
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-24 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse mb-2" />
          <div className="h-4 w-40 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-5 w-32 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-4 w-36 bg-slate-700/50 rounded animate-pulse mb-2" />
          <div className="h-4 w-28 bg-slate-700/50 rounded animate-pulse" />
        </div>
      </div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-700 flex gap-6">
          {['Action', 'User', 'Entity', 'Date'].map((h) => (
            <div key={h} className="h-3 w-16 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-700/50 flex gap-6">
            <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

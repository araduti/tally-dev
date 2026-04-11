export default function LicensesLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-48 bg-slate-700 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-700/50 rounded animate-pulse" />
      </div>
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-700 flex gap-6">
          {['Bundle', 'Quantity', 'Pending', 'Status', 'Actions'].map((h) => (
            <div key={h} className="h-3 w-20 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-700/50 flex gap-6">
            <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

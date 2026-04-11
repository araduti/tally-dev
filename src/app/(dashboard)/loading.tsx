export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-8 w-40 bg-slate-700 rounded mb-2" />
        <div className="h-4 w-64 bg-slate-700/50 rounded" />
      </div>
      <div className="grid md:grid-cols-3 gap-6 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="h-3 w-20 bg-slate-700 rounded mb-3" />
            <div className="h-9 w-24 bg-slate-700/50 rounded" />
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="h-5 w-32 bg-slate-700 rounded mb-4" />
            <div className="h-3 w-48 bg-slate-700/50 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-slate-400">AI-powered insights and recommendations</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Active Licenses</p>
          <p className="text-3xl font-bold text-white">—</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Monthly Spend</p>
          <p className="text-3xl font-bold text-white">—</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <p className="text-sm text-slate-400 mb-1">Potential Savings</p>
          <p className="text-3xl font-bold text-green-400">—</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">AI Recommendations</h2>
          <p className="text-slate-400 text-sm">
            Connect a vendor to receive AI-powered optimization recommendations.
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">Waste Alerts</h2>
          <p className="text-slate-400 text-sm">
            No waste detected. Connect vendors to start monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}

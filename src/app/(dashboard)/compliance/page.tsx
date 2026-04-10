export default function CompliancePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Compliance</h1>
        <p className="mt-1 text-slate-400">DPA status, contract signing, and audit trail</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">DPA Status</h2>
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-yellow-400" aria-hidden="true"></span>
            <span className="text-slate-300">Not yet accepted</span>
          </div>
          <button className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Accept DPA
          </button>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold text-white mb-4">Contract Status</h2>
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-yellow-400" aria-hidden="true"></span>
            <span className="text-slate-300">Unsigned</span>
          </div>
          <button className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Sign Contract
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Audit Log</h2>
        </div>
        <div className="p-6 text-center text-slate-400">
          No audit entries yet. Actions will be logged here automatically.
        </div>
      </div>
    </div>
  );
}

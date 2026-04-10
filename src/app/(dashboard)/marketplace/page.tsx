export default function MarketplacePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Marketplace</h1>
        <p className="mt-1 text-slate-400">
          Compare pricing across distributors and purchase with one click
        </p>
      </div>

      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="flex items-center gap-4">
          <input
            type="search"
            placeholder="Search bundles (e.g., Microsoft 365 E3)..."
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search bundles"
          />
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Search
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="p-6 text-center">
          <p className="text-slate-400">
            Search for a bundle to see cross-distributor pricing comparison.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Prices are fetched in real-time from all connected distributors.
          </p>
        </div>
      </div>
    </div>
  );
}

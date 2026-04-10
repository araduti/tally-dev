export default function SubscriptionsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Subscriptions</h1>
        <p className="mt-1 text-slate-400">
          Active subscriptions and their lifecycle status
        </p>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full" aria-label="Subscriptions">
          <thead>
            <tr className="border-b border-slate-700 text-left">
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Bundle</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Distributor</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Commitment End</th>
              <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                No subscriptions found. Visit the Marketplace to purchase.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

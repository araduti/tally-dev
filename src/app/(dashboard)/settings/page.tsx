export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">Organization settings, vendor connections, and team management</p>
      </div>

      {/* Organization Info */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Organization</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Organization Name</label>
            <input
              type="text"
              className="w-full max-w-md px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Your Organization"
            />
          </div>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Save Changes
          </button>
        </div>
      </div>

      {/* Vendor Connections */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Vendor Connections</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Add Connection
          </button>
        </div>
        <p className="text-slate-400 text-sm">
          No vendor connections configured. Connect a distributor to enable catalog sync and purchasing.
        </p>
      </div>

      {/* Team Members */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Team Members</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition">
            Invite Member
          </button>
        </div>
        <p className="text-slate-400 text-sm">
          Manage your team and their roles within the organization.
        </p>
      </div>
    </div>
  );
}

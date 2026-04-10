import Link from 'next/link';

const navigation = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Marketplace', href: '/marketplace', icon: '🛒' },
  { name: 'Licenses', href: '/licenses', icon: '📋' },
  { name: 'Subscriptions', href: '/subscriptions', icon: '📦' },
  { name: 'Compliance', href: '/compliance', icon: '🔒' },
  { name: 'Settings', href: '/settings', icon: '⚙️' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <Link href="/" className="text-xl font-bold text-white">
            Tally
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1" aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition"
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* Org Switcher Placeholder */}
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
              T
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">Active Org</p>
              <p className="text-xs text-slate-400 truncate">Organization</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

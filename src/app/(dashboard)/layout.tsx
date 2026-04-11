import Link from 'next/link';
import OrgSwitcher from './org-switcher';
import { MobileSidebarToggle } from './mobile-sidebar';

const navigation = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Marketplace', href: '/marketplace', icon: '🛒' },
  { name: 'Licenses', href: '/licenses', icon: '📋' },
  { name: 'Subscriptions', href: '/subscriptions', icon: '📦' },
  { name: 'Compliance', href: '/compliance', icon: '🔒' },
  { name: 'Settings', href: '/settings', icon: '⚙️' },
];

function Sidebar({ className }: { className?: string }) {
  return (
    <aside className={`w-64 bg-slate-800 border-r border-slate-700 flex flex-col ${className ?? ''}`}>
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
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <OrgSwitcher />
      </div>
    </aside>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Desktop Sidebar — hidden on mobile */}
      <Sidebar className="hidden md:flex" />

      {/* Mobile Sidebar — overlay toggled by button */}
      <MobileSidebarToggle navigation={navigation} />

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Mobile header with menu button */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800">
          <button
            type="button"
            className="text-slate-300 hover:text-white p-1"
            aria-label="Open navigation menu"
            data-mobile-menu-trigger
          >
            <span className="text-xl" aria-hidden="true">☰</span>
          </button>
          <span className="text-lg font-bold text-white">Tally</span>
        </div>

        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}

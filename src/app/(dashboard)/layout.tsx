import Link from 'next/link';
import OrgSwitcher from './org-switcher';
import UserProfileMenu from './user-profile-menu';
import { MobileSidebarToggle, MobileMenuButton } from './mobile-sidebar';
import { MobileSidebarProvider } from './mobile-sidebar-context';
import Breadcrumbs from './breadcrumbs';
import { ThemeProvider } from './theme-provider';
import { ThemeToggle } from './theme-toggle';
import { CommandPalette, CommandPaletteButton } from './command-palette';
import NotificationBell from './notification-bell';
import { KeyboardShortcutProvider } from './keyboard-shortcuts';

const navigation = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Marketplace', href: '/marketplace', icon: '🛒' },
  { name: 'Licenses', href: '/licenses', icon: '📋' },
  { name: 'Subscriptions', href: '/subscriptions', icon: '📦' },
  { name: 'Billing', href: '/billing', icon: '💳' },
  { name: 'Compliance', href: '/compliance', icon: '🔒' },
  { name: 'Settings', href: '/settings', icon: '⚙️' },
];

function Sidebar({ className }: { className?: string }) {
  return (
    <aside className={`w-64 bg-slate-900 dark:bg-slate-900 bg-white border-r border-slate-200 dark:border-slate-800 flex flex-col ${className ?? ''}`}>
      <div className="p-5 border-b border-slate-200 dark:border-slate-800">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-sm font-bold text-white">T</span>
          </div>
          <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Tally</span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="group flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition-all duration-200"
          >
            <span className="text-base flex items-center justify-center w-6" aria-hidden="true">{item.icon}</span>
            <span className="font-medium">{item.name}</span>
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
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
    <ThemeProvider>
      <KeyboardShortcutProvider>
        <MobileSidebarProvider>
          <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex">
            {/* Desktop Sidebar — hidden on mobile */}
            <Sidebar className="hidden md:flex" />

            {/* Mobile Sidebar — overlay toggled by button */}
            <MobileSidebarToggle navigation={navigation} />

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
              {/* Desktop header */}
              <div className="hidden md:flex items-center justify-end gap-3 px-6 md:px-8 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
                <CommandPaletteButton />
                <ThemeToggle />
                <NotificationBell />
                <UserProfileMenu />
              </div>

              {/* Mobile header */}
              <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
                <MobileMenuButton />
                <div className="flex items-center gap-2 flex-1">
                  <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">T</span>
                  </div>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">Tally</span>
                </div>
                <ThemeToggle />
                <NotificationBell />
                <UserProfileMenu />
              </div>

              <div className="p-4 md:p-8">
                <Breadcrumbs />
                {children}
              </div>
            </main>

            {/* Command Palette — rendered here so it overlays everything */}
            <CommandPalette />
          </div>
        </MobileSidebarProvider>
      </KeyboardShortcutProvider>
    </ThemeProvider>
  );
}

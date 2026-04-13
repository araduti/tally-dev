'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMobileSidebar } from './mobile-sidebar-context';

interface NavigationItem {
  name: string;
  href: string;
  icon: React.ReactNode;
}

export function MobileSidebarToggle({
  navigation,
}: {
  navigation: NavigationItem[];
}) {
  const { isOpen, close } = useMobileSidebar();
  const pathname = usePathname();

  // Close sidebar on navigation
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Close on escape key and prevent body scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={close}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <aside
        className="absolute left-0 top-0 bottom-0 w-64 bg-slate-800 border-r border-slate-700 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            Tally
          </Link>
          <button
            type="button"
            onClick={close}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Close navigation menu"
          >
            <span className="text-xl" aria-hidden="true">✕</span>
          </button>
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
      </aside>
    </div>
  );
}

export function MobileMenuButton() {
  const { isOpen, toggle } = useMobileSidebar();

  return (
    <button
      type="button"
      className="text-slate-300 hover:text-white p-1"
      aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
      aria-expanded={isOpen}
      aria-controls="mobile-sidebar"
      onClick={toggle}
    >
      <span className="text-xl" aria-hidden="true">☰</span>
    </button>
  );
}

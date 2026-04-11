'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavigationItem {
  name: string;
  href: string;
  icon: string;
}

export function MobileSidebarToggle({
  navigation,
}: {
  navigation: NavigationItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Close sidebar on navigation
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close on escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setIsOpen(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // Listen for trigger button click
  useEffect(() => {
    const handler = () => setIsOpen(true);
    const trigger = document.querySelector('[data-mobile-menu-trigger]');
    if (trigger) {
      trigger.addEventListener('click', handler);
      return () => trigger.removeEventListener('click', handler);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => setIsOpen(false)}
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
            onClick={() => setIsOpen(false)}
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

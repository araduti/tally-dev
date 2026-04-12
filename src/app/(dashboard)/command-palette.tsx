'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Navigation items — static links that always appear
// ---------------------------------------------------------------------------

const navigationItems = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Marketplace', href: '/marketplace', icon: '🛒' },
  { name: 'Licenses', href: '/licenses', icon: '📋' },
  { name: 'Subscriptions', href: '/subscriptions', icon: '📦' },
  { name: 'Billing', href: '/billing', icon: '💳' },
  { name: 'Compliance', href: '/compliance', icon: '🔒' },
  { name: 'Settings', href: '/settings', icon: '⚙️' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Header button that opens the command palette via ⌘K.
 * Rendered separately so it can live in the header bar.
 */
export function CommandPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => {
        // Dispatch the same keyboard shortcut the palette listens for
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
        );
      }}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg transition"
      aria-label="Open command palette"
    >
      {/* Magnifying glass */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="hidden lg:inline">Search…</span>
      <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-800 rounded border border-slate-600">
        ⌘K
      </kbd>
    </button>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // ---- Filtered results ---------------------------------------------------

  const filtered = query.trim() === ''
    ? navigationItems
    : navigationItems.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      );

  // ---- Open / close helpers -----------------------------------------------

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  // ---- Global ⌘K / Ctrl+K shortcut ---------------------------------------

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setQuery('');
            setSelectedIndex(0);
          }
          return !prev;
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ---- Focus input when opened --------------------------------------------

  useEffect(() => {
    if (open) {
      // Wait one tick for the DOM to mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ---- Click outside to close ---------------------------------------------

  useEffect(() => {
    if (!open) return;

    function onMouseDown(e: MouseEvent) {
      if (overlayRef.current && e.target === overlayRef.current) {
        closePalette();
      }
    }

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, closePalette]);

  // ---- Navigate to selected item ------------------------------------------

  const navigate = useCallback(
    (href: string) => {
      closePalette();
      router.push(href);
    },
    [closePalette, router],
  );

  // ---- Keyboard navigation inside the dialog ------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(filtered.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = filtered[selectedIndex];
        if (target) navigate(target.href);
      }
    },
    [closePalette, filtered, selectedIndex, navigate],
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // ---- Render nothing when closed -----------------------------------------

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg mx-4 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          {/* Magnifying glass icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5 text-slate-400 shrink-0"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
              clipRule="evenodd"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm focus:outline-none"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-700 rounded border border-slate-600">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <ul className="max-h-72 overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-slate-500">
              No results found.
            </li>
          ) : (
            <>
              <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Navigation
              </li>
              {filtered.map((item, index) => (
                <li
                  key={item.href}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer transition ${
                    index === selectedIndex
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                  onClick={() => navigate(item.href)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.name}</span>
                </li>
              ))}
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

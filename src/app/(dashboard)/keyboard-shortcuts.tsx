'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Shortcut definitions
// ---------------------------------------------------------------------------

interface ShortcutDef {
  /** Display label (e.g. "g → d") */
  keys: string;
  /** Human-readable description */
  description: string;
}

const SHORTCUT_GROUPS: { title: string; items: ShortcutDef[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: 'g → d', description: 'Go to Dashboard' },
      { keys: 'g → l', description: 'Go to Licenses' },
      { keys: 'g → s', description: 'Go to Subscriptions' },
      { keys: 'g → b', description: 'Go to Billing' },
      { keys: 'g → c', description: 'Go to Compliance' },
      { keys: 'g → t', description: 'Go to Settings' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: '?', description: 'Show keyboard shortcuts' },
    ],
  },
];

/** Navigation targets for g → <key> sequences. */
const NAV_TARGETS: Record<string, string> = {
  d: '/marketplace',
  l: '/licenses',
  s: '/subscriptions',
  b: '/billing',
  c: '/compliance',
  t: '/settings',
};

/** Timeout for the second key in a two-key sequence (ms). */
const SEQUENCE_TIMEOUT = 1000;

// ---------------------------------------------------------------------------
// Help Modal
// ---------------------------------------------------------------------------

function ShortcutsHelpModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click-outside
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={onClose}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm"
                  >
                    <span className="text-slate-300">{item.description}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.split(' ').map((part, i) =>
                        part === '→' ? (
                          <span key={i} className="text-slate-500 text-xs">
                            then
                          </span>
                        ) : (
                          <kbd
                            key={i}
                            className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-slate-600 bg-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-300"
                          >
                            {part}
                          </kbd>
                        ),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Returns true if the active element is an input-like element. */
function isTyping(): boolean {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (document.activeElement?.getAttribute('contenteditable') === 'true')
    return true;
  return false;
}

export function KeyboardShortcutProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    pendingKeyRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire when user is typing in an input
      if (isTyping()) return;

      // Don't intercept modifier-combos (except Shift for ?)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      // --- Help modal: ? or Shift+/ ---
      if (key === '?') {
        e.preventDefault();
        setHelpOpen((prev) => !prev);
        clearPending();
        return;
      }

      // --- Two-key sequence: waiting for second key ---
      if (pendingKeyRef.current === 'g') {
        const target = NAV_TARGETS[key];
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        clearPending();
        return;
      }

      // --- Start two-key sequence ---
      if (key === 'g') {
        e.preventDefault();
        pendingKeyRef.current = 'g';
        timerRef.current = setTimeout(clearPending, SEQUENCE_TIMEOUT);
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearPending();
    };
  }, [router, clearPending]);

  return (
    <>
      {children}
      {helpOpen && (
        <ShortcutsHelpModal onClose={() => setHelpOpen(false)} />
      )}
    </>
  );
}

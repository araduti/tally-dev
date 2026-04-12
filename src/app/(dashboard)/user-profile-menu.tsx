'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { api } from '@/trpc/client';

/** Deterministic background colour from the first character of a name. */
function avatarColor(name: string): string {
  const colors = [
    'bg-blue-600',
    'bg-emerald-600',
    'bg-violet-600',
    'bg-amber-600',
    'bg-rose-600',
    'bg-cyan-600',
    'bg-fuchsia-600',
    'bg-lime-600',
  ];
  const code = name.charCodeAt(0) || 0;
  return colors[code % colors.length]!;
}

/** Returns the user's initials (up to 2 characters). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return (name.charAt(0) || '?').toUpperCase();
}

function SkeletonAvatar() {
  return (
    <div
      className="h-8 w-8 animate-pulse rounded-full bg-slate-600"
      aria-busy="true"
      aria-label="Loading user profile"
    />
  );
}

export default function UserProfileMenu() {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Data fetching --------------------------------------------------------
  const userQuery = api.user.me.useQuery({});
  const orgQuery = api.organization.get.useQuery({});

  const user = userQuery.data;
  const org = orgQuery.data;

  // --- Close dropdown on outside click or Escape ----------------------------
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  // --- Sign out handler -----------------------------------------------------
  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const res = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login';
      }
    } catch {
      // If the sign-out call fails, redirect to login anyway so the user
      // isn't stuck. The server will reject subsequent authenticated
      // requests, forcing re-authentication.
      window.location.href = '/login';
    }
  }, []);

  // --- Loading state --------------------------------------------------------
  if (userQuery.isLoading) {
    return <SkeletonAvatar />;
  }

  if (!user) {
    return null;
  }

  const displayName = user.name || 'User';

  return (
    <div ref={containerRef} className="relative">
      {/* Avatar trigger button */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`User menu for ${displayName}`}
        className="flex items-center gap-2 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => setOpen((prev) => !prev)}
      >
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="h-8 w-8 rounded-full object-cover ring-2 ring-slate-600"
          />
        ) : (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-slate-600 ${avatarColor(displayName)}`}
            aria-hidden="true"
          >
            {initials(displayName)}
          </span>
        )}
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          role="menu"
          aria-label="User menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-xl"
        >
          {/* User info section */}
          <div className="border-b border-slate-700 px-4 py-3">
            <p className="truncate text-sm font-medium text-white">
              {displayName}
            </p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>

          {/* Organization section */}
          {org && (
            <div className="border-b border-slate-700 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Organization
              </p>
              <p className="mt-0.5 truncate text-sm text-slate-300">
                {org.name}
              </p>
            </div>
          )}

          {/* Actions section */}
          <div className="p-2">
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-700/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSignOut}
            >
              {/* Log-out icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect } from 'react';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Settings error:', error);
  }, [error]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">
          Organization settings, vendor connections, and team management
        </p>
      </div>
      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-semibold text-white mb-2">Unable to load settings</h2>
        <p className="text-slate-400 text-sm mb-4">
          An error occurred while loading organization settings. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

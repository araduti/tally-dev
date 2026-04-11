'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to error reporting service in production
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4" aria-hidden="true">⚠️</div>
        <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-slate-400 text-sm mb-6">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

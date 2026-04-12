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
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-500/20 p-8 max-w-md w-full text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10 text-red-500 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Something went wrong</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white text-sm font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

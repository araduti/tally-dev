'use client';

import { useEffect } from 'react';

export default function ComplianceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Compliance error:', error);
  }, [error]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Compliance & Audit</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          DPA status, contract compliance, and audit trail
        </p>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-500/20 p-8 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10 text-red-500 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Unable to load compliance data</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
          An error occurred while loading compliance information. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white text-sm font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

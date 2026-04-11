'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-900">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-slate-800 rounded-xl border border-red-700/50 p-8 max-w-md w-full text-center">
            <div className="text-5xl mb-4" aria-hidden="true">💥</div>
            <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-slate-400 text-sm mb-6">
              An unexpected error occurred. Please try again or return to the dashboard.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={reset}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
              >
                Try Again
              </button>
              <Link
                href="/"
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm font-medium transition"
              >
                Go Home
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

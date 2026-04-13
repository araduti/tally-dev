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
      <body className="bg-slate-950">
        <div className="min-h-screen flex items-center justify-center px-6 py-12">
          <div className="fixed inset-0 -z-10" aria-hidden="true">
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-[120px]" />
          </div>
          <div className="w-full max-w-md animate-fade-in">
            <div className="flex items-center justify-center gap-2 mb-8">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                <span className="text-sm font-bold text-white">T</span>
              </div>
              <span className="text-xl font-bold text-white">Tally</span>
            </div>
            <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl border border-slate-800 p-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10 text-red-500 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
              <p className="text-slate-400 text-sm mb-8">
                An unexpected error occurred. Please try again or return to the dashboard.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={reset}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white text-sm font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
                >
                  Try Again
                </button>
                <Link
                  href="/"
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-white text-sm font-semibold transition-all duration-200"
                >
                  Go Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

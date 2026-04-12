'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function SubscriptionDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Subscription detail error:', error);
  }, [error]);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
        >
          <span aria-hidden="true">←</span>
          Back to Subscriptions
        </Link>
      </div>

      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-semibold text-white mb-2">Unable to load subscription</h2>
        <p className="text-slate-400 text-sm mb-4">
          An error occurred while loading this subscription. Please try again.
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

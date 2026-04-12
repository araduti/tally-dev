'use client';

export default function CreateLicenseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create License</h1>
      </div>

      <div className="bg-slate-800 rounded-xl border border-red-700/50 p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-400 mb-4">
          {error.message || 'An unexpected error occurred while loading the form.'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            Try Again
          </button>
          <a
            href="/licenses"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm font-medium transition"
          >
            Back to Licenses
          </a>
        </div>
      </div>
    </div>
  );
}

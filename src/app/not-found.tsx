import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🔍</div>
        <h1 className="text-4xl font-bold text-white mb-2">404</h1>
        <p className="text-xl text-slate-400 mb-6">Page not found</p>
        <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

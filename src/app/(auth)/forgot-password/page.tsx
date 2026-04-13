'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo: '/reset-password' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Failed to send reset email');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-12">
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-blue-600/15 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-violet-600/10 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
            <span className="text-sm font-bold text-white">T</span>
          </div>
          <span className="text-xl font-bold text-white">Tally</span>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border border-slate-800">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">Reset Password</h1>

          {submitted ? (
            <div>
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm" role="status">
                If an account exists with that email, a password reset link has been sent. Please check your inbox.
              </div>
              <Link
                href="/login"
                className="block text-center text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                ← Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-6 text-center">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm" role="alert">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors duration-200"
                    placeholder="you@company.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Sending…
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-500">
                Remember your password?{' '}
                <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                  Sign In
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

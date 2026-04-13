'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Failed to reset password');
        return;
      }

      setSuccess(true);
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
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
          <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border border-slate-800 text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Invalid Link</h1>
            <p className="text-slate-400 mb-6 text-sm">
              This password reset link is invalid or has expired.
            </p>
            <Link href="/forgot-password" className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">
              Request a new reset link
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (success) {
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
            <h1 className="text-2xl font-bold text-white mb-6 text-center">Set New Password</h1>
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm" role="status">
              Your password has been reset successfully.
            </div>
            <Link
              href="/login"
              className="block text-center w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
            >
              Sign In
            </Link>
          </div>
        </div>
      </main>
    );
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
          <h1 className="text-2xl font-bold text-white mb-6 text-center">Set New Password</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors duration-200"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors duration-200"
                placeholder="Repeat your new password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Resetting...
                </span>
              ) : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-12">
        <div className="animate-fade-in">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
              <span className="text-sm font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">Tally</span>
          </div>
          <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border border-slate-800 text-center">
            <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-400 text-sm">Loading...</p>
          </div>
        </div>
      </main>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}

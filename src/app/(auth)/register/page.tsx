'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface EnabledProviders {
  google: boolean;
  microsoft: boolean;
}

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [providers, setProviders] = useState<EnabledProviders>({ google: false, microsoft: false });

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => res.json())
      .then((data: EnabledProviders) => setProviders(data))
      .catch(() => {
        // Provider endpoint unavailable — show email/password only.
        // This is expected in dev when the endpoint hasn't loaded yet.
        console.warn('[Register] Failed to fetch OAuth provider flags');
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message ?? 'Registration failed');
        return;
      }

      // Show "check your email" instead of redirecting
      setEmailSent(true);
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  function handleOAuth(provider: 'google' | 'microsoft') {
    window.location.href = `/api/auth/sign-in/social?provider=${provider}&callbackURL=/onboarding`;
  }

  // Post-registration: show email verification notice
  if (emailSent) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-full max-w-md bg-slate-800 rounded-xl p-8 border border-slate-700 text-center">
          <div className="mb-4 text-blue-400">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-slate-400 mb-4">
            We&apos;ve sent a verification link to <span className="text-white font-medium">{email}</span>.
            Click the link in the email to verify your account.
          </p>
          <p className="text-sm text-slate-500">
            Didn&apos;t receive the email? Check your spam folder or{' '}
            <button
              type="button"
              onClick={() => setEmailSent(false)}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              try again
            </button>
            .
          </p>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already verified?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const hasOAuth = providers.google || providers.microsoft;

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md bg-slate-800 rounded-xl p-8 border border-slate-700">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Create your Tally account</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">
            {error}
          </div>
        )}

        {/* OAuth buttons */}
        {hasOAuth && (
          <>
            <div className="space-y-3 mb-6">
              {providers.google && (
                <button
                  type="button"
                  onClick={() => handleOAuth('google')}
                  className="w-full flex items-center justify-center gap-3 py-2 px-4 bg-white hover:bg-gray-100 rounded-lg text-gray-800 font-medium transition border border-gray-300"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
              )}
              {providers.microsoft && (
                <button
                  type="button"
                  onClick={() => handleOAuth('microsoft')}
                  className="w-full flex items-center justify-center gap-3 py-2 px-4 bg-white hover:bg-gray-100 rounded-lg text-gray-800 font-medium transition border border-gray-300"
                >
                  <svg className="h-5 w-5" viewBox="0 0 21 21">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                  </svg>
                  Continue with Microsoft
                </button>
              )}
            </div>
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-slate-800 text-slate-400">or continue with email</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1">
              Full Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Smith"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium transition"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'no-token'>(
    token ? 'verifying' : 'no-token',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;

    const verificationToken = token;

    async function verifyEmail() {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`, {
          method: 'GET',
        });

        if (res.ok) {
          setStatus('success');
          setMessage('Your email has been verified successfully.');
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus('error');
          setMessage(data.message ?? 'Verification failed. The link may have expired.');
        }
      } catch {
        setStatus('error');
        setMessage('An unexpected error occurred during verification.');
      }
    }

    verifyEmail();
  }, [token]);

  return (
    <div className="w-full max-w-md animate-fade-in">
      <div className="flex items-center justify-center gap-2 mb-8">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
          <span className="text-sm font-bold text-white">T</span>
        </div>
        <span className="text-xl font-bold text-white">Tally</span>
      </div>
      <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border border-slate-800 text-center">
        {status === 'verifying' && (
          <>
            <div className="mb-4">
              <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none" role="status" aria-label="Verifying">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Verifying your email</h1>
            <p className="text-slate-400">Please wait while we verify your email address...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mb-4 text-green-400">
              <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Email verified!</h1>
            <p className="text-slate-400 mb-8">{message}</p>
            <Link
              href="/login"
              className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
            >
              Sign in to your account
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-4 text-red-400">
              <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Verification failed</h1>
            <p className="text-slate-400 mb-6">{message}</p>
            <Link
              href="/register"
              className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
            >
              Try registering again
            </Link>
          </>
        )}

        {status === 'no-token' && (
          <>
            <div className="mb-4 text-yellow-400">
              <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">No verification token</h1>
            <p className="text-slate-400 mb-6">
              This page requires a valid verification link. Check your email for the verification link we sent you.
            </p>
            <Link
              href="/login"
              className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
            >
              Go to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="w-full max-w-md animate-fade-in">
      <div className="flex items-center justify-center gap-2 mb-8">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
          <span className="text-sm font-bold text-white">T</span>
        </div>
        <span className="text-xl font-bold text-white">Tally</span>
      </div>
      <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border border-slate-800 text-center">
        <div className="mb-4">
          <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Loading…</h1>
        <p className="text-slate-400">Please wait…</p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-12">
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-blue-600/15 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-violet-600/10 rounded-full blur-[100px]" />
      </div>
      <Suspense fallback={<VerifyEmailFallback />}>
        <VerifyEmailContent />
      </Suspense>
    </main>
  );
}

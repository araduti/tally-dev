'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'no-token'>(
    token ? 'verifying' : 'no-token',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;

    async function verifyEmail() {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token!)}`, {
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
    <main className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md bg-slate-800 rounded-xl p-8 border border-slate-700 text-center">
        {status === 'verifying' && (
          <>
            <div className="mb-4">
              <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
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
            <p className="text-slate-400 mb-6">{message}</p>
            <Link
              href="/login"
              className="inline-block w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition"
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
              className="inline-block w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition"
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
              className="inline-block w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition"
            >
              Go to Sign In
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

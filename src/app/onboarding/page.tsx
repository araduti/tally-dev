'use client';

import { useState } from 'react';
import Link from 'next/link';

const vendors = [
  { id: 'microsoft', name: 'Microsoft 365', logo: '🟦' },
  { id: 'google', name: 'Google Workspace', logo: '🟥' },
  { id: 'adobe', name: 'Adobe Creative Cloud', logo: '🟩' },
  { id: 'salesforce', name: 'Salesforce', logo: '☁️' },
  { id: 'slack', name: 'Slack', logo: '💬' },
  { id: 'zoom', name: 'Zoom', logo: '📹' },
  { id: 'dropbox', name: 'Dropbox', logo: '📦' },
  { id: 'atlassian', name: 'Atlassian', logo: '🔵' },
  { id: 'aws', name: 'AWS', logo: '☁️' },
];

type Intent = 'analyze' | 'buy' | null;

export default function OnboardingPage() {
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [intent, setIntent] = useState<Intent>(null);
  const [step, setStep] = useState<'vendors' | 'intent' | 'complete'>('vendors');

  function toggleVendor(id: string) {
    setSelectedVendors((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-8 py-12">
        <Link href="/" className="text-2xl font-bold tracking-tight mb-12 block">
          Tally
        </Link>

        {step === 'vendors' && (
          <div>
            <h1 className="text-3xl font-bold mb-2">What do you use?</h1>
            <p className="text-slate-400 mb-8">Select the vendors and services your organization uses.</p>

            <div className="grid grid-cols-3 gap-4 mb-8" role="group" aria-label="Vendor selection">
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  onClick={() => toggleVendor(vendor.id)}
                  className={`p-4 rounded-xl border text-left transition ${
                    selectedVendors.includes(vendor.id)
                      ? 'border-blue-500 bg-blue-600/10'
                      : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                  }`}
                  aria-pressed={selectedVendors.includes(vendor.id)}
                >
                  <div className="text-2xl mb-2">{vendor.logo}</div>
                  <div className="text-sm font-medium">{vendor.name}</div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep('intent')}
              disabled={selectedVendors.length === 0}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-lg font-medium transition"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'intent' && (
          <div>
            <h1 className="text-3xl font-bold mb-2">What do you want to do?</h1>
            <p className="text-slate-400 mb-8">Choose your primary goal with Tally.</p>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <button
                onClick={() => { setIntent('analyze'); setStep('complete'); }}
                className={`p-6 rounded-xl border text-left transition ${
                  intent === 'analyze' ? 'border-blue-500 bg-blue-600/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                }`}
              >
                <div className="text-3xl mb-3">📊</div>
                <h3 className="text-lg font-semibold mb-2">Analyze my current spend</h3>
                <p className="text-slate-400 text-sm">
                  Upload invoices or CSV exports. Tally will identify savings opportunities and waste.
                </p>
              </button>
              <button
                onClick={() => { setIntent('buy'); setStep('complete'); }}
                className={`p-6 rounded-xl border text-left transition ${
                  intent === 'buy' ? 'border-blue-500 bg-blue-600/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                }`}
              >
                <div className="text-3xl mb-3">🛒</div>
                <h3 className="text-lg font-semibold mb-2">I want to buy licenses</h3>
                <p className="text-slate-400 text-sm">
                  Compare pricing across distributors and purchase with one click through Tally.
                </p>
              </button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center py-16">
            <div className="text-5xl mb-6">🎉</div>
            <h1 className="text-3xl font-bold mb-4">You&apos;re all set!</h1>
            <p className="text-slate-400 mb-8 max-w-md mx-auto">
              {intent === 'analyze'
                ? 'Head to your dashboard to upload invoices and start analyzing your spend.'
                : 'Head to the marketplace to compare pricing and make your first purchase.'}
            </p>
            <Link
              href={intent === 'analyze' ? '/' : '/marketplace'}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-lg font-medium transition"
            >
              Go to {intent === 'analyze' ? 'Dashboard' : 'Marketplace'}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

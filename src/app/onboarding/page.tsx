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

const steps = ['Select Vendors', 'Choose Goal', 'Get Started'];

function StepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-12">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-all duration-300 ${
                i < currentIndex
                  ? 'bg-blue-500 text-white'
                  : i === currentIndex
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}
            >
              {i < currentIndex ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`hidden sm:block text-sm font-medium transition-colors ${
              i <= currentIndex ? 'text-white' : 'text-slate-500'
            }`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 sm:w-12 h-0.5 mx-1 rounded-full transition-colors duration-300 ${
              i < currentIndex ? 'bg-blue-500' : 'bg-slate-700'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [intent, setIntent] = useState<Intent>(null);
  const [step, setStep] = useState<'vendors' | 'intent' | 'complete'>('vendors');

  const stepIndex = step === 'vendors' ? 0 : step === 'intent' ? 1 : 2;

  function toggleVendor(id: string) {
    setSelectedVendors((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] bg-violet-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-8 py-10">
        <Link href="/" className="flex items-center gap-2.5 mb-10">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
            <span className="text-sm font-bold text-white">T</span>
          </div>
          <span className="text-lg font-bold tracking-tight">Tally</span>
        </Link>

        <StepIndicator currentIndex={stepIndex} />

        {step === 'vendors' && (
          <div className="animate-fade-in">
            <div className="text-center mb-10">
              <h1 className="text-3xl md:text-4xl font-bold mb-3">What do you use?</h1>
              <p className="text-slate-400 text-lg">Select the vendors and services your organization uses.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10" role="group" aria-label="Vendor selection">
              {vendors.map((vendor) => {
                const isSelected = selectedVendors.includes(vendor.id);
                return (
                  <button
                    key={vendor.id}
                    onClick={() => toggleVendor(vendor.id)}
                    className={`group relative p-5 rounded-2xl border text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                        : 'border-slate-800 hover:border-slate-600 bg-slate-900/50 hover:bg-slate-800/50'
                    }`}
                    aria-pressed={isSelected}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3">
                        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-white">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>
                    )}
                    <div className="text-3xl mb-3">{vendor.logo}</div>
                    <div className="text-sm font-semibold text-white">{vendor.name}</div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => setStep('intent')}
                disabled={selectedVendors.length === 0}
                className="group px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-full text-lg font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
              >
                Continue
                <span className="inline-block ml-2 transition-transform duration-200 group-hover:translate-x-0.5 group-disabled:translate-x-0" aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}

        {step === 'intent' && (
          <div className="animate-fade-in">
            <div className="text-center mb-10">
              <h1 className="text-3xl md:text-4xl font-bold mb-3">What do you want to do?</h1>
              <p className="text-slate-400 text-lg">Choose your primary goal with Tally.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-10 max-w-2xl mx-auto">
              <button
                onClick={() => { setIntent('analyze'); setStep('complete'); }}
                className="group p-7 rounded-2xl border border-slate-800 hover:border-blue-500/30 hover:bg-blue-500/5 text-left transition-all duration-200"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-400 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-white group-hover:text-blue-300 transition-colors">Analyze my current spend</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Upload invoices or CSV exports. Tally will identify savings opportunities and waste.
                </p>
              </button>
              <button
                onClick={() => { setIntent('buy'); setStep('complete'); }}
                className="group p-7 rounded-2xl border border-slate-800 hover:border-emerald-500/30 hover:bg-emerald-500/5 text-left transition-all duration-200"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-white group-hover:text-emerald-300 transition-colors">I want to buy licenses</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Compare pricing across distributors and purchase with one click through Tally.
                </p>
              </button>
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => setStep('vendors')}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                ← Back to vendor selection
              </button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center py-12 animate-fade-in">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-400 mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">You&apos;re all set!</h1>
            <p className="text-slate-400 text-lg mb-10 max-w-md mx-auto">
              {intent === 'analyze'
                ? 'Head to your dashboard to upload invoices and start analyzing your spend.'
                : 'Head to the marketplace to compare pricing and make your first purchase.'}
            </p>
            <Link
              href={intent === 'analyze' ? '/' : '/marketplace'}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-full text-lg font-semibold transition-all duration-200 shadow-lg shadow-blue-500/25"
            >
              Go to {intent === 'analyze' ? 'Dashboard' : 'Marketplace'}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

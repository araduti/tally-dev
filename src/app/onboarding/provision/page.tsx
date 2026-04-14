'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepId = 'sign-in' | 'configure' | 'connect' | 'complete';
type ProvisioningTaskStatus = 'pending' | 'in-progress' | 'done' | 'error';

interface ProvisioningTask {
  id: string;
  label: string;
  status: ProvisioningTaskStatus;
}

interface OnboardingStep {
  id: StepId;
  title: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'sign-in',
    title: 'Sign In',
    description:
      'Your account is only used for sign in. No permissions to your tenant are required.',
  },
  {
    id: 'configure',
    title: 'Configure',
    description:
      'Set up your organization type, billing preferences, and team roles.',
  },
  {
    id: 'connect',
    title: 'Connect',
    description:
      'Link your distributor accounts (Pax8, Ingram, TDSynnex) to sync subscriptions and licenses.',
  },
  {
    id: 'complete',
    title: 'Complete',
    description:
      'Sit back and relax while we make everything ready for you to start exploring.',
  },
];

const INITIAL_TASKS: ProvisioningTask[] = [
  { id: 'org', label: 'Creating organization workspace', status: 'pending' },
  { id: 'rbac', label: 'Configuring RBAC roles & permissions', status: 'pending' },
  { id: 'vendor', label: 'Establishing vendor connections', status: 'pending' },
  { id: 'catalog', label: 'Syncing product catalog & bundles', status: 'pending' },
  { id: 'dpa', label: 'Verifying DPA compliance gate', status: 'pending' },
  { id: 'dashboard', label: 'Preparing your dashboard', status: 'pending' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TallyLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
        <span className="text-sm font-bold text-white">T</span>
      </div>
      <span className="text-lg font-bold tracking-tight text-white">
        Tally
      </span>
    </div>
  );
}

/** Vertical timeline stepper — left panel. */
function StepTimeline({
  activeStepIndex,
}: {
  activeStepIndex: number;
}) {
  return (
    <div className="relative flex flex-col gap-0">
      {ONBOARDING_STEPS.map((step, idx) => {
        const isCompleted = idx < activeStepIndex;
        const isActive = idx === activeStepIndex;
        const isLast = idx === ONBOARDING_STEPS.length - 1;

        return (
          <div key={step.id} className="relative flex gap-5">
            {/* Connector line + dot */}
            <div className="flex flex-col items-center">
              {/* Dot */}
              <div
                className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all duration-500 ${
                  isCompleted
                    ? 'bg-blue-500 border-blue-500'
                    : isActive
                      ? 'bg-blue-600 border-blue-400 shadow-lg shadow-blue-500/40'
                      : 'bg-slate-800 border-slate-600'
                }`}
              >
                {isCompleted ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5 text-white"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : isActive ? (
                  <div className="w-2 h-2 rounded-full bg-white" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-600" />
                )}
              </div>
              {/* Vertical connector */}
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 min-h-[48px] transition-colors duration-500 ${
                    isCompleted ? 'bg-blue-500' : 'bg-slate-700'
                  }`}
                />
              )}
            </div>

            {/* Step content */}
            <div className={`pb-8 ${isLast ? 'pb-0' : ''}`}>
              <h3
                className={`text-base font-semibold transition-colors duration-300 ${
                  isActive
                    ? 'text-white'
                    : isCompleted
                      ? 'text-slate-400'
                      : 'text-slate-500'
                }`}
              >
                {step.title}
              </h3>
              <p
                className={`mt-1 text-sm leading-relaxed max-w-xs transition-colors duration-300 ${
                  isActive ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {step.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Provisioning task list — right panel. */
function ProvisioningStatus({
  tasks,
  completedCount,
  totalCount,
}: {
  tasks: ProvisioningTask[];
  completedCount: number;
  totalCount: number;
}) {
  const allDone = completedCount === totalCount;

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        {allDone ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-8 w-8 text-emerald-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">
              Your workspace is ready!
            </h2>
            <p className="text-slate-400 text-sm">
              Everything has been configured. Jump into your dashboard.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-white mb-1">
              Thanks! We are processing your request.
            </h2>
            <p className="text-slate-400 text-sm">
              Your Tally workspace is being provisioned.
            </p>
          </>
        )}
      </div>

      {/* Task list */}
      <div className="w-full max-w-sm space-y-3 mb-8">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`flex items-center gap-3 text-sm transition-opacity duration-300 ${
              task.status === 'pending' ? 'opacity-40' : 'opacity-100'
            }`}
          >
            {/* Status icon */}
            <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
              {task.status === 'done' && (
                <svg
                  className="h-4 w-4 text-emerald-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {task.status === 'in-progress' && (
                <svg
                  className="animate-spin h-4 w-4 text-blue-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {task.status === 'pending' && (
                <div className="w-2 h-2 rounded-full bg-slate-600" />
              )}
              {task.status === 'error' && (
                <svg
                  className="h-4 w-4 text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 0-1.06 1.06L9.94 10l-2.06 2.06a.75.75 0 1 0 1.06 1.06L11 11.06l2.06 2.06a.75.75 0 1 0 1.06-1.06L12.06 10l2.06-2.06a.75.75 0 1 0-1.06-1.06L11 8.94 8.94 6.94Z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            {/* Label */}
            <span
              className={`text-left ${
                task.status === 'in-progress'
                  ? 'text-blue-300'
                  : task.status === 'done'
                    ? 'text-slate-300'
                    : task.status === 'error'
                      ? 'text-red-400'
                      : 'text-slate-500'
              }`}
            >
              {task.label}
              {task.status === 'in-progress' && '…'}
            </span>
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span>Setting up workspace</span>
          <span>
            {completedCount}/{totalCount}
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${(completedCount / totalCount) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* CTA when done */}
      {allDone && (
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-full text-sm font-semibold text-white transition-all duration-200 shadow-lg shadow-blue-500/25"
        >
          Go to Dashboard
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

/** Loading dots animation. */
function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5" role="status" aria-label="Loading">
      <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function OnboardingProvisionPage() {
  const [activeStepIndex, setActiveStepIndex] = useState(3); // Final step — "Complete"
  const [tasks, setTasks] = useState<ProvisioningTask[]>(INITIAL_TASKS);

  // Simulate provisioning progress for the mockup
  const advanceTask = useCallback(() => {
    setTasks((prev) => {
      const firstPending = prev.findIndex((t) => t.status === 'pending');
      const inProgress = prev.findIndex((t) => t.status === 'in-progress');

      // If something is in-progress, complete it and start the next
      if (inProgress !== -1) {
        return prev.map((t, i) => {
          if (i === inProgress) return { ...t, status: 'done' as const };
          if (i === inProgress + 1 && t.status === 'pending')
            return { ...t, status: 'in-progress' as const };
          return t;
        });
      }

      // If nothing is in-progress, start the first pending
      if (firstPending !== -1) {
        return prev.map((t, i) =>
          i === firstPending
            ? { ...t, status: 'in-progress' as const }
            : t,
        );
      }

      return prev;
    });
  }, []);

  useEffect(() => {
    // Start the first task immediately
    const startTimer = setTimeout(() => advanceTask(), 800);

    // Then advance every ~1.8s for the demo
    const interval = setInterval(() => {
      advanceTask();
    }, 1800);

    return () => {
      clearTimeout(startTimer);
      clearInterval(interval);
    };
  }, [advanceTask]);

  // Advance stepper as tasks complete
  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const totalCount = tasks.length;

  useEffect(() => {
    if (completedCount >= 2 && activeStepIndex < 3) {
      setActiveStepIndex(3);
    }
  }, [completedCount, activeStepIndex]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Background effects */}
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[120px]" />
      </div>

      {/* Top navigation bar */}
      <nav className="flex items-center justify-between px-6 md:px-10 py-4 border-b border-slate-800/50">
        <Link href="/">
          <TallyLogo />
        </Link>

        <div className="hidden sm:flex items-center gap-1 text-sm text-slate-400">
          <span>💬</span>
          <span>
            Have questions?{' '}
            <a
              href="#"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Check our docs
            </a>{' '}
            or{' '}
            <a
              href="#"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              contact us
            </a>
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-300">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-xs font-bold">
            A
          </div>
          <span className="hidden sm:inline">Admin User</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 text-slate-500"
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </nav>

      {/* Main content — split panel card */}
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10 md:py-16 animate-fade-in">
        <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-slate-800 overflow-hidden">
          <div className="grid md:grid-cols-2 min-h-[520px]">
            {/* Left panel — Stepper */}
            <div className="p-8 md:p-10 border-b md:border-b-0 md:border-r border-slate-800">
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                Set up your Tally workspace
              </h1>
              <p className="text-slate-400 text-sm mb-10">
                We&apos;ll have you up and running in just a few moments.
              </p>

              <StepTimeline activeStepIndex={activeStepIndex} />
            </div>

            {/* Right panel — Provisioning status */}
            <div className="bg-slate-900/40">
              <ProvisioningStatus
                tasks={tasks}
                completedCount={completedCount}
                totalCount={totalCount}
              />
            </div>
          </div>
        </div>

        {/* Loading dots beneath card while provisioning */}
        {completedCount < totalCount && (
          <div className="flex justify-center mt-6">
            <LoadingDots />
          </div>
        )}
      </div>

      {/* Trusted-by / partner logos */}
      <div className="max-w-4xl mx-auto px-6 pb-12">
        <p className="text-center text-xs text-slate-600 uppercase tracking-wider mb-6">
          Trusted by teams managing multi-vendor stacks
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 opacity-30">
          {/* Placeholder partner logos — text-based for the mockup */}
          {['Pax8', 'Ingram Micro', 'TDSynnex', 'Microsoft', 'Adobe'].map(
            (name) => (
              <div
                key={name}
                className="text-sm md:text-base font-bold text-slate-400 tracking-wide"
              >
                {name}
              </div>
            ),
          )}
        </div>
      </div>
    </main>
  );
}

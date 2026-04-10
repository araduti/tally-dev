import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <nav className="flex items-center justify-between px-8 py-4 max-w-7xl mx-auto">
        <div className="text-2xl font-bold tracking-tight">Tally</div>
        <div className="flex gap-4">
          <Link href="/login" className="px-4 py-2 text-sm text-slate-300 hover:text-white transition">
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition font-medium"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-8 pt-24 pb-16 text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight">
          AI-powered optimization for your{' '}
          <span className="text-blue-400">entire stack</span>
        </h1>
        <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto">
          Analyze usage, cut waste, stay compliant, and buy what you need — all in one place.
          Real-time pricing from every distributor, one-click actions, strict commitment enforcement.
        </p>
        <div className="mt-10 flex gap-4 justify-center">
          <Link
            href="/register"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-lg font-medium transition"
          >
            Start Free
          </Link>
          <Link
            href="/onboarding"
            className="px-6 py-3 border border-slate-600 hover:border-slate-400 rounded-lg text-lg transition"
          >
            See How It Works
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-8 py-16 grid md:grid-cols-3 gap-8">
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <div className="text-blue-400 text-2xl mb-3">📊</div>
          <h3 className="text-lg font-semibold mb-2">Multi-Distributor Intelligence</h3>
          <p className="text-slate-400 text-sm">
            Real-time pricing from Pax8, Ingram Micro, TD Synnex, and direct vendors. AI shows the best option.
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <div className="text-green-400 text-2xl mb-3">🔒</div>
          <h3 className="text-lg font-semibold mb-2">Strict Commitment Model</h3>
          <p className="text-slate-400 text-sm">
            NCE-style no-refund windows enforced natively. Scale-downs become scheduled decreases.
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <div className="text-purple-400 text-2xl mb-3">⚡</div>
          <h3 className="text-lg font-semibold mb-2">One-Click Actions</h3>
          <p className="text-slate-400 text-sm">
            Scale licenses, purchase through any distributor, and track margin — all with a single click.
          </p>
        </div>
      </section>

      <footer className="text-center py-8 text-sm text-slate-500">
        Tally — Every vendor counted. Every gap closed. Every action a click away.
      </footer>
    </main>
  );
}

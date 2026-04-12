import Link from 'next/link';

/* ---------- Feature data ------------------------------------------------ */

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    title: 'Multi-Distributor Intelligence',
    description: 'Real-time pricing from Pax8, Ingram Micro, TD Synnex, and direct vendors. AI surfaces the best option instantly.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
    title: 'Strict Commitment Model',
    description: 'NCE-style no-refund windows enforced natively. Scale-downs become scheduled decreases with clear dates.',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
    title: 'One-Click Actions',
    description: 'Scale licenses, purchase through any distributor, and track margin — all with a single click.',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
  },
] as const;

const stats = [
  { value: '3+', label: 'Distributors' },
  { value: '99.9%', label: 'Uptime' },
  { value: '<1s', label: 'Price Refresh' },
  { value: 'Zero', label: 'Lock-in' },
] as const;

/* ---------- Component --------------------------------------------------- */

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white overflow-hidden">
      {/* Background gradient mesh */}
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-violet-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 w-[400px] h-[400px] bg-emerald-600/10 rounded-full blur-[120px]" />
      </div>

      {/* ---- Navigation ---- */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-8 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
            <span className="text-sm font-bold text-white">T</span>
          </div>
          <span className="text-xl font-bold tracking-tight">Tally</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors duration-200"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-5 py-2.5 text-sm bg-white text-slate-900 hover:bg-slate-100 rounded-full transition-all duration-200 font-semibold shadow-lg shadow-white/10 hover:shadow-white/20"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* ---- Hero Section ---- */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-8 pt-20 md:pt-32 pb-16 text-center animate-fade-in">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
          </span>
          AI-Powered License Optimization
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]">
          Optimize your entire
          <br />
          <span className="text-gradient">multi-vendor stack</span>
        </h1>

        <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Analyze usage, cut waste, stay compliant, and buy what you need — all in one place.
          Real-time pricing from every distributor, one-click actions.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="group px-8 py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-full text-lg font-semibold transition-all duration-300 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
          >
            Start Free
            <span className="inline-block ml-2 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">→</span>
          </Link>
          <Link
            href="/onboarding"
            className="px-8 py-3.5 border border-slate-700 hover:border-slate-500 hover:bg-slate-800/50 rounded-full text-lg transition-all duration-200"
          >
            See How It Works
          </Link>
        </div>
      </section>

      {/* ---- Stats Bar ---- */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 md:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl md:text-4xl font-bold text-white">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Features Grid ---- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 md:px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Everything you need to
            <br className="hidden sm:block" />
            <span className="text-gradient"> manage licenses</span>
          </h2>
          <p className="mt-4 text-slate-400 text-lg max-w-2xl mx-auto">
            Built for MSPs, enterprises, and procurement teams who need real control over their vendor stack.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 stagger-children">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`group relative rounded-2xl p-7 border ${feature.borderColor} ${feature.bgColor} backdrop-blur-sm hover:border-opacity-50 transition-all duration-300 hover:-translate-y-1`}
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${feature.bgColor} ${feature.color} mb-5`}>
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- How It Works ---- */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Up and running in <span className="text-gradient">minutes</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 stagger-children">
          {[
            { step: '01', title: 'Onboard', description: 'Tell Tally what you use and what you want to achieve.' },
            { step: '02', title: 'Connect', description: 'API sync for full automation or manual CSV for instant insights.' },
            { step: '03', title: 'Analyze', description: 'Live pricing from all distributors combined with your usage data.' },
            { step: '04', title: 'Act', description: 'One-click purchase, scheduled decrease, or export projected invoice.' },
          ].map((item) => (
            <div key={item.step} className="relative">
              <span className="text-5xl font-black text-slate-800">{item.step}</span>
              <h3 className="mt-3 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- CTA Section ---- */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 md:px-8 py-20">
        <div className="relative rounded-3xl bg-gradient-to-br from-blue-600/20 via-violet-600/10 to-emerald-600/10 border border-white/5 p-10 md:p-16 text-center overflow-hidden">
          <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Ready to optimize your stack?
            </h2>
            <p className="text-slate-400 text-lg mb-8 max-w-xl mx-auto">
              Join organizations saving thousands every month with AI-powered license management.
            </p>
            <Link
              href="/register"
              className="inline-flex px-8 py-3.5 bg-white text-slate-900 hover:bg-slate-100 rounded-full text-lg font-semibold transition-all duration-200 shadow-lg hover:-translate-y-0.5"
            >
              Get Started for Free
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="relative z-10 border-t border-slate-800 mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                <span className="text-[10px] font-bold text-white">T</span>
              </div>
              <span className="text-sm font-medium text-slate-400">Tally</span>
            </div>
            <p className="text-sm text-slate-600">
              Every vendor counted. Every gap closed. Every action a click away.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

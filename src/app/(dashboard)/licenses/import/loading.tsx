export default function ImportLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-40 bg-slate-700 rounded animate-pulse mb-2" />
        <div className="h-4 w-80 bg-slate-700/50 rounded animate-pulse" />
      </div>
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="h-5 w-36 bg-slate-700 rounded animate-pulse mb-4" />
        <div className="h-4 w-64 bg-slate-700/50 rounded animate-pulse mb-4" />
        <div className="h-10 w-full bg-slate-700 rounded-lg animate-pulse mb-4" />
        <div className="h-32 w-full bg-slate-700 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

export default function ImportLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-40 skeleton-shimmer rounded-lg mb-2" />
        <div className="h-4 w-80 skeleton-shimmer rounded-lg" />
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
        <div className="h-5 w-36 skeleton-shimmer rounded-lg mb-4" />
        <div className="h-4 w-64 skeleton-shimmer rounded-lg mb-4" />
        <div className="h-10 w-full skeleton-shimmer rounded-lg mb-4" />
        <div className="h-32 w-full skeleton-shimmer rounded-lg" />
      </div>
    </div>
  );
}

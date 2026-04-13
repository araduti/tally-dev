export default function CreateLicenseLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-48 skeleton-shimmer rounded-lg" />
        <div className="mt-2 h-4 w-96 skeleton-shimmer rounded-lg" />
      </div>

      <div className="space-y-6 max-w-2xl">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
          <div className="h-6 w-40 skeleton-shimmer rounded-lg mb-4" />
          <div className="h-10 skeleton-shimmer rounded-lg mb-4" />
          <div className="h-10 skeleton-shimmer rounded-lg" />
        </div>
      </div>
    </div>
  );
}

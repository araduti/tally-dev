export default function CreateLicenseLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-48 bg-slate-700 rounded animate-pulse" />
        <div className="mt-2 h-4 w-96 bg-slate-700/50 rounded animate-pulse" />
      </div>

      <div className="space-y-6 max-w-2xl">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="h-6 w-40 bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-10 bg-slate-700 rounded-lg animate-pulse mb-4" />
          <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  );
}

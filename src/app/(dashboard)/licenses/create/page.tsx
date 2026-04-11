import { CreateLicenseClient } from './create-license-client';

export default function CreateLicensePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Create License</h1>
        <p className="mt-1 text-slate-400">
          Create a single license by selecting a bundle, choosing a product offering, and setting the
          desired quantity. A new subscription will be provisioned through the vendor.
        </p>
      </div>

      <CreateLicenseClient />
    </div>
  );
}

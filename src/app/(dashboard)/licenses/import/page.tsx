import { CsvUploadClient } from './csv-upload-client';

export default function CsvUploadPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Import Licenses</h1>
        <p className="mt-1 text-slate-400">
          Bulk import licenses from a CSV file. Each row creates a license with the specified quantity.
        </p>
      </div>

      <CsvUploadClient />
    </div>
  );
}

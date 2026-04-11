'use client';

import { useState, useCallback, useRef } from 'react';
import { api } from '@/trpc/client';

// ---------- Types ----------

interface ParsedRow {
  productOfferingId: string;
  quantity: number;
  raw: string;
}

interface ParseError {
  line: number;
  raw: string;
  error: string;
}

interface ImportResult {
  index: number;
  status: 'SUCCESS' | 'SKIPPED' | 'ERROR';
  licenseId: string | null;
  error: string | null;
}

// ---------- CSV Parser ----------

function parseCSV(text: string): { rows: ParsedRow[]; errors: ParseError[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  // Skip header if present
  const startIndex = lines.length > 0 && lines[0].toLowerCase().includes('productofferingid') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map((p) => p.trim());

    if (parts.length < 2) {
      errors.push({ line: i + 1, raw: line, error: 'Expected at least 2 columns (productOfferingId, quantity)' });
      continue;
    }

    const productOfferingId = parts[0];
    const quantity = parseInt(parts[1], 10);

    if (!productOfferingId || productOfferingId.length < 10) {
      errors.push({ line: i + 1, raw: line, error: 'Invalid productOfferingId' });
      continue;
    }

    if (isNaN(quantity) || quantity <= 0) {
      errors.push({ line: i + 1, raw: line, error: 'Quantity must be a positive integer' });
      continue;
    }

    rows.push({ productOfferingId, quantity, raw: line });
  }

  return { rows, errors };
}

// ---------- Main Component ----------

export function CsvUploadClient() {
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [isParsed, setIsParsed] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = api.license.importLicenses.useMutation({
    onSuccess: (data) => {
      setImportResults(data.results);
      setImportSummary({ imported: data.imported, skipped: data.skipped });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      setIsParsed(false);
      setImportResults(null);
      setImportSummary(null);
    };
    reader.readAsText(file);
  }, []);

  const handleParse = useCallback(() => {
    const { rows, errors } = parseCSV(csvText);
    setParsedRows(rows);
    setParseErrors(errors);
    setIsParsed(true);
    setImportResults(null);
    setImportSummary(null);
  }, [csvText]);

  const handleImport = useCallback(() => {
    if (parsedRows.length === 0) return;

    importMutation.mutate({
      records: parsedRows.map((r) => ({
        productOfferingId: r.productOfferingId,
        quantity: r.quantity,
      })),
      idempotencyKey: crypto.randomUUID(),
    });
  }, [parsedRows, importMutation]);

  const handleReset = useCallback(() => {
    setCsvText('');
    setParsedRows([]);
    setParseErrors([]);
    setIsParsed(false);
    setImportResults(null);
    setImportSummary(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 className="text-lg font-semibold text-white mb-4">Upload CSV File</h2>
        <p className="text-sm text-slate-400 mb-4">
          Upload a CSV file with columns: <code className="text-blue-400">productOfferingId</code>, <code className="text-blue-400">quantity</code>
        </p>

        <div className="flex items-center gap-4 mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="block text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500 file:cursor-pointer"
            aria-label="Upload CSV file"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="csv-text" className="block text-sm font-medium text-slate-300 mb-1">
            Or paste CSV content directly:
          </label>
          <textarea
            id="csv-text"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setIsParsed(false);
              setImportResults(null);
              setImportSummary(null);
            }}
            rows={6}
            placeholder={`productOfferingId,quantity\nclh1234567890abcdefghij00,10\nclh1234567890abcdefghij01,5`}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={!csvText.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
          >
            Parse & Preview
          </button>
          {isParsed && (
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm font-medium transition"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Parse Errors */}
      {isParsed && parseErrors.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-red-700/50">
          <h3 className="text-sm font-semibold text-red-400 mb-3">
            {parseErrors.length} row{parseErrors.length !== 1 ? 's' : ''} could not be parsed
          </h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {parseErrors.map((err, i) => (
              <div key={i} className="text-xs text-slate-400">
                <span className="text-red-400">Line {err.line}:</span> {err.error}
                <span className="text-slate-600 ml-2">({err.raw})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview Table */}
      {isParsed && parsedRows.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Preview: {parsedRows.length} record{parsedRows.length !== 1 ? 's' : ''} ready to import
              </h3>
              {parseErrors.length > 0 && (
                <p className="text-xs text-yellow-400 mt-0.5">
                  {parseErrors.length} row{parseErrors.length !== 1 ? 's' : ''} will be skipped
                </p>
              )}
            </div>
            {!importSummary && (
              <button
                type="button"
                onClick={handleImport}
                disabled={importMutation.isPending}
                className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
              >
                {importMutation.isPending ? 'Importing…' : `Import ${parsedRows.length} Record${parsedRows.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" aria-label="CSV preview">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">#</th>
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Product Offering ID</th>
                  <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Quantity</th>
                  {importResults && (
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {parsedRows.map((row, idx) => {
                  const result = importResults?.find((r) => r.index === idx);
                  return (
                    <tr key={idx} className="hover:bg-slate-700/30 transition">
                      <td className="px-6 py-3 text-sm text-slate-500">{idx + 1}</td>
                      <td className="px-6 py-3 text-sm text-slate-300 font-mono">{row.productOfferingId}</td>
                      <td className="px-6 py-3 text-sm text-white">{row.quantity}</td>
                      {importResults && (
                        <td className="px-6 py-3 text-sm">
                          {result?.status === 'SUCCESS' && (
                            <span className="text-green-400">✓ Imported</span>
                          )}
                          {result?.status === 'SKIPPED' && (
                            <span className="text-yellow-400" title={result.error ?? undefined}>⚠ Skipped: {result.error}</span>
                          )}
                          {result?.status === 'ERROR' && (
                            <span className="text-red-400" title={result.error ?? undefined}>✗ Error: {result.error}</span>
                          )}
                          {!result && <span className="text-slate-500">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Summary */}
      {importSummary && (
        <div className="bg-slate-800 rounded-xl p-6 border border-green-700/50">
          <h3 className="text-lg font-semibold text-white mb-2">Import Complete</h3>
          <div className="flex gap-6">
            <div>
              <p className="text-sm text-slate-400">Imported</p>
              <p className="text-2xl font-bold text-green-400">{importSummary.imported}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Skipped</p>
              <p className="text-2xl font-bold text-yellow-400">{importSummary.skipped}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition"
          >
            Import Another File
          </button>
        </div>
      )}

      {/* Mutation Error */}
      {importMutation.isError && (
        <div className="bg-slate-800 rounded-xl p-6 border border-red-700/50">
          <p className="text-red-400 text-sm">{importMutation.error.message}</p>
        </div>
      )}
    </div>
  );
}

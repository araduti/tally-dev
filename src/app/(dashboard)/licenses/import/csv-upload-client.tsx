'use client';

import { useState, useCallback, useRef } from 'react';
import { api } from '@/trpc/client';

// ---------- Constants ----------

const MAX_IMPORT_RECORDS = 500;

const CSV_TEMPLATE_CONTENT = [
  'productOfferingId,quantity',
  'clh1234567890abcdefghij00,10',
  'clh1234567890abcdefghij01,5',
  'clh1234567890abcdefghij02,25',
].join('\n');

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

// CUID format: starts with 'c', at least 25 characters
const CUID_PATTERN = /^c[a-z0-9]{24,}$/;

function parseCSV(text: string): { rows: ParsedRow[]; errors: ParseError[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  // Skip header if first row columns match expected headers exactly
  let startIndex = 0;
  if (lines.length > 0) {
    const headerCols = lines[0].split(',').map((c) => c.trim().toLowerCase());
    if (headerCols[0] === 'productofferingid' && headerCols[1] === 'quantity') {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map((p) => p.trim());

    if (parts.length < 2) {
      errors.push({ line: i + 1, raw: line, error: 'Expected at least 2 columns (productOfferingId, quantity)' });
      continue;
    }

    const productOfferingId = parts[0];
    const quantity = parseInt(parts[1], 10);

    if (!productOfferingId || !CUID_PATTERN.test(productOfferingId)) {
      errors.push({ line: i + 1, raw: line, error: 'Invalid productOfferingId (expected CUID format)' });
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

// ---------- Helpers ----------

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE_CONTENT], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tally-license-import-template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function findDuplicateOfferingIds(rows: ParsedRow[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.productOfferingId)) {
      duplicates.add(row.productOfferingId);
    }
    seen.add(row.productOfferingId);
  }
  return Array.from(duplicates);
}

// ---------- Main Component ----------

export function CsvUploadClient() {
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [duplicateIds, setDuplicateIds] = useState<string[]>([]);
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
    setDuplicateIds(findDuplicateOfferingIds(rows));
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
    setDuplicateIds([]);
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Upload CSV File</h2>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm font-medium transition"
            aria-label="Download CSV template"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Download CSV Template
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Upload a CSV file with columns: <code className="text-blue-400">productOfferingId</code>, <code className="text-blue-400">quantity</code>.
          Maximum {MAX_IMPORT_RECORDS} records per import.
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

      {/* Batch-Size Warning */}
      {isParsed && parsedRows.length > MAX_IMPORT_RECORDS && (
        <div className="bg-slate-800 rounded-xl p-6 border border-yellow-700/50" role="alert">
          <h3 className="text-sm font-semibold text-yellow-400 mb-1">Too many records</h3>
          <p className="text-xs text-slate-400">
            Your file contains {parsedRows.length} valid records, but the maximum per import is {MAX_IMPORT_RECORDS}.
            Please split your file and import in batches.
          </p>
        </div>
      )}

      {/* Duplicate Warnings */}
      {isParsed && duplicateIds.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-yellow-700/50" role="alert">
          <h3 className="text-sm font-semibold text-yellow-400 mb-1">
            Duplicate product offerings detected
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            The following product offering IDs appear more than once. Each occurrence will be imported as a separate license.
          </p>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {duplicateIds.map((id) => (
              <div key={id} className="text-xs text-slate-400 font-mono">{id}</div>
            ))}
          </div>
        </div>
      )}

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
                disabled={importMutation.isPending || parsedRows.length > MAX_IMPORT_RECORDS}
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

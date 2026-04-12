'use client';

import { useState, useCallback } from 'react';
import { exportToCSV, type CsvColumn } from '@/lib/export';

export interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string;
  columns?: CsvColumn[];
  label?: string;
}

export function ExportButton({
  data,
  filename,
  columns,
  label = 'Export CSV',
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(() => {
    if (data.length === 0) return;
    setExporting(true);

    // Use requestAnimationFrame so the UI can show the loading state before
    // the synchronous CSV generation blocks the main thread.
    requestAnimationFrame(() => {
      try {
        exportToCSV(data, filename, columns);
      } finally {
        setExporting(false);
      }
    });
  }, [data, filename, columns]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting || data.length === 0}
      className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition"
      aria-label={label}
    >
      {/* Download icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
      </svg>
      <span>{exporting ? 'Exporting…' : label}</span>
    </button>
  );
}

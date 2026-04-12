/**
 * CSV Export utility for Tally data tables.
 *
 * Handles proper CSV escaping and triggers a browser download via
 * Blob + URL.createObjectURL.
 */

export interface CsvColumn {
  key: string;
  header: string;
}

/**
 * Escape a single CSV cell value.
 *
 * Rules (RFC 4180):
 *  – If the value contains a comma, double-quote, or newline it must be
 *    wrapped in double-quotes.
 *  – Any embedded double-quote is doubled ("").
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export an array of records to a CSV file and trigger a browser download.
 *
 * @param data     – Array of flat objects to export.
 * @param filename – Download file name (`.csv` appended if missing).
 * @param columns  – Optional column mapping. When omitted, all keys from the
 *                   first record are used as-is.
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  filename: string,
  columns?: CsvColumn[],
): void {
  if (data.length === 0) return;

  const cols: CsvColumn[] =
    columns ?? Object.keys(data[0]!).map((key) => ({ key, header: key }));

  const headerRow = cols.map((c) => escapeCSVValue(c.header)).join(',');

  const rows = data.map((record) =>
    cols.map((c) => escapeCSVValue(record[c.key])).join(','),
  );

  const csv = [headerRow, ...rows].join('\r\n');

  const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): { rows: CsvRow[]; errors: string[] } {
  const res = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  return {
    rows: res.data.map((r) => {
      const out: CsvRow = {};
      for (const k of Object.keys(r)) out[k] = (r[k] ?? '').toString().trim();
      return out;
    }),
    errors: res.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`),
  };
}

export function toCsv(rows: Record<string, string | number | null | undefined>[], columns?: string[]): string {
  const cols = columns ?? Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  return Papa.unparse({ fields: cols, data: rows.map((r) => cols.map((c) => r[c] ?? '')) });
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

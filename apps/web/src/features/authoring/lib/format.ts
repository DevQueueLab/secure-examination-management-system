/** "4", "2.5", "1.25" (marks never show trailing zeros). */
export function formatMarks(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return String(Math.round(n * 1000) / 1000);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Reads a File as UTF-8 text (CSV and JSON imports). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });
}

/** csv | json from a filename or MIME type; null when neither. */
export function importFormatOf(file: File): 'csv' | 'json' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') return 'csv';
  if (name.endsWith('.json') || file.type === 'application/json') return 'json';
  return null;
}

/** Plain-text excerpt of a markdown stem for dense lists (maths kept as written). */
export function stemExcerpt(stem: string, max = 140): string {
  const plain = stem
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\[\[(\w+)\]\]/g, '___')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Number and date formatting shared by grading, results and analytics. Minus signs are typographic (−). */

const minus = (s: string) => s.replace(/^-/, '−');

/** Marks: up to two decimals, trailing zeros dropped ("7.5", "10", "0.25"). */
export function fmtMarks(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return minus(String(Number(n.toFixed(digits))));
}

/** "+1.5", "−2", "0". */
export function fmtSigned(n: number): string {
  if (n > 0) return `+${fmtMarks(n)}`;
  if (n < 0) return `−${fmtMarks(-n)}`;
  return '0';
}

export function fmtPercent(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${minus(n.toFixed(digits))}%`;
}

/** Fraction 0-1 to a percentage. */
export function fmtShare(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined ? '–' : fmtPercent(x * 100, digits);
}

/** Correlation-like statistics: two decimals, typographic minus. */
export function fmtStat(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return minus(n.toFixed(digits));
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dateTimeYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : dateFmt.format(d);
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.getFullYear() === new Date().getFullYear() ? dateTimeFmt.format(d) : dateTimeYearFmt.format(d);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 minutes ago", "yesterday". Falls back to the date after a week. */
export function fmtRelative(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '–';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return fmtDate(iso);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1st", "2nd", "23rd". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

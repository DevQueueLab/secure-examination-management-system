/** Display helpers for the candidate screens. Times show in the device's own time zone; durations are exact. */

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "2 days 3 h", "3 h 12 min", "12 min", "45 s". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return hours ? `${days} ${days === 1 ? 'day' : 'days'} ${hours} h` : `${days} ${days === 1 ? 'day' : 'days'}`;
  if (hours > 0) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return `${minutes} min`;
  return `${s} s`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function formatClock(iso: string | number | Date): string {
  return timeFmt.format(new Date(iso));
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "today at 6:30 PM", "tomorrow at 9:00 AM", "Sat 29 Nov at 11:28 AM". */
export function formatWhen(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  const days = Math.round((startOfDay(t) - startOfDay(nowMs)) / 86_400_000);
  if (days === 0) return `today at ${timeFmt.format(t)}`;
  if (days === 1) return `tomorrow at ${timeFmt.format(t)}`;
  if (days === -1) return `yesterday at ${timeFmt.format(t)}`;
  return `${dayFmt.format(t)} at ${timeFmt.format(t)}`;
}

export function formatDateTime(iso: string): string {
  return fullFmt.format(new Date(iso));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Signed offset in words: "2 min 10 s fast", "45 s slow", "in step". */
export function formatOffset(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return 'in step with Athena';
  const s = Math.round(abs / 1000);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  const amount = minutes ? (seconds ? `${minutes} min ${seconds} s` : `${minutes} min`) : `${seconds} s`;
  return `${amount} ${ms > 0 ? 'fast' : 'slow'}`;
}

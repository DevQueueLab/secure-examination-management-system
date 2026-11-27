/**
 * Datetimes are edited with <input type="datetime-local"> in the viewer's own timezone and sent as ISO UTC.
 * The API never sees local strings; the UI always names the timezone it shows.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO (UTC) -> "YYYY-MM-DDTHH:mm" in local time, for a datetime-local value. */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) -> ISO UTC, or null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Asia/Karachi (GMT+5)": the zone every local datetime on the page is shown in. */
export function timeZoneLabel(date = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Intl.DateTimeFormat('en-US', { timeZoneName: 'shortOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value;
  return offset ? `${zone.replace(/_/g, ' ')} (${offset})` : zone.replace(/_/g, ' ');
}

/** Next whole hour plus `days`, as a local datetime-local value (sensible wizard defaults). */
export function nextHourLocal(days = 0, extraHours = 0): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1 + extraHours);
  d.setDate(d.getDate() + days);
  return toLocalInput(d);
}

export function minutesBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayTimeYear = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Sun, 29 Nov, 14:00" (year added when it differs from now). */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dayTime : dayTimeYear).format(d);
}

/** "Sun, 29 Nov, 14:00 – 17:00" or across days "Sun, 29 Nov, 14:00 – Mon, 30 Nov, 09:00". */
export function formatWindow(opensIso: string, closesIso: string): string {
  const a = new Date(opensIso);
  const b = new Date(closesIso);
  const sameDay = a.toDateString() === b.toDateString();
  return `${formatWhen(opensIso)} – ${sameDay ? timeOnly.format(b) : formatWhen(closesIso)}`;
}

/** "90 min", "2 h", "2 h 30 min", "3 days". */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  if (total < 60 * 24 * 2) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(total / (60 * 24))} days`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "in 2 days", "in 3 hours", "5 minutes ago". */
export function relativeTo(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return diff >= 0 ? 'in under a minute' : 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

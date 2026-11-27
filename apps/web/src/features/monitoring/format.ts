import type { EventSeverity, IncidentReviewStatus, SubmitReason } from '@athena/shared';
import type { Tone } from '@/components/ui/badge';
import type { MonitorEvent, ReviewPriority } from './types';

/** Shown wherever integrity indicators appear (mirrors the API's notice). */
export const INDICATOR_NOTICE =
  'Indicators show what the browser reported. They are not evidence of misconduct and never change a score automatically.';

/** A heartbeat older than this means the candidate's browser has gone quiet. */
export const SILENT_AFTER_MS = 35_000;

/** Plain-language names for timeline events: what happened, not what it might mean. */
const EVENT_LABEL: Record<string, string> = {
  started: 'Started the exam',
  resumed: 'Resumed the attempt',
  device_switched: 'Continued on another device',
  submitted: 'Submitted',
  auto_submitted: 'Submitted automatically at the deadline',
  force_submitted: 'Submitted by staff',
  time_extended: 'Time extended',
  outage_compensated: 'Time given back after an outage',
  went_offline: 'Lost connection',
  came_online: 'Reconnected',
  offline_journal_received: 'Uploaded answers saved offline',
  focus_lost: 'Left the exam window',
  focus_returned: 'Came back to the exam window',
  fullscreen_exited: 'Left full screen',
  fullscreen_entered: 'Returned to full screen',
  copy_attempt: 'Tried to copy',
  paste: 'Pasted text',
  context_menu: 'Opened the right-click menu',
  multiple_displays: 'A second display was detected',
  print_attempt: 'Tried to print',
  announcement_read: 'Read an announcement',
  clarification_asked: 'Asked a clarification',
};

/** Short names for indicator types in counts ("3 window switches"). */
const INDICATOR_NOUN: Record<string, [string, string]> = {
  focus_lost: ['window switch', 'window switches'],
  fullscreen_exited: ['full-screen exit', 'full-screen exits'],
  copy_attempt: ['copy attempt', 'copy attempts'],
  paste: ['paste', 'pastes'],
  context_menu: ['right-click', 'right-clicks'],
  multiple_displays: ['second display', 'second displays'],
  print_attempt: ['print attempt', 'print attempts'],
  device_switched: ['device switch', 'device switches'],
  went_offline: ['disconnection', 'disconnections'],
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function indicatorNoun(type: string, n: number): string {
  const nouns = INDICATOR_NOUN[type];
  if (nouns) return `${n} ${n === 1 ? nouns[0] : nouns[1]}`;
  return `${n} × ${eventLabel(type).toLowerCase()}`;
}

/** The useful detail of an event's payload, in words ("for 42 s", "120 characters"). */
export function eventDetail(e: Pick<MonitorEvent, 'type' | 'payload'>): string | null {
  const p = e.payload;
  const parts: string[] = [];
  const ms = num(p.durationMs) ?? num(p.awayMs) ?? num(p.offlineMs) ?? (num(p.seconds) !== null ? num(p.seconds)! * 1000 : null);
  if (ms !== null && ms > 0) parts.push(`for ${formatDuration(ms)}`);
  const chars = num(p.length) ?? num(p.chars) ?? num(p.characters);
  if (chars !== null && (e.type === 'paste' || e.type === 'copy_attempt')) parts.push(`${chars.toLocaleString()} characters`);
  // Both extension events carry the time added as `seconds` (the engine writes them): "+5 min", "+35 s".
  const added = num(p.seconds);
  if (added !== null && (e.type === 'time_extended' || e.type === 'outage_compensated')) parts.splice(0, parts.length, `+${formatDuration(added * 1000)}`);
  const displays = num(p.displays) ?? num(p.screens);
  if (displays !== null && e.type === 'multiple_displays') parts.push(`${displays} displays`);
  if (typeof p.reason === 'string' && p.reason) parts.push(`“${p.reason}”`);
  return parts.length ? parts.join(', ') : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const SEVERITY_LABEL: Record<EventSeverity, string> = { info: 'Info', low: 'Low', medium: 'Medium', high: 'High' };
export const SEVERITY_TONE: Record<EventSeverity, Tone> = { info: 'neutral', low: 'neutral', medium: 'warning', high: 'danger' };

export const PRIORITY_LABEL: Record<ReviewPriority, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
export const PRIORITY_TONE: Record<ReviewPriority, Tone> = { none: 'neutral', low: 'neutral', medium: 'warning', high: 'danger' };
export const PRIORITY_RANK: Record<ReviewPriority, number> = { none: 0, low: 1, medium: 2, high: 3 };

export const REVIEW_LABEL: Record<IncidentReviewStatus, string> = {
  open: 'Not reviewed',
  no_concern: 'No concern',
  follow_up: 'Follow up',
  escalated: 'Escalated',
};
export const REVIEW_TONE: Record<IncidentReviewStatus, Tone> = { open: 'neutral', no_concern: 'success', follow_up: 'warning', escalated: 'danger' };

export const SUBMIT_REASON_LABEL: Record<SubmitReason, string> = {
  candidate: 'Submitted',
  timeout: 'Auto-submitted',
  proctor: 'Submitted by staff',
  offline_sync: 'Submitted after sync',
};

// ---------------------------------------------------------------- time

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const clockSecondsFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function clockTime(iso: string | number, seconds = false): string {
  return (seconds ? clockSecondsFormat : clockFormat).format(new Date(iso));
}

/** 42:05, or 1:02:05 past an hour. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Words for a duration: "42 s", "3 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  const d = Math.floor(h / 24);
  return `${plural(d, 'day')}${h % 24 ? ` ${h % 24} h` : ''}`;
}

const dayTimeFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "1:03 PM" on the day of `now`, "Mon 30 Nov, 1:03 PM" on any other day. */
export function dayTime(iso: string | number, now: number): string {
  const d = new Date(iso);
  return d.toDateString() === new Date(now).toDateString() ? clockFormat.format(d) : dayTimeFormat.format(d);
}

/** "just now", "2 min ago", "1 h ago". */
export function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < 45_000) return 'just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

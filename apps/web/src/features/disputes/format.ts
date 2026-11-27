import type { Tone } from '@/components/ui/badge';
import type { DisputeCategory, DisputeOutcome, DisputeStatus, RemedyType } from './types';

export const STATUS_TONE: Record<DisputeStatus, Tone> = {
  open: 'info',
  under_review: 'accent',
  needs_info: 'warning',
  resolved: 'success',
  appealed: 'info',
  closed: 'neutral',
};

export const OUTCOME_TONE: Record<DisputeOutcome, Tone> = {
  upheld: 'success',
  partially_upheld: 'success',
  rejected: 'neutral',
};

/** What each kind of problem means, in the candidate's words. Shown when choosing one. */
export const CATEGORY_COPY: Record<DisputeCategory, { label: string; staffLabel: string; explain: string; example: string }> = {
  grading_error: {
    label: 'My answer was marked wrongly',
    staffLabel: 'Grading error',
    explain: 'A correct step got no credit, the rubric was applied unevenly, or the marks don’t add up.',
    example: 'Step 2 uses the right formula and substitutes correctly, but the working was given 1 of 2.',
  },
  ambiguous_question: {
    label: 'The question was unclear or wrong',
    staffLabel: 'Ambiguous question',
    explain: 'It could reasonably be read more than one way, or it had an error, so another answer should count.',
    example: 'The projected copy showed the upper bound as 3, not 2, so none of the options matched.',
  },
  technical_incident: {
    label: 'Something went wrong during the exam',
    staffLabel: 'Technical incident',
    explain: 'You lost connection, the timer misbehaved, or an answer didn’t save. You can raise this before results are out.',
    example: 'My connection dropped around 10:20 for about four minutes and the timer kept running.',
  },
  other: {
    label: 'Something else',
    staffLabel: 'Other',
    explain: 'Anything else about how this exam was run or marked.',
    example: 'I was given the wrong paper version for my section.',
  },
};

export const REMEDY_COPY: Record<RemedyType, { label: string; explain: string }> = {
  accept_alternatives: {
    label: 'Accept another answer',
    explain: 'Also accept a second answer as correct. Everyone keeps the better of the two markings, so nobody loses marks.',
  },
  full_marks_all: {
    label: 'Full marks for everyone',
    explain: 'Every candidate who sat the question gets its full marks, working included. Scores only go up.',
  },
  drop_question: {
    label: 'Drop the question',
    explain: 'The question stops counting, for everyone: the maximum falls and percentages change. Only allowed when nobody earned marks on it.',
  },
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** 2, 1.5, 0.25: marks without trailing zeros. */
export function fmtMarks(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return String(Math.round(n * 1000) / 1000);
}

export function fmtSigned(n: number): string {
  const v = Math.round(n * 1000) / 1000;
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0';
}

export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return `${Math.round(n * 10) / 10}%`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '–');
export const fmtDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '–');
export const fmtTime = (iso: string | null | undefined) => (iso ? timeOnly.format(new Date(iso)) : '–');

/** "3 hours ago", "in 2 days". */
export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < MINUTE) return 'just now';
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

/** A span in the largest sensible units: "2 days 4 hours", "35 minutes". */
export function fmtSpan(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= DAY) {
    const d = Math.floor(abs / DAY);
    const h = Math.floor((abs % DAY) / HOUR);
    return h && d < 3 ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
  }
  if (abs >= HOUR) {
    const h = Math.floor(abs / HOUR);
    const m = Math.floor((abs % HOUR) / MINUTE);
    return m && h < 6 ? `${plural(h, 'hour')} ${plural(m, 'min', 'min')}` : plural(h, 'hour');
  }
  return plural(Math.max(1, Math.round(abs / MINUTE)), 'minute');
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return plural(Math.round(seconds), 'second');
  return fmtSpan(seconds * 1000);
}

export type SlaState = { kind: 'done' } | { kind: 'due'; ms: number; soon: boolean } | { kind: 'overdue'; ms: number };

const ACTIVE: DisputeStatus[] = ['open', 'under_review', 'needs_info'];
export const isActive = (s: DisputeStatus) => ACTIVE.includes(s);

/** Where a dispute stands against its response deadline. Soon means under a day left. */
export function slaState(status: DisputeStatus, dueAt: string | null, now: number): SlaState {
  if (!isActive(status) || !dueAt) return { kind: 'done' };
  const ms = new Date(dueAt).getTime() - now;
  if (ms < 0) return { kind: 'overdue', ms: -ms };
  return { kind: 'due', ms, soon: ms < DAY };
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

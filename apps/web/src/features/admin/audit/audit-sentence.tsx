import type { ReactNode } from 'react';
import type { AuditEntry } from '../types';

/** What each action group is called in filters and on entry chips. */
export const ACTION_GROUPS: Record<string, string> = {
  auth: 'Sign-in',
  people: 'People',
  roles: 'Roles',
  org: 'Settings',
  platform: 'Platform',
  exam: 'Exams',
  exams: 'Exams',
  question: 'Questions',
  questions: 'Questions',
  question_category: 'Questions',
  grading: 'Grading',
  rubric: 'Rubrics',
  results: 'Results',
  monitoring: 'Monitoring',
  attempt: 'Attempts',
  attempts: 'Attempts',
  disputes: 'Disputes',
  dispute: 'Disputes',
  integrity: 'Integrity',
  reports: 'Reports',
  report: 'Reports',
  fairness: 'Fairness',
};

export const groupOf = (action: string) => action.split('.')[0] ?? action;
export const groupLabel = (group: string) =>
  ACTION_GROUPS[group] ?? group.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Sentences for actions that are recorded without a summary. */
const PHRASES: Record<string, (e: AuditEntry) => string> = {
  'auth.login': () => 'signed in',
  'auth.login_failed': (e) =>
    `had a failed sign-in attempt${typeof e.metadata.failed === 'number' ? ` (${e.metadata.failed} in a row)` : ''}`,
  'auth.password_changed': () => 'changed their password',
  'auth.logout': () => 'signed out',
};

function humanize(action: string): string {
  const [group, ...rest] = action.split('.');
  const verb = rest.join(' ').replace(/_/g, ' ');
  return verb ? `${verb} (${groupLabel(group ?? '')})` : action.replace(/_/g, ' ');
}

/** "Published "X"" reads as a continuation after the actor's name: "published X". */
/** Summaries other modules write as labels or in the present tense, recast to follow the actor's name. */
const REWRITES: [RegExp, string][] = [
  [/^Submitted by the candidate$/i, 'submitted their exam'],
  [/^Candidate withdrew a dispute$/i, 'withdrew a dispute'],
  [/^Upheld: /, 'upheld a dispute on '],
  [/^Partially upheld: /, 'partly upheld a dispute on '],
  [/^Not upheld: /, 'turned down a dispute on '],
  [/^Accept an alternative answer on /, 'accepted an alternative answer on '],
  [/^Full marks for everyone on /, 'gave everyone full marks on '],
  [/^Drop the question on /, 'dropped '],
  [/^Also accepts /, 'also accepted '],
  [/^Accepts /, 'accepted '],
  [/^Raised a (?=[aeiou])/i, 'raised an '],
];

function continuation(summary: string): string {
  let s = summary;
  const rule = REWRITES.find(([re]) => re.test(s));
  if (rule) s = s.replace(rule[0], rule[1]);
  s = s.replace(/\b1 (attempt|dispute|question|candidate)s\b/g, '1 $1');
  const first = s.split(/\s/, 1)[0] ?? '';
  return /^[A-Z][a-z]+[:,]?$/.test(first) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Quoted titles become emphasised spans instead of literal quote marks. */
function emphasise(text: string): ReactNode[] {
  return text.split(/"([^"]+)"/g).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-medium text-label">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function auditPredicate(entry: AuditEntry): string {
  if (entry.summary) return continuation(entry.summary);
  return PHRASES[entry.action]?.(entry) ?? humanize(entry.action);
}

/** "Dr. Sara Ahmed published Data Structures & Algorithms Midterm". */
export function AuditSentence({ entry }: { entry: AuditEntry }) {
  const actor = entry.actor?.name ?? 'Athena';
  return (
    <>
      <span className="font-semibold text-label">{actor}</span>{' '}
      <span className="text-label">{emphasise(auditPredicate(entry))}</span>
    </>
  );
}

/** Plain-text version for titles, exports and assistive text. */
export function auditText(entry: AuditEntry): string {
  return `${entry.actor?.name ?? 'Athena'} ${auditPredicate(entry).replace(/"/g, '')}`;
}

const label = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

function value(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.map(value).join(', ') : 'None';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('from' in o || 'to' in o) return `${value(o.from)} → ${value(o.to)}`;
    return Object.entries(o)
      .map(([k, x]) => `${label(k)}: ${value(x)}`)
      .join('; ');
  }
  return String(v);
}

/** Metadata as readable label/value pairs, nested change objects flattened. */
export function metadataRows(
  metadata: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (k === 'changes' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>))
        rows.push({ key: `${k}.${ck}`, label: label(ck), value: value(cv) });
    } else rows.push({ key: k, label: label(k), value: value(v) });
  }
  return rows;
}

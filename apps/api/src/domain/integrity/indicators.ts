import {
  replayProvenance,
  summarizeProvenance,
  type AnswerProvenance,
  type EventSeverity,
  type IncidentReviewStatus,
  type ProvenanceSummary,
} from '@athena/shared';

/**
 * Authorship and behaviour indicators for one attempt (IC-5.1). Pure functions: the service passes events whose
 * time is already bounded (see eventTime in monitoring/analysis) and the stored provenance of written answers.
 *
 * Every indicator becomes a plain-language reason with an innocent explanation beside it. The review priority is
 * a transparent rule over those reasons, so a reviewer can always see why an attempt sits where it does. It orders
 * the review queue; it is never a verdict and never changes a score.
 */

export type IndicatorLevel = 'low' | 'medium' | 'high';
export type ReviewPriority = 'none' | IndicatorLevel;

export type ReasonKind =
  | 'pasted_text'
  | 'burst_text'
  | 'paste_events'
  | 'tab_away'
  | 'device_switch'
  | 'offline'
  | 'second_display'
  | 'copy_attempt'
  | 'print_attempt'
  | 'fullscreen_exit'
  | 'shared_wrong_answers'
  | 'similar_text';

export interface Reason {
  kind: ReasonKind;
  level: IndicatorLevel;
  /** What was observed, in plain language. */
  text: string;
  /** The innocent explanation a reviewer should rule out first. */
  innocent: string;
  /** A reviewer marked every underlying indicator "no concern": shown, but not counted. */
  cleared?: boolean;
  ref?: { answerId?: string; otherAttemptId?: string };
}

/** Shown beside each kind of reason. Written for the reviewer, never for an accusation. */
export const INNOCENT_EXPLANATIONS: Record<ReasonKind, string> = {
  pasted_text:
    'Some candidates draft in another editor and paste the result in, especially after a connection drop or when they fear losing work.',
  burst_text: 'Browser autofill, dictation software and accessibility tools insert text in one go without a paste.',
  paste_events: 'Pasting a draft from earlier in the same exam, or moving a paragraph, records a paste too.',
  tab_away: 'Notifications, a battery warning, a second monitor or checking the time elsewhere all move focus away from the tab.',
  device_switch: 'A laptop that ran out of battery or crashed, with the candidate continuing on another device.',
  offline: 'Unstable Wi-Fi is the usual cause. Answers written offline stay in a sealed, hash-chained journal.',
  second_display: 'Many laptops are docked to an external monitor. It does not show that the screen was used for help.',
  copy_attempt: 'Selecting text to re-read it, or pressing Ctrl+C out of habit, triggers this. Copied text carries the paper fingerprint.',
  print_attempt: 'Pressing Ctrl+P by accident, or a browser extension, triggers this.',
  fullscreen_exit: 'Pressing Esc, or the operating system leaving full screen for a notification or an update.',
  shared_wrong_answers:
    'Candidates who revised together, or from the same flawed notes or past paper, can share the same wrong answers.',
  similar_text: 'Shared study notes, a common textbook passage or a model answer discussed in class produce similar wording too.',
};

/** The rule behind the priority, returned with every overview so the UI can show it verbatim. */
export const PRIORITY_RULE =
  'High: one strong indicator, or two different medium ones. Medium: one medium indicator, or three different minor ones. Low: any other indicator. Indicators a reviewer cleared are shown but not counted.';

/** An attempt event with its time already bounded to the attempt (client time when plausible). */
export interface TimedEvent {
  type: string;
  severity: EventSeverity;
  at: Date;
  /** When the server received it. */
  receivedAt: Date;
  payload: Record<string, unknown>;
  reviewStatus: IncidentReviewStatus | null;
}

const MINUTE = 60_000;
/** A single away interval longer than this is capped: the tab was probably just left open. */
const MAX_AWAY_MS = 30 * MINUTE;
const ONLINE_TYPES = new Set(['came_online', 'offline_journal_received', 'resumed']);

const byTime = (a: TimedEvent, b: TimedEvent) => a.at.getTime() - b.at.getTime();

function payloadMs(payload: Record<string, unknown>): number | null {
  for (const key of ['awayMs', 'durationMs', 'ms']) {
    const v = payload[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------------
// Behaviour summaries
// ---------------------------------------------------------------------------------------------------------

export interface FocusSummary {
  count: number;
  totalMs: number;
  longestMs: number;
}

/**
 * How often and how long the exam tab lost focus. Pairs focus_lost with the next focus_returned; a duration the
 * client measured itself (awayMs/durationMs) wins over the pairing. A tab still away at the end counts until `endAt`.
 */
export function focusSummary(events: TimedEvent[], endAt: Date): FocusSummary {
  let lostAt: number | null = null;
  let count = 0;
  let totalMs = 0;
  let longestMs = 0;
  const add = (ms: number) => {
    const bounded = Math.min(MAX_AWAY_MS, Math.max(0, ms));
    totalMs += bounded;
    longestMs = Math.max(longestMs, bounded);
  };
  for (const e of events.filter((e) => e.type === 'focus_lost' || e.type === 'focus_returned').sort(byTime)) {
    if (e.type === 'focus_lost') {
      if (lostAt === null) {
        count++;
        lostAt = e.at.getTime();
      }
      continue;
    }
    const measured = payloadMs(e.payload);
    if (lostAt === null && measured !== null) count++;
    const ms = measured ?? (lostAt !== null ? e.at.getTime() - lostAt : null);
    if (ms !== null) add(ms);
    lostAt = null;
  }
  if (lostAt !== null) add(endAt.getTime() - lostAt);
  return { count, totalMs, longestMs };
}

export interface OfflineInterval {
  from: Date;
  to: Date;
  ms: number;
  /** No sign of the client coming back was recorded; `to` is an estimate. */
  open: boolean;
}

/**
 * Offline intervals from went_offline and the next sign of life (came_online, journal upload, resume). A browser can
 * only report going offline after reconnecting, so when nothing else marks the return, the moment the server received
 * the went_offline report is the best estimate of it.
 */
export function offlineIntervals(events: TimedEvent[], endAt: Date): OfflineInterval[] {
  const out: OfflineInterval[] = [];
  let from: Date | null = null;
  let reportedBack: Date | null = null;
  for (const e of [...events].sort(byTime)) {
    if (e.type === 'went_offline' && from === null) {
      from = e.at;
      reportedBack = e.receivedAt.getTime() - e.at.getTime() > 5_000 ? e.receivedAt : null;
    } else if (ONLINE_TYPES.has(e.type) && from !== null) {
      out.push({ from, to: e.at, ms: Math.max(0, e.at.getTime() - from.getTime()), open: false });
      from = null;
    }
  }
  if (from !== null) {
    const to = reportedBack && reportedBack > from ? reportedBack : endAt;
    out.push({ from, to, ms: Math.max(0, to.getTime() - from.getTime()), open: !reportedBack });
  }
  return out;
}

export interface IncidentCounts {
  /** Indicator events (severity above info) by type. */
  byType: Record<string, number>;
  bySeverity: Record<IndicatorLevel, number>;
  /** Review state of those indicators; unreviewed ones count as open. */
  review: Record<IncidentReviewStatus, number>;
}

export function incidentCounts(events: TimedEvent[]): IncidentCounts {
  const counts: IncidentCounts = {
    byType: {},
    bySeverity: { low: 0, medium: 0, high: 0 },
    review: { open: 0, no_concern: 0, follow_up: 0, escalated: 0 },
  };
  for (const e of events) {
    if (e.severity === 'info') continue;
    counts.byType[e.type] = (counts.byType[e.type] ?? 0) + 1;
    counts.bySeverity[e.severity]++;
    counts.review[e.reviewStatus ?? 'open']++;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------------------
// Written answers
// ---------------------------------------------------------------------------------------------------------

export interface WrittenAnswer {
  answerId: string;
  /** "Q4, Processes vs threads" */
  label: string;
  /** What to call the text: "essay", "code", "short answer", "working". */
  noun: string;
  finalText: string;
  provenance: AnswerProvenance | null;
}

/** Characters of the text as it stands now, by where they came from (null when the replay log was truncated). */
export interface FinalComposition {
  typed: number;
  pasted: number;
  burst: number;
  total: number;
}

export function finalComposition(p: AnswerProvenance): FinalComposition | null {
  if (p.truncated) return null;
  const out: FinalComposition = { typed: 0, pasted: 0, burst: 0, total: 0 };
  for (const s of replayProvenance(p).segments) {
    const n = [...s.text].length;
    out[s.origin === 'typed' ? 'typed' : s.origin === 'pasted' ? 'pasted' : 'burst'] += n;
    out.total += n;
  }
  return out;
}

export interface WrittenSummary {
  answerId: string;
  label: string;
  noun: string;
  chars: number;
  summary: ProvenanceSummary | null;
  composition: FinalComposition | null;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** Reasons from one written answer's provenance. Small pastes (a word, a formula) are not worth a reviewer's time. */
export function provenanceReasons(w: WrittenAnswer, summary: ProvenanceSummary, composition: FinalComposition | null): Reason[] {
  const reasons: Reason[] = [];
  const ref = { answerId: w.answerId };
  if (summary.pasteCount > 0 && summary.pastedChars >= 40) {
    const pastes = plural(summary.pasteCount, 'paste');
    let level: IndicatorLevel = 'low';
    let text: string;
    if (composition && composition.total > 0) {
      const share = composition.pasted / composition.total;
      if (share >= 0.5 && composition.pasted >= 200) level = 'high';
      else if ((share >= 0.2 && composition.pasted >= 120) || summary.largestPaste >= 200) level = 'medium';
      text =
        composition.pasted > 0
          ? `${w.label}: ${pct(share)} of the final ${w.noun} text arrived in ${pastes} (${plural(summary.pastedChars, 'char')})`
          : `${w.label}: ${pastes} (${plural(summary.pastedChars, 'char')}), all later deleted or rewritten`;
    } else {
      const share = summary.pastedChars / Math.max(1, summary.typedChars + summary.pastedChars + summary.burstChars);
      if (share >= 0.5 && summary.pastedChars >= 200) level = 'high';
      else if (summary.largestPaste >= 200) level = 'medium';
      text = `${w.label}: ${pct(share)} of everything entered in the ${w.noun} was pasted, in ${pastes}`;
    }
    reasons.push({ kind: 'pasted_text', level, text, innocent: INNOCENT_EXPLANATIONS.pasted_text, ref });
  }
  if (summary.burstCount > 0 && summary.burstChars >= 80) {
    const share = composition && composition.total > 0 ? composition.burst / composition.total : null;
    const level: IndicatorLevel = share !== null && share >= 0.5 && composition!.burst >= 200 ? 'medium' : 'low';
    reasons.push({
      kind: 'burst_text',
      level,
      text: `${w.label}: ${plural(summary.burstCount, 'burst')} inserted ${plural(summary.burstChars, 'char')} at once without a paste`,
      innocent: INNOCENT_EXPLANATIONS.burst_text,
      ref,
    });
  }
  return reasons;
}

// ---------------------------------------------------------------------------------------------------------
// Similarity notes (computed by similarity.ts, phrased here)
// ---------------------------------------------------------------------------------------------------------

export interface SimilarityNote {
  kind: 'objective' | 'written';
  otherAttemptId: string;
  otherName: string;
  /** objective: shared wrong answers. */
  sharedWrong?: number;
  z?: number | null;
  /** written: Jaccard of the normalized text and the item it is about. */
  jaccard?: number;
  label?: string;
  noun?: string;
}

export function similarityReason(note: SimilarityNote): Reason {
  if (note.kind === 'objective') {
    const z = note.z != null ? `, ${note.z.toFixed(1)} standard deviations above a typical pair` : '';
    return {
      kind: 'shared_wrong_answers',
      level: 'high',
      text: `Shares ${plural(note.sharedWrong ?? 0, 'uncommon wrong answer')} with ${note.otherName}${z}`,
      innocent: INNOCENT_EXPLANATIONS.shared_wrong_answers,
      ref: { otherAttemptId: note.otherAttemptId },
    };
  }
  const j = note.jaccard ?? 0;
  return {
    kind: 'similar_text',
    level: j >= 0.7 ? 'high' : 'medium',
    text: `${note.label ?? 'A written answer'}: ${pct(j)} of the ${note.noun ?? 'answer'} wording overlaps with ${note.otherName}'s`,
    innocent: INNOCENT_EXPLANATIONS.similar_text,
    ref: { otherAttemptId: note.otherAttemptId },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The assessment
// ---------------------------------------------------------------------------------------------------------

const allCleared = (events: TimedEvent[]) => events.length > 0 && events.every((e) => e.reviewStatus === 'no_concern');

function eventReasons(events: TimedEvent[], hasProvenance: boolean): Reason[] {
  const of = (type: string) => events.filter((e) => e.type === type);
  const reasons: Reason[] = [];

  const displays = of('multiple_displays');
  if (displays.length) {
    reasons.push({
      kind: 'second_display',
      level: 'medium',
      text: `A second display was detected ${times(displays.length)}`,
      innocent: INNOCENT_EXPLANATIONS.second_display,
      cleared: allCleared(displays),
    });
  }
  const copies = of('copy_attempt');
  if (copies.length) {
    reasons.push({
      kind: 'copy_attempt',
      level: 'low',
      text: `Tried to copy exam text ${times(copies.length)}`,
      innocent: INNOCENT_EXPLANATIONS.copy_attempt,
      cleared: allCleared(copies),
    });
  }
  const prints = of('print_attempt');
  if (prints.length) {
    reasons.push({
      kind: 'print_attempt',
      level: 'low',
      text: `Tried to print the paper ${times(prints.length)}`,
      innocent: INNOCENT_EXPLANATIONS.print_attempt,
      cleared: allCleared(prints),
    });
  }
  const exits = of('fullscreen_exited');
  if (exits.length) {
    reasons.push({
      kind: 'fullscreen_exit',
      level: exits.length >= 10 ? 'medium' : 'low',
      text: `Left full screen ${times(exits.length)}`,
      innocent: INNOCENT_EXPLANATIONS.fullscreen_exit,
      cleared: allCleared(exits),
    });
  }
  // Provenance already describes pastes into written answers precisely; events only fill in when it is missing.
  const pastes = of('paste');
  if (pastes.length && !hasProvenance) {
    const largest = Math.max(0, ...pastes.map((e) => Number(e.payload.length ?? 0) || 0));
    reasons.push({
      kind: 'paste_events',
      level: largest > 200 ? 'medium' : 'low',
      text: `Pasted into an answer ${times(pastes.length)}${largest > 0 ? ` (largest ${plural(largest, 'char')})` : ''}`,
      innocent: INNOCENT_EXPLANATIONS.paste_events,
      cleared: allCleared(pastes),
    });
  }
  return reasons;
}

export interface AttemptInput {
  events: TimedEvent[];
  /** End of the observation window: submission, deadline or now. */
  endAt: Date;
  written: WrittenAnswer[];
  similarity: SimilarityNote[];
}

export interface AttemptAssessment {
  priority: ReviewPriority;
  reasons: Reason[];
  focus: FocusSummary;
  offline: { intervals: OfflineInterval[]; totalMs: number };
  deviceSwitches: number;
  incidents: IncidentCounts;
  written: WrittenSummary[];
}

const LEVEL_RANK: Record<IndicatorLevel, number> = { high: 0, medium: 1, low: 2 };

/** Priority as a rule over the reasons, never a score. */
export function reviewPriority(reasons: Reason[]): ReviewPriority {
  const active = reasons.filter((r) => !r.cleared);
  if (active.length === 0) return 'none';
  if (active.some((r) => r.level === 'high')) return 'high';
  const medium = new Set(active.filter((r) => r.level === 'medium').map((r) => r.kind));
  if (medium.size >= 2) return 'high';
  if (medium.size === 1) return 'medium';
  const low = new Set(active.map((r) => r.kind));
  return low.size >= 3 ? 'medium' : 'low';
}

export function assessAttempt(input: AttemptInput): AttemptAssessment {
  const reasons: Reason[] = [];
  const written: WrittenSummary[] = [];

  for (const w of input.written) {
    const summary = w.provenance ? summarizeProvenance(w.provenance) : null;
    const composition = w.provenance ? finalComposition(w.provenance) : null;
    written.push({ answerId: w.answerId, label: w.label, noun: w.noun, chars: [...w.finalText].length, summary, composition });
    if (summary) reasons.push(...provenanceReasons(w, summary, composition));
  }

  const focus = focusSummary(input.events, input.endAt);
  if (focus.count > 0) {
    const level: IndicatorLevel | null =
      focus.count >= 10 || focus.totalMs >= 5 * MINUTE ? 'medium' : focus.count >= 3 || focus.totalMs >= MINUTE ? 'low' : null;
    if (level) {
      const focusEvents = input.events.filter((e) => e.type === 'focus_lost');
      reasons.push({
        kind: 'tab_away',
        level,
        text: `Left the exam tab ${times(focus.count)} (${formatDuration(focus.totalMs)} total${
          focus.count > 1 ? `, longest ${formatDuration(focus.longestMs)}` : ''
        })`,
        innocent: INNOCENT_EXPLANATIONS.tab_away,
        cleared: allCleared(focusEvents),
      });
    }
  }

  const deviceSwitches = input.events.filter((e) => e.type === 'device_switched').length;
  if (deviceSwitches > 0) {
    reasons.push({
      kind: 'device_switch',
      level: 'low',
      text: `Continued on another device ${times(deviceSwitches)}`,
      innocent: INNOCENT_EXPLANATIONS.device_switch,
    });
  }

  const intervals = offlineIntervals(input.events, input.endAt);
  const offlineMs = intervals.reduce((n, i) => n + i.ms, 0);
  if (offlineMs >= 2 * MINUTE) {
    reasons.push({
      kind: 'offline',
      level: 'low',
      text: `Offline for ${formatDuration(offlineMs)} across ${plural(intervals.length, 'interruption')}`,
      innocent: INNOCENT_EXPLANATIONS.offline,
    });
  }

  reasons.push(...eventReasons(input.events, input.written.some((w) => w.provenance)));
  reasons.push(...input.similarity.map(similarityReason));

  // Strongest first; cleared reasons sink to the end of their level.
  reasons.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || Number(!!a.cleared) - Number(!!b.cleared));

  return {
    priority: reviewPriority(reasons),
    reasons,
    focus,
    offline: { intervals, totalMs: offlineMs },
    deviceSwitches,
    incidents: incidentCounts(input.events),
    written,
  };
}

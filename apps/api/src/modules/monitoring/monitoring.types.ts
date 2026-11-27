import type { AttemptStatus, EventSeverity, ExamPhase, IncidentReviewStatus, SubmitReason } from '@athena/shared';

/**
 * Response shapes of the live monitoring API. The web app mirrors them in features/monitoring/types.ts.
 * Nothing here carries answer content or keys: progress is reported as counts only.
 */

export type ReviewPriority = 'none' | 'low' | 'medium' | 'high';
export type IndicatorSeverity = Exclude<EventSeverity, 'info'>;

/** Shown wherever integrity indicators appear. */
export const INDICATOR_NOTICE =
  'Indicators show what the browser reported. They are not evidence of misconduct and never change a score automatically.';

export interface CandidateRef {
  userId: string;
  name: string;
  rollNumber: string | null;
  initials: string;
}

export interface MonitorEvent {
  id: string;
  attemptId: string;
  candidate: CandidateRef;
  type: string;
  severity: EventSeverity;
  /** Server time the event was recorded (ordering uses this). */
  createdAt: string;
  /** What the browser claimed; informational only. */
  clientTs: string | null;
  /** Primitive details only (durations, counts). Text the candidate typed or pasted is never included. */
  payload: Record<string, string | number | boolean>;
  review: { status: IncidentReviewStatus; note: string | null; reviewedAt: string | null; reviewedBy: string | null } | null;
}

export interface LiveAttempt {
  attemptId: string;
  candidate: CandidateRef;
  email: string;
  cohort: string | null;
  status: AttemptStatus;
  submitReason: SubmitReason | null;
  answeredCount: number;
  itemCount: number;
  flaggedCount: number;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  /** Seconds left on the server deadline; null once submitted. */
  remainingSeconds: number | null;
  timeExtensionSeconds: number;
  lastSeenAt: string | null;
  online: boolean;
  rttMs: number | null;
  reviewPriority: ReviewPriority;
  /** Indicators (severity low and above). */
  incidents: { total: number; open: number; byType: Record<string, number> };
  deviceSwitches: number;
}

export interface NotStartedCandidate extends CandidateRef {
  email: string;
  cohort: string | null;
  /** Accommodation in effect, so staff know who will get extra time. */
  accommodation: { timeMultiplier: number; extraMinutes: number } | null;
}

export interface OutageSuggestion {
  kind: 'bulk_extension';
  /** Candidates whose connection dropped inside the same two-minute window. */
  affected: number;
  attemptIds: string[];
  /** In-progress attempts the share was measured against. */
  inProgress: number;
  windowStart: string;
  windowEnd: string;
  /** How many of the affected are still offline. */
  stillOffline: number;
  /** Suggested extension: the median time lost, rounded up to whole minutes. */
  minutes: number;
}

export interface LiveSummary {
  enrolled: number;
  notStarted: number;
  inProgress: number;
  awaitingSync: number;
  submitted: number;
  onlineNow: number;
  openIncidents: number;
}

export interface LiveMonitor {
  serverNow: string;
  exam: {
    id: string;
    title: string;
    code: string | null;
    phase: ExamPhase;
    windowOpensAt: string;
    windowClosesAt: string;
    durationMinutes: number;
  };
  summary: LiveSummary;
  attempts: LiveAttempt[];
  notStarted: NotStartedCandidate[];
  recentEvents: MonitorEvent[];
  suggestion: OutageSuggestion | null;
}

export interface ConnectivitySegment {
  from: string;
  to: string;
  state: 'online' | 'offline';
  /** reported: went_offline / came_online events. heartbeat: inferred from a silent client. */
  source: 'reported' | 'heartbeat';
}

export interface AttemptTimeline {
  serverNow: string;
  notice: string;
  attempt: LiveAttempt & {
    examId: string;
    device: { userAgent: string | null; platform: string | null; screen: string | null; timezone: string | null };
  };
  events: MonitorEvent[];
  connectivity: ConnectivitySegment[];
  /** Answered count over time, from the moment each item was answered. Counts only. */
  progress: { at: string; answered: number }[];
}

export interface StaffAnnouncement {
  id: string;
  body: string;
  priority: 'normal' | 'urgent';
  createdAt: string;
  author: { id: string; name: string } | null;
  target: { userId: string; name: string } | null;
  readCount: number;
  recipientCount: number;
}

export interface StaffClarification {
  id: string;
  attemptId: string;
  candidate: CandidateRef;
  question: string;
  /**
   * The question it is about: `number` is its place on this candidate's paper (1-based). Papers are shuffled,
   * so the bank title is what identifies it across candidates.
   */
  item: { id: string; number: number; questionTitle: string | null } | null;
  answer: string | null;
  broadcast: boolean;
  answeredBy: { id: string; name: string } | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface IncidentList {
  notice: string;
  counts: { open: number; reviewed: number; bySeverity: Record<IndicatorSeverity, number> };
  incidents: MonitorEvent[];
}

export interface ExtensionResult {
  attemptId: string;
  deadlineAt: string;
  timeExtensionSeconds: number;
}

export interface BulkExtensionResult {
  extended: ExtensionResult[];
  skipped: { attemptId: string; reason: string }[];
  minutes: number;
}

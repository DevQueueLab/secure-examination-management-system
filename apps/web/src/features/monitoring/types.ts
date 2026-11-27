import type { AttemptStatus, EventSeverity, ExamPhase, IncidentReviewStatus, SubmitReason } from '@athena/shared';

/**
 * Response shapes of /api/v1/monitoring. Mirrors apps/api/src/modules/monitoring/monitoring.types.ts:
 * keep the two in step (they belong in @athena/shared once the contract settles).
 */

export type ReviewPriority = 'none' | 'low' | 'medium' | 'high';
export type IndicatorSeverity = Exclude<EventSeverity, 'info'>;
export type ReviewOutcome = Exclude<IncidentReviewStatus, 'open'>;

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
  createdAt: string;
  clientTs: string | null;
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
  remainingSeconds: number | null;
  timeExtensionSeconds: number;
  lastSeenAt: string | null;
  online: boolean;
  rttMs: number | null;
  reviewPriority: ReviewPriority;
  incidents: { total: number; open: number; byType: Record<string, number> };
  deviceSwitches: number;
}

export interface NotStartedCandidate extends CandidateRef {
  email: string;
  cohort: string | null;
  accommodation: { timeMultiplier: number; extraMinutes: number } | null;
}

export interface OutageSuggestion {
  kind: 'bulk_extension';
  affected: number;
  attemptIds: string[];
  inProgress: number;
  windowStart: string;
  windowEnd: string;
  stillOffline: number;
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
  /** `number` is the question's place on this candidate's (shuffled) paper; the title identifies it across papers. */
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

/** One row of the roster: a started attempt, or an enrolled candidate who has not started. */
export type RosterEntry =
  | { kind: 'attempt'; key: string; attempt: LiveAttempt }
  | { kind: 'not-started'; key: string; candidate: NotStartedCandidate };

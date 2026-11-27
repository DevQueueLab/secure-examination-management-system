import { z } from 'zod';
import { ATTEMPT_EVENT_TYPES, type AttemptStatus, type ExamPhase, type ResultsStatus, type SubmitReason } from './enums';
import type { QuestionType } from './question-types';
import { workingResponseSchema } from './question-types';

/**
 * Contract between the attempt engine (API) and the candidate workspace (web).
 * Timestamps are ISO strings in UTC. The client never decides time: it renders the countdown from
 * `serverNow` + performance.now() and re-syncs on every response.
 */

// ---------- candidate dashboard & lobby ----------
export interface CandidateExamCard {
  examId: string;
  title: string;
  code: string | null;
  organizationName: string;
  phase: ExamPhase;
  windowOpensAt: string;
  windowClosesAt: string;
  durationMinutes: number;
  totalMarks: number;
  questionCount: number;
  /** Effective time limit including accommodations, in minutes. */
  timeLimitMinutes: number;
  attempt: { id: string; status: AttemptStatus; startedAt: string; deadlineAt: string; submittedAt: string | null } | null;
  resultsStatus: ResultsStatus;
  /** Why the candidate cannot start right now (null when they can). */
  blockedReason: string | null;
  canStart: boolean;
}

export interface ExamLobby extends CandidateExamCard {
  instructions: string;
  sections: { title: string; questionCount: number; marks: number }[];
  requiresAccessCode: boolean;
  honorCode: string | null;
  integrity: { requireFullscreen: boolean; detectFocusLoss: boolean; blockCopyPaste: boolean; watermark: boolean };
  allowCalculator: boolean;
  allowScratchpad: boolean;
  navigation: 'free' | 'linear';
  accommodation: { timeMultiplier: number; extraMinutes: number; note: string | null } | null;
  serverNow: string;
}

export const startAttemptSchema = z.object({
  examId: z.string().uuid(),
  accessCode: z.string().trim().max(32).optional(),
  pledgeAccepted: z.boolean().refine((v) => v, 'Please accept the honor code to begin'),
  clientInfo: z
    .object({
      userAgent: z.string().max(400).optional(),
      platform: z.string().max(100).optional(),
      screen: z.string().max(40).optional(),
      timezone: z.string().max(60).optional(),
    })
    .default({}),
});
export type StartAttemptInput = z.infer<typeof startAttemptSchema>;

// ---------- workspace ----------
export interface AttemptItemView {
  id: string;
  position: number;
  sectionId: string | null;
  type: QuestionType;
  marks: number;
  workingMarks: number;
  /** Candidate-safe content: never contains an answer key. */
  content: Record<string, unknown>;
}

export interface AnswerState {
  itemId: string;
  response: Record<string, unknown> | null;
  working: z.infer<typeof workingResponseSchema> | null;
  revision: number;
  flagged: boolean;
  answeredAt: string | null;
}

export interface AnnouncementView {
  id: string;
  body: string;
  priority: 'normal' | 'urgent';
  createdAt: string;
  read: boolean;
}

export interface ClarificationView {
  id: string;
  question: string;
  answer: string | null;
  itemId: string | null;
  broadcast: boolean;
  mine: boolean;
  createdAt: string;
  answeredAt: string | null;
}

export interface ScratchpadState {
  pageKey: string;
  kind: 'canvas' | 'notes';
  data: Record<string, unknown>;
  revision: number;
}

export interface AttemptView {
  id: string;
  examId: string;
  examTitle: string;
  examCode: string | null;
  organizationName: string;
  isSandbox: boolean;
  status: AttemptStatus;
  submitReason: SubmitReason | null;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  serverNow: string;
  /** Leak-tracing code shown in the watermark. */
  fingerprint: string;
  settings: {
    navigation: 'free' | 'linear';
    allowCalculator: boolean;
    allowScratchpad: boolean;
    integrity: { requireFullscreen: boolean; detectFocusLoss: boolean; blockCopyPaste: boolean; watermark: boolean };
    reconnectGraceMinutes: number;
  };
  sections: { id: string; title: string; instructions: string | null }[];
  items: AttemptItemView[];
  answers: AnswerState[];
  announcements: AnnouncementView[];
  clarifications: ClarificationView[];
  scratchpads: ScratchpadState[];
}

// ---------- sync (autosave + heartbeat) ----------
export const answerChangeSchema = z.object({
  itemId: z.string().uuid(),
  /** Monotonic per item, incremented by the client on every local change. Stale revisions are ignored. */
  revision: z.number().int().min(1),
  response: z.record(z.string(), z.unknown()).nullable(),
  working: workingResponseSchema.nullable().optional(),
  flagged: z.boolean().optional(),
  timeSpentMs: z.number().int().min(0).max(24 * 3600_000).optional(),
  /** Authorship provenance for written answers (typed vs pasted, bursts, replay ops). */
  provenance: z.record(z.string(), z.unknown()).optional(),
  /** Client-measured time of the change (informational only, never trusted for deadlines). */
  changedAt: z.string().datetime().optional(),
});
export type AnswerChange = z.infer<typeof answerChangeSchema>;

export const clientEventSchema = z.object({
  type: z.enum(ATTEMPT_EVENT_TYPES),
  clientTs: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const scratchpadChangeSchema = z.object({
  pageKey: z.string().min(1).max(64),
  kind: z.enum(['canvas', 'notes']),
  data: z.record(z.string(), z.unknown()),
  revision: z.number().int().min(1),
});

export const syncRequestSchema = z.object({
  answers: z.array(answerChangeSchema).max(100).default([]),
  events: z.array(clientEventSchema).max(200).default([]),
  scratchpads: z.array(scratchpadChangeSchema).max(20).default([]),
  /** Items the candidate opened since the last sync (first-view tracking, analytics). */
  viewed: z.array(z.string().uuid()).max(100).default([]),
  /** Round-trip time of the previous sync, for the examiner's connection-quality view. */
  rttMs: z.number().int().min(0).max(120_000).optional(),
  /** Id of the newest announcement the client has. */
  lastAnnouncementId: z.string().uuid().optional(),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncResponse {
  serverNow: string;
  deadlineAt: string;
  status: AttemptStatus;
  /** Highest revision the server holds per item after applying this request. */
  accepted: { itemId: string; revision: number }[];
  rejected: { itemId: string; reason: 'closed' | 'invalid'; message: string }[];
  scratchpadsAccepted: { pageKey: string; revision: number }[];
  announcements: AnnouncementView[];
  clarifications: ClarificationView[];
  timeExtensionSeconds: number;
}

export const submitAttemptSchema = syncRequestSchema.extend({
  confirm: z.literal(true),
});

export interface SubmissionReceipt {
  attemptId: string;
  status: AttemptStatus;
  submitReason: SubmitReason | null;
  submittedAt: string | null;
  answeredCount: number;
  itemCount: number;
  flaggedCount: number;
  /** HMAC over the final answers: proof of exactly what was submitted (used in disputes). */
  receiptCode: string;
  /** Present only for sandbox previews (examiners see auto-grades immediately). */
  sandboxScore?: { score: number; maxScore: number; pendingManual: number };
}

// ---------- offline journal (5.3) ----------
/**
 * When the deadline passes while a candidate is offline, the client seals its local journal and uploads it
 * on reconnect. Those answers are NOT counted automatically: they are held for examiner review.
 */
export const offlineJournalSchema = z.object({
  sealedAt: z.string().datetime(),
  /** Server time at the last successful sync before going offline. */
  lastServerSync: z.string().datetime().optional(),
  answers: z.array(answerChangeSchema).max(200),
  /** SHA-256 hash chain over the entries, so reordering or editing is detectable. */
  chain: z.string().max(128).optional(),
});
export type OfflineJournal = z.infer<typeof offlineJournalSchema>;

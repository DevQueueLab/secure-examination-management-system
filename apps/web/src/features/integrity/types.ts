import type { AnswerProvenance, AttemptStatus, ExamPhase, IncidentReviewStatus, ProvenanceSummary, QuestionType } from '@athena/shared';

/** Mirrors apps/api/src/modules/integrity/integrity.types.ts (and the domain types it re-exports). */

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
  text: string;
  innocent: string;
  cleared?: boolean;
  ref?: { answerId?: string; otherAttemptId?: string };
}

export interface CandidateRef {
  attemptId: string;
  userId: string;
  name: string;
  email: string;
  rollNumber: string | null;
}

export interface ExamRef {
  id: string;
  title: string;
  code: string | null;
  phase: ExamPhase;
}

export interface FinalComposition {
  typed: number;
  pasted: number;
  burst: number;
  total: number;
}

export interface WrittenAnswerView {
  answerId: string;
  attemptItemId: string;
  position: number;
  title: string;
  type: QuestionType;
  field: 'response' | 'working';
  label: string;
  noun: string;
  chars: number;
  hasReplay: boolean;
  summary: ProvenanceSummary | null;
  composition: FinalComposition | null;
}

export interface SimilarityLink {
  otherAttemptId: string;
  otherName: string;
  kind: 'objective' | 'written';
  detail: string;
}

export interface IncidentCounts {
  byType: Record<string, number>;
  bySeverity: Record<IndicatorLevel, number>;
  review: Record<IncidentReviewStatus, number>;
}

export interface OverviewAttempt {
  candidate: CandidateRef;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  priority: ReviewPriority;
  reasons: Reason[];
  incidents: IncidentCounts;
  focus: { count: number; totalMs: number; longestMs: number };
  deviceSwitches: number;
  offline: { intervals: { from: string; to: string; ms: number; open: boolean }[]; totalMs: number };
  written: WrittenAnswerView[];
  similarity: SimilarityLink[];
}

export interface IntegrityOverview {
  exam: ExamRef;
  notice: string;
  priorityRule: string;
  generatedAt: string;
  totals: {
    attempts: number;
    byPriority: Record<ReviewPriority, number>;
    openIndicators: number;
    writtenAnswers: number;
    answersWithPastes: number;
    flaggedPairs: number;
  };
  attempts: OverviewAttempt[];
}

export interface ProvenanceView {
  notice: string;
  answerId: string;
  exam: ExamRef;
  candidate: CandidateRef;
  item: { attemptItemId: string; position: number; title: string; type: QuestionType; stem: string; field: 'response' | 'working'; label: string; noun: string };
  provenance: AnswerProvenance | null;
  summary: ProvenanceSummary | null;
  composition: FinalComposition | null;
  finalText: string;
  replayMatchesFinal: boolean;
}

export interface Distribution {
  pairs: number;
  mean: number;
  sd: number;
  p95: number;
  max: number;
  enough: boolean;
  histogram: { from: number; to: number; count: number }[];
}

export interface Passage {
  start: number;
  end: number;
}

export interface SharedWrongAnswerView {
  questionId: string;
  title: string;
  type: QuestionType;
  positionA: number;
  positionB: number;
  response: string;
  respondents: number;
  count: number;
  share: number;
  weight: number;
  apartMs: number | null;
  /** Same answer on papers with different numbers (parameter variants), wrong for at least one of them. */
  crossVariant: boolean;
  variantNote: string | null;
}

export interface ObjectiveEvidence {
  score: number;
  z: number | null;
  comparableItems: number;
  bothWrong: number;
  within2Min: number | null;
  sharedWrong: SharedWrongAnswerView[];
}

export interface WrittenEvidence {
  questionId: string;
  title: string;
  field: 'response' | 'working';
  label: string;
  jaccard: number;
  a: { text: string; passages: Passage[] };
  b: { text: string; passages: Passage[] };
}

export interface SimilarityPair {
  id: string;
  a: CandidateRef;
  b: CandidateRef;
  objective: ObjectiveEvidence | null;
  written: WrittenEvidence[];
}

export interface SimilarityReport {
  exam: ExamRef;
  notice: string;
  caveats: string[];
  generatedAt: string;
  thresholds: { z: number; minSharedWrong: number; jaccard: number; minChars: number; shingle: number; timingWindowMinutes: number };
  objective: { distribution: Distribution; flaggedPairs: number; comparedItems: number };
  written: { distribution: Distribution; flaggedPairs: number };
  pairs: SimilarityPair[];
}

// Leak tracer (POST /integrity/leak-trace)

/** exact: a valid invisible mark or typed code. strong: one paper fits two or more details. weak: a few papers fit. */
export type LeakConfidence = 'exact' | 'strong' | 'weak' | 'none';

export interface LeakExactMatch {
  via: ('invisible_mark' | 'typed_code')[];
  code: string;
  candidate: CandidateRef;
  exam: ExamRef;
  servedAt: string;
  submittedAt: string | null;
  preview: boolean;
  matchedStems: { position: number; title: string; coverage: number }[];
  corroborated: boolean | null;
}

export interface LeakObservationView {
  questionId: string;
  title: string;
  kind: 'numbers' | 'order' | 'drawn';
  detail: string;
  sequence: string[] | null;
  fits: number;
  papers: number;
}

export interface LeakCandidateView {
  candidate: CandidateRef;
  servedAt: string;
  submittedAt: string | null;
  fits: number;
  of: number;
}

export interface LeakExamFinding {
  exam: ExamRef;
  papers: number;
  questions: { questionId: string; title: string; coverage: number; excerpt: string }[];
  observations: LeakObservationView[];
  fittingCount: number;
  candidates: LeakCandidateView[];
  closest: boolean;
  confidence: Exclude<LeakConfidence, 'exact'>;
}

export interface LeakTraceResult {
  notice: string;
  generatedAt: string;
  input: { chars: number; typedCode: string | null };
  marks: { status: 'intact' | 'damaged' | 'none'; found: number };
  confidence: LeakConfidence;
  headline: string;
  exact: LeakExactMatch[];
  restricted: number;
  unknownCodes: string[];
  findings: LeakExamFinding[];
  searched: { exams: number; papers: number; windowDays: number };
}

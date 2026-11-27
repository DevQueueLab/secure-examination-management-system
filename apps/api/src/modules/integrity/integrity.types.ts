import type { AnswerProvenance, AttemptStatus, ExamPhase, ProvenanceSummary, QuestionType } from '@athena/shared';
import type {
  FinalComposition,
  FocusSummary,
  IncidentCounts,
  Reason,
  ReviewPriority,
} from '../../domain/integrity/indicators';
import type { Distribution, Passage } from '../../domain/integrity/similarity';

/**
 * Response contracts of /api/v1/integrity. The web app mirrors them in features/integrity/types.ts.
 * Every payload carries the framing notice: indicators are context for a person, never evidence or penalties.
 */

export const INTEGRITY_NOTICE =
  'Indicators are context for a human reviewer, never evidence and never an automatic penalty. Athena uses no camera, microphone or screen capture: only how answers were entered and how the exam tab was used.';

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

export interface WrittenAnswerView {
  answerId: string;
  attemptItemId: string;
  position: number;
  title: string;
  type: QuestionType;
  /** Which text the provenance describes. */
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
  /** "5 shared uncommon wrong answers" / "62% wording overlap on Q4". */
  detail: string;
}

export interface OverviewAttempt {
  candidate: CandidateRef;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  priority: ReviewPriority;
  reasons: Reason[];
  incidents: IncidentCounts;
  focus: FocusSummary;
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
  /** The text as stored now (what the replay should end on). */
  finalText: string;
  /** Replaying every op reproduces the stored text exactly. */
  replayMatchesFinal: boolean;
}

export interface SharedWrongAnswerView {
  questionId: string;
  title: string;
  type: QuestionType;
  /** Position on each candidate's paper (papers are shuffled). */
  positionA: number;
  positionB: number;
  /** The wrong response both gave, as the candidates saw it. */
  response: string;
  /** Respondents to this exact item content and how many gave this response. */
  respondents: number;
  count: number;
  share: number;
  weight: number;
  apartMs: number | null;
  /** The same wrong typed answer on papers with different numbers (parameter variants). */
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

// ---------------------------------------------------------------------------------------------------------
// Leak tracer
// ---------------------------------------------------------------------------------------------------------

export const LEAK_NOTICE =
  'A trace says which paper a text came from, not who shared it. Papers travel: a screenshot can be forwarded, a phone borrowed. Use it to start a conversation through your academic-integrity process, never as a verdict.';

/** exact: a valid invisible mark or typed code. strong: one paper fits two or more details. weak: a few papers fit. */
export type LeakConfidence = 'exact' | 'strong' | 'weak' | 'none';

export interface LeakExactMatch {
  via: ('invisible_mark' | 'typed_code')[];
  code: string;
  candidate: CandidateRef;
  exam: ExamRef;
  /** When the paper was served (attempt start). */
  servedAt: string;
  submittedAt: string | null;
  /** A staff preview paper rather than a candidate's. */
  preview: boolean;
  matchedStems: { position: number; title: string; coverage: number }[];
  /** Whether the numbers and option order in the text agree with this paper; null when there is nothing to check. */
  corroborated: boolean | null;
}

export interface LeakObservationView {
  questionId: string;
  title: string;
  kind: 'numbers' | 'order' | 'drawn';
  detail: string;
  /** For order details: the options as the text lists them, in the paper's wording (Markdown and maths). */
  sequence: string[] | null;
  /** Papers in the exam consistent with this detail. */
  fits: number;
  papers: number;
}

export interface LeakCandidateView {
  candidate: CandidateRef;
  servedAt: string;
  submittedAt: string | null;
  /** Details this paper is consistent with, of all the details that tell papers apart. */
  fits: number;
  of: number;
}

export interface LeakExamFinding {
  exam: ExamRef;
  papers: number;
  questions: { questionId: string; title: string; coverage: number; excerpt: string }[];
  observations: LeakObservationView[];
  /** Papers consistent with every detail. */
  fittingCount: number;
  /** Named only when the text narrows the exam down to a few papers. Unordered: they fit equally. */
  candidates: LeakCandidateView[];
  /** The named papers are the closest partial fits: none fits every detail. */
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
  /** Marks or codes that belong to papers in exams this reviewer can't open. */
  restricted: number;
  /** Codes that match no paper in this organization. */
  unknownCodes: string[];
  findings: LeakExamFinding[];
  searched: { exams: number; papers: number; windowDays: number };
}

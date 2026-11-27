import type { Difficulty, ExamPhase, QuestionType } from '@athena/shared';
import type { Deviation, HistogramBin, Spread } from './fairness.math';

/**
 * Response contracts of the fairness module (mounted at /api/v1/fairness). The web app mirrors these in
 * apps/web/src/features/fairness/types.ts.
 */

export interface FairnessExamRef {
  id: string;
  title: string;
  phase: ExamPhase;
  /** Exam setting: is difficulty balancing switched on for real papers? */
  balanceDifficulty: boolean;
  tolerancePercent: number;
}

export interface SimulatedAssembly {
  /** Spread of expected paper difficulty (expected score, % of total marks). */
  spread: Spread;
  /** Distance from the target, in percentage points. */
  deviation: Deviation;
  /** Share (0..1) of papers within the configured tolerance of the target. */
  withinTolerance: number;
  overlap: {
    /** Mean Jaccard index of two papers' question sets (1 = identical papers). */
    meanJaccard: number;
    minJaccard: number;
    maxJaccard: number;
    /** Approximate share of one paper's questions that another paper also has. */
    sharedShare: number;
    pairs: number;
    sampled: boolean;
  };
}

export interface PoolInfo {
  sectionId: string;
  title: string;
  drawCount: number;
  poolSize: number;
}

export interface ExposureRow {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  sectionId: string;
  sectionTitle: string;
  /** In a pool (drawn for some candidates) or fixed (on every paper). */
  pooled: boolean;
  /** Calibrated probability of a correct answer the engine balances with. */
  expectedP: number;
  /** Share of papers (0..1) that include the question. */
  balancedRate: number;
  randomRate: number;
  /** drawCount / poolSize: the rate every pool question would have under a perfectly even draw. */
  uniformRate: number;
}

export interface FairnessSimulationReport {
  exam: FairnessExamRef;
  generatedAt: string;
  runs: number;
  /** False when every section is fixed: all candidates get the same questions, nothing to balance. */
  hasPools: boolean;
  /** False when the exam has no questions yet. */
  hasQuestions: boolean;
  pools: PoolInfo[];
  questionsPerPaper: number;
  totalMarks: number;
  /** Expected score of a purely random paper (% of total marks): the balancing target. */
  targetPercent: number;
  balanced: SimulatedAssembly;
  random: SimulatedAssembly;
  /** One bin grid for both series, so the histograms overlay exactly. Counts are papers out of `runs`. */
  histogram: { binWidth: number; bins: (Omit<HistogramBin, 'counts'> & { balanced: number; random: number })[] };
  tolerance: {
    configuredPercent: number;
    /** Balanced papers within tolerance at least ACHIEVABLE_SHARE of the time. */
    achievable: boolean;
    /** Smallest tolerance the balancer holds for `holdsForShare` of papers (its p95 deviation). */
    holdsAtPercent: number;
    /** ACHIEVABLE_SHARE (0.95): the share of papers `holdsAtPercent` and `achievable` refer to. */
    holdsForShare: number;
    balancedShare: number;
    randomShare: number;
  };
  exposure: ExposureRow[];
  /** The engine's difficulty model, so the report explains balancing with the values actually in use. */
  calibration: {
    /** Weight of the label prior, in answers: estimateP = (w * prior + n * observed) / (w + n). */
    priorWeight: number;
    labelPriors: Record<Difficulty, number>;
  };
}

export type FairnessAuditState = 'ready' | 'not_completed' | 'no_results';

export interface AuditPaperPoint {
  attemptId: string;
  /** Expected difficulty recorded when the paper was assembled (% of answer marks), if known. */
  predictedPercent: number | null;
  /** How hard the paper turned out: Σ marks × observed p / Σ marks (%). */
  observedPercent: number | null;
}

export interface AuditItem {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  sectionTitle: string;
  marks: number;
  /** Graded answers in this exam. */
  n: number;
  /** Mean score fraction in this exam (0..1). */
  observedP: number | null;
  /** Prior from the author's difficulty label. */
  labelPrior: number;
  /** The engine's current estimate (label prior blended with the bank's calibration). */
  estimateP: number;
  bank: { observedP: number | null; observedN: number };
  /** observedP − estimateP. */
  delta: number | null;
  recalibrate: boolean;
}

export interface FairnessAuditReport {
  exam: FairnessExamRef;
  generatedAt: string;
  state: FairnessAuditState;
  message: string | null;
  submittedAttempts: number;
  gradedAnswers: number;
  papers: {
    count: number;
    /** Distinct question sets among the papers (1 = everyone sat the same questions). */
    distinct: number;
    /** Spread of the expected difficulty stored at assembly (null when no paper recorded it). */
    predicted: Spread | null;
    /** Spread of the difficulty the papers turned out to have, from observed p-values. */
    observed: Spread | null;
    points: AuditPaperPoint[];
  };
  items: AuditItem[];
  thresholds: { delta: number; minN: number };
  candidates: number;
  lastRecalibration: { at: string; by: string | null; questions: number } | null;
}

export interface RecalibrationChange {
  questionId: string;
  title: string;
  previousP: number | null;
  previousN: number;
  p: number;
  n: number;
}

export interface RecalibrationResult {
  examId: string;
  updated: number;
  changes: RecalibrationChange[];
  at: string;
}

import type { Difficulty, ExamPhase, QuestionType } from '@athena/shared';

/** Mirrors apps/api/src/modules/fairness/fairness.types.ts (GET/POST /fairness/exams/:examId/...). */

export interface Spread {
  meanPercent: number;
  sdPercent: number;
  minPercent: number;
  maxPercent: number;
  rangePercent: number;
}

export interface FairnessExamRef {
  id: string;
  title: string;
  phase: ExamPhase;
  balanceDifficulty: boolean;
  tolerancePercent: number;
}

export interface SimulatedAssembly {
  spread: Spread;
  deviation: { maxPercent: number; p95Percent: number };
  withinTolerance: number;
  overlap: { meanJaccard: number; minJaccard: number; maxJaccard: number; sharedShare: number; pairs: number; sampled: boolean };
}

export interface ExposureRow {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  sectionId: string;
  sectionTitle: string;
  pooled: boolean;
  expectedP: number;
  balancedRate: number;
  randomRate: number;
  uniformRate: number;
}

export interface DistributionBin {
  from: number;
  to: number;
  mid: number;
  balanced: number;
  random: number;
}

export interface FairnessSimulationReport {
  exam: FairnessExamRef;
  generatedAt: string;
  runs: number;
  hasPools: boolean;
  hasQuestions: boolean;
  pools: { sectionId: string; title: string; drawCount: number; poolSize: number }[];
  questionsPerPaper: number;
  totalMarks: number;
  targetPercent: number;
  balanced: SimulatedAssembly;
  random: SimulatedAssembly;
  histogram: { binWidth: number; bins: DistributionBin[] };
  /** holdsAtPercent is the band the balancer holds for `holdsForShare` (0.95) of papers. */
  tolerance: { configuredPercent: number; achievable: boolean; holdsAtPercent: number; holdsForShare: number; balancedShare: number; randomShare: number };
  exposure: ExposureRow[];
  /** The engine's difficulty model: estimateP = (priorWeight * labelPrior + n * observed) / (priorWeight + n). */
  calibration: { priorWeight: number; labelPriors: Record<Difficulty, number> };
}

export interface AuditItem {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  sectionTitle: string;
  marks: number;
  n: number;
  observedP: number | null;
  labelPrior: number;
  estimateP: number;
  bank: { observedP: number | null; observedN: number };
  delta: number | null;
  recalibrate: boolean;
}

export interface FairnessAuditReport {
  exam: FairnessExamRef;
  generatedAt: string;
  state: 'ready' | 'not_completed' | 'no_results';
  message: string | null;
  submittedAttempts: number;
  gradedAnswers: number;
  papers: {
    count: number;
    distinct: number;
    predicted: Spread | null;
    observed: Spread | null;
    points: { attemptId: string; predictedPercent: number | null; observedPercent: number | null }[];
  };
  items: AuditItem[];
  thresholds: { delta: number; minN: number };
  candidates: number;
  lastRecalibration: { at: string; by: string | null; questions: number } | null;
}

export interface RecalibrationResult {
  examId: string;
  updated: number;
  changes: { questionId: string; title: string; previousP: number | null; previousN: number; p: number; n: number }[];
  at: string;
}

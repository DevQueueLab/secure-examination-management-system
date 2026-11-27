import type { ExamPhase, QuestionType, ResultsStatus } from '@athena/shared';
import type { HistogramBin } from './components/charts';

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface Insight {
  questionId: string | null;
  label: string | null;
  severity: InsightSeverity;
  kind: string;
  title: string;
  detail: string;
}

export interface DistractorOption {
  id: string;
  letter: string;
  text: string;
  isKey: boolean;
  count: number;
  upper: number;
  lower: number;
  share: number;
  upperShare: number;
  lowerShare: number;
}

export interface DistractorAnalysis {
  n: number;
  upperSize: number;
  lowerSize: number;
  options: DistractorOption[];
  omitted: { count: number; upper: number; lower: number };
}

export interface ItemAnalysis {
  questionId: string;
  label: string;
  number: number;
  title: string;
  type: QuestionType;
  typeLabel: string;
  category: string | null;
  attempts: number;
  answered: number;
  graded: number;
  skipRate: number;
  maxScore: number;
  meanScore: number | null;
  meanPercent: number | null;
  difficulty: number | null;
  discrimination: number | null;
  upperMean: number | null;
  lowerMean: number | null;
  pointBiserial: number | null;
  avgTimeMs: number | null;
  flaggedRate: number;
  dichotomous: boolean;
  distractors: DistractorAnalysis | null;
  insights: Insight[];
}

type Stats = { mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null };

export interface ExamAnalytics {
  exam: { id: string; title: string; code: string | null; phase: ExamPhase; resultsStatus: ResultsStatus; totalMarks: number; passPercent: number | null };
  generatedAt: string;
  summary: {
    n: number;
    complete: number;
    pending: number;
    maxScore: number | null;
    score: Stats;
    percent: Stats;
    passPercent: number | null;
    passed: number;
    passRate: number | null;
    reliability: {
      method: 'KR-20' | 'Cronbach alpha';
      value: number | null;
      items: number;
      n: number;
      band: 'excellent' | 'good' | 'acceptable' | 'questionable' | 'poor' | null;
      note: string | null;
    };
    histogram: HistogramBin[];
  };
  sections: { sectionId: string; title: string; attempts: number; meanPercent: number | null }[];
  topics: { category: string; questions: number; answers: number; meanPercent: number | null }[];
  items: ItemAnalysis[];
  insights: Insight[];
}

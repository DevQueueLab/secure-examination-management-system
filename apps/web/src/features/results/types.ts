import type { AttemptStatus, ExamPhase, QuestionType, ResultsStatus } from '@athena/shared';
import type { HistogramBin } from '../analytics/components/charts';

export type ChecklistLevel = 'ok' | 'info' | 'warning' | 'blocker';

export interface ChecklistItem {
  key: 'ungraded' | 'in_progress' | 'window_open' | 'offline_held' | 'disputes' | 'review_priority' | 'absent' | 'sandbox';
  label: string;
  detail: string;
  count: number;
  level: ChecklistLevel;
}

export interface ResultRow {
  attemptId: string;
  candidate: { id: string; name: string; email: string; rollNumber: string | null; cohort: string | null };
  status: AttemptStatus;
  submitReason: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  pass: boolean | null;
  rank: number | null;
  gradingStatus: string;
  ungradedParts: number;
  reviewPriority: number | null;
}

export interface Distribution {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  passPercent: number | null;
  passed: number;
  passRate: number | null;
  histogram: HistogramBin[];
}

export interface ExamResults {
  exam: {
    id: string;
    title: string;
    code: string | null;
    phase: ExamPhase;
    windowClosesAt: string;
    totalMarks: number;
    passPercent: number | null;
    resultsStatus: ResultsStatus;
    resultsVersion: number;
    resultsPublishedAt: string | null;
    resultsPublishedBy: string | null;
    showCorrectAnswers: boolean;
    showFeedback: boolean;
  };
  rows: ResultRow[];
  distribution: Distribution;
  checklist: ChecklistItem[];
  canPublish: boolean;
}

export interface PublishResult {
  resultsStatus: ResultsStatus;
  resultsVersion: number;
  resultsPublishedAt: string | null;
  notified: number;
  forced: boolean;
}

export interface MyResultSummary {
  attemptId: string;
  exam: { id: string; title: string; code: string | null };
  submittedAt: string | null;
  published: boolean;
  publishedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  pass: boolean | null;
}

export type ItemOutcome = 'correct' | 'partial' | 'incorrect' | 'unanswered' | 'pending' | 'voided';

export interface ResultItem {
  itemId: string;
  number: number;
  sectionId: string | null;
  title: string;
  type: QuestionType;
  typeLabel: string;
  stem: string;
  content: Record<string, unknown>;
  response: { text: string | null; format: 'text' | 'code' | 'choice' | 'list'; language?: string; selected?: string[] };
  answered: boolean;
  score: number | null;
  max: number;
  parts: { answer: { score: number | null; max: number; auto: boolean }; working: { score: number | null; max: number } | null };
  outcome: ItemOutcome;
  voidReason: string | null;
  category: string | null;
  feedback: string | null;
  rubric: { label: string; points: number; target: 'answer' | 'working'; description: string | null }[];
  correctAnswer: string | null;
  explanation: string | null;
}

export interface ResultCard {
  attemptId: string;
  examId: string;
  organization: { id: string; name: string };
  exam: { title: string; code: string | null; passPercent: number | null; resultsVersion: number; publishedAt: string | null };
  candidate: { name: string; rollNumber: string | null; cohort: string | null };
  submittedAt: string | null;
  submitReason: string | null;
  score: number;
  maxScore: number;
  percent: number;
  pass: boolean | null;
  gradingStatus: string;
  cohort: { size: number; percentile: number | null; rank: number | null; meanPercent: number | null };
  sections: { id: string; title: string; score: number; max: number; percent: number }[];
  topics: { category: string; score: number; max: number; percent: number; items: number }[];
  strengths: string[];
  weaknesses: string[];
  items: ResultItem[];
}

export interface Verification {
  code: string;
  url: string;
  issuedAt: string;
  qrDataUrl: string;
}

export type MyResultDetail =
  | {
      attemptId: string;
      exam: { id: string; title: string; code: string | null };
      status: AttemptStatus;
      submittedAt: string | null;
      published: false;
      itemCount: number;
      result: null;
      verification: null;
      disputes: null;
    }
  | {
      attemptId: string;
      exam: { id: string; title: string; code: string | null };
      status: AttemptStatus;
      submittedAt: string | null;
      published: true;
      publishedAt: string | null;
      showCorrectAnswers: boolean;
      result: ResultCard;
      verification: Verification | null;
      disputes: { allowed: boolean; closesAt: string | null };
    };

export interface IssuedReport {
  code: string;
  url: string;
  qrDataUrl: string;
  keyId: string;
  issuedAt: string;
  status: 'valid' | 'superseded' | 'revoked';
}

export interface VerifyResponse {
  code: string;
  valid: boolean;
  status: 'valid' | 'superseded' | 'revoked';
  organization: string;
  exam: string;
  candidate: string;
  score: number;
  maxScore: number;
  percent: number;
  issuedAt: string;
  resultsVersion: number;
  supersededAt: string | null;
  signatureValid: boolean;
  signature: { algorithm: string; keyId: string; value: string; payload: Record<string, unknown> };
}

import type { DisputeCategory, DisputeOutcome, DisputeStatus, LedgerAction, QuestionType, RemedyType } from '@athena/shared';

export type { DisputeCategory, DisputeOutcome, DisputeStatus, RemedyType };
export type Part = 'answer' | 'working';

export interface ExamRef {
  id: string;
  title: string;
  code: string;
}

export interface Step {
  key: 'submitted' | 'review' | 'resolved';
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'upcoming';
}

export interface DisputeCore {
  id: string;
  examId: string;
  attemptId: string;
  attemptItemId: string | null;
  category: DisputeCategory;
  categoryLabel: string;
  status: DisputeStatus;
  statusLabel: string;
  outcome: DisputeOutcome | null;
  outcomeLabel: string | null;
  withdrawn: boolean;
  description: string;
  isAppeal: boolean;
  appealOf: string | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface FormattedResponse {
  text: string | null;
  format: 'text' | 'code' | 'choice' | 'list';
  language?: string;
  selected?: string[];
}

export interface PartScore {
  score: number | null;
  max: number;
  auto?: boolean;
}

export interface Incident {
  type: string;
  severity: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface Connectivity {
  offlineSpells: number;
  offlineSeconds: number;
  timeExtendedSeconds: number;
  deviceSwitches: number;
  submitReason: string | null;
}

/** The record as it stood when the dispute was raised. The candidate's copy hides what they may not see yet. */
export interface Evidence {
  frozenAt: string;
  sealIntact: boolean;
  ledgerHead: { seq: number; hash: string } | null;
  category?: DisputeCategory;
  exam: { title: string; code: string; resultsStatus?: string; resultsVersion?: number };
  attempt: {
    submittedAt: string | null;
    submitReason: string | null;
    score?: number | null;
    maxScore?: number | null;
    startedAt?: string;
    deadlineAt?: string | null;
    timeExtensionSeconds?: number;
  };
  item: {
    id?: string;
    number: number;
    title: string;
    type: QuestionType;
    typeLabel: string;
    stem: string;
    content: Record<string, unknown>;
    marks: number;
    workingMarks: number;
    voidReason: string | null;
  } | null;
  answer: {
    formatted: FormattedResponse;
    working: { text: string | null; scratchPages: number } | null;
    answeredAt: string | null;
    timeSpentMs: number | null;
  } | null;
  score: {
    item: number | null;
    status: string;
    parts: { answer: PartScore; working?: PartScore | null };
  } | null;
  rubric: { id?: string; label: string; points: number; target: Part }[];
  feedback: string | null;
  correctAnswer: string | null;
  incidents: Incident[];
  connectivity: Connectivity | null;
  appealOf: {
    disputeId: string;
    outcome: DisputeOutcome | null;
    note: string | null;
    resolvedAt: string | null;
    scoreBefore: number | null;
    scoreAfter: number | null;
  } | null;
  grading?: { gradedAt: string | null; graders: { id: string; name: string }[] };
}

export interface Message {
  id: string;
  body: string;
  createdAt: string;
  internal: boolean;
  mine: boolean;
  fromCandidate: boolean;
  author: string;
}

export interface Change {
  byRemedy: { id: string; type: RemedyType; label: string; summary: string | null } | null;
  ledger: { seq: number; hash: string; at: string } | null;
  part: Part | null;
  partBefore: number | null;
  partAfter: number | null;
  partMax: number | null;
  itemBefore: number | null;
  itemAfter: number | null;
}

export interface Resolution {
  outcome: DisputeOutcome;
  outcomeLabel: string;
  note: string;
  resolvedAt: string;
  resolverRole?: string | null;
  resolvedBy?: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  maxScore: number | null;
  change: Change | null;
}

export interface CandidateDisputeView {
  role: 'candidate';
  dispute: DisputeCore;
  exam: ExamRef & { published: boolean };
  evidence: Evidence;
  messages: Message[];
  resolution: Resolution | null;
  appeal: { allowed: boolean; closesAt: string | null; message: string | null; appealId: string | null; appealStatus: DisputeStatus | null };
  original: { id: string; outcome: DisputeOutcome | null; outcomeLabel: string | null; note: string | null; resolvedAt: string | null } | null;
  steps: Step[];
  can: { message: boolean; withdraw: boolean; appeal: boolean };
}

export interface RubricRow {
  id: string;
  label: string;
  description: string | null;
  points: number;
  target: Part;
}

export interface LivePart {
  score: number | null;
  max: number;
  auto?: boolean;
  adjustment: number;
  rubricItemIds: string[];
}

export interface StaffDisputeView {
  role: 'staff';
  dispute: DisputeCore;
  exam: ExamRef & { published: boolean };
  candidate: { label: string; anonymous: boolean; attemptId: string };
  question: { questionId: string; label: string; title: string; paperNumber: number } | null;
  evidence: Evidence;
  messages: Message[];
  assignee: { id: string; name: string } | null;
  reviewers: { id: string; name: string; role: string; conflict: string | null }[];
  conflict: { reason: string; graders: string[] } | null;
  original: { id: string; outcome: DisputeOutcome | null; outcomeLabel: string | null; note: string | null; resolvedAt: string | null; resolvedBy: string | null } | null;
  appeal: { id: string; status: DisputeStatus } | null;
  resolution: Resolution | null;
  live: {
    attempt: { score: number | null; maxScore: number | null; gradingStatus: string };
    item: {
      type: QuestionType;
      autoGraded: boolean;
      voided: boolean;
      score: number | null;
      max: number;
      humanParts: Part[];
      parts: { answer: LivePart; working: LivePart | null };
    } | null;
    rubric: RubricRow[];
  };
  signals: { sameQuestionActive: number; sameQuestionTotal: number };
  steps: Step[];
  can: { resolve: boolean; assign: boolean; setStatus: boolean; message: boolean; applyRemedy: boolean };
}

export type DisputeView = CandidateDisputeView | StaffDisputeView;

export interface MyDisputeRow {
  id: string;
  exam: ExamRef;
  attemptId: string;
  item: { number: number; title: string } | null;
  category: DisputeCategory;
  categoryLabel: string;
  status: DisputeStatus;
  statusLabel: string;
  outcome: DisputeOutcome | null;
  outcomeLabel: string | null;
  withdrawn: boolean;
  isAppeal: boolean;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  maxScore: number | null;
  excerpt: string;
}

export interface EligibleAttempt {
  attemptId: string;
  exam: ExamRef;
  submittedAt: string | null;
  published: boolean;
  canRaise: boolean;
  closesAt: string | null;
  message: string | null;
}

export interface MyDisputes {
  items: MyDisputeRow[];
  attempts: EligibleAttempt[];
}

export interface CategoryWindow {
  allowed: boolean;
  closesAt: string | null;
  message: string | null;
}

export interface RaiseItem {
  id: string;
  number: number;
  title: string;
  type: QuestionType;
  typeLabel: string;
  stem: string;
  max: number;
  score: number | null;
  voided: boolean;
  voidReason: string | null;
  openDispute: { id: string; status: DisputeStatus } | null;
}

export interface RaiseContext {
  attempt: { id: string; status: string; submittedAt: string | null; score: number | null; maxScore: number | null };
  exam: ExamRef & { published: boolean; allowDisputes: boolean; windowDays: number };
  windows: Record<DisputeCategory, CategoryWindow>;
  limits: { used: number; max: number };
  attemptLevelOpen: { id: string; status: DisputeStatus } | null;
  items: RaiseItem[];
}

export interface InboxRow {
  id: string;
  exam: ExamRef;
  candidate: { label: string; anonymous: boolean };
  question: { questionId: string; label: string; title: string } | null;
  category: DisputeCategory;
  categoryLabel: string;
  status: DisputeStatus;
  statusLabel: string;
  outcome: DisputeOutcome | null;
  outcomeLabel: string | null;
  isAppeal: boolean;
  assignee: { id: string; name: string; isMe: boolean } | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  resolvedAt: string | null;
  conflict: boolean;
  excerpt: string;
}

export interface Inbox {
  items: InboxRow[];
  exams: (ExamRef & { total: number })[];
  counts: { active: number; overdue: number; mine: number; unassigned: number };
}

export interface InboxFilters {
  examId?: string;
  status?: DisputeStatus | 'active' | 'all';
  category?: DisputeCategory;
  assignedToMe?: boolean;
  overdue?: boolean;
}

export interface RemedyQuestion {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  typeLabel: string;
  marks: number;
  workingMarks: number;
  stem: string;
  unit: string | null;
  variables: { name: string; min: number; max: number }[];
  blanks: { id: string; label?: string }[];
  key: { text: string | null; formula: string | null; tolerance: { type: string; value: number } | null; correctIds: string[] };
  choices: { id: string; text: string; correct: boolean; count: number }[] | null;
  sat: number;
  submitted: number;
  running: number;
  dropped: boolean;
  avgScore: number | null;
  fullMarks: number;
  disputes: { active: number; total: number };
  supportsAlternatives: boolean;
}

export interface AppliedRemedy {
  id: string;
  questionId: string;
  question: { label: string; title: string } | null;
  type: RemedyType;
  typeLabel: string;
  summary: string;
  payload: Record<string, unknown>;
  reason: string;
  affectedAttempts: number;
  changed: number;
  createdBy: string;
  createdAt: string;
}

export interface RemediesOverview {
  exam: ExamRef & { resultsStatus: string };
  canApply: boolean;
  questions: RemedyQuestion[];
  remedies: AppliedRemedy[];
}

export interface RemedyInput {
  questionId: string;
  type: RemedyType;
  payload: Record<string, unknown>;
  reason: string;
  disputeId?: string | null;
  dryRun: boolean;
}

export interface CandidateImpact {
  attemptId: string;
  candidate: string;
  itemBefore: number | null;
  itemAfter: number | null;
  itemMax: number;
  scoreBefore: number;
  scoreAfter: number;
  maxBefore: number;
  maxAfter: number;
  percentBefore: number | null;
  percentAfter: number | null;
  delta: number;
}

export interface RemedyReport {
  dryRun: boolean;
  remedy: { id: string; createdAt: string } | null;
  supersededReports?: number;
  question: { questionId: string; label: string; title: string; type: QuestionType; typeLabel: string };
  type: RemedyType;
  typeLabel: string;
  summary: string;
  affectedAttempts: number;
  gains: { count: number; avg: number; max: number };
  rawLosses: { count: number; max: number };
  unchanged: number;
  percentUp: number;
  percentDown: number;
  percentChangeNote: string | null;
  maxBefore: number | null;
  maxAfter: number | null;
  distribution: { delta: number; count: number }[];
  perCandidate: CandidateImpact[];
  resolvesDisputes: number;
  /** Open disputes left for another reviewer, because the person applying may not decide them. */
  withheldDisputes: number;
  blocked: { code: string; message: string } | null;
}

export interface LedgerRow {
  seq: number;
  at: string;
  action: LedgerAction;
  label: string;
  candidate: string | null;
  question: string | null;
  part: string | null;
  previous: number | null;
  next: number | null;
  reason: string | null;
  actor: string;
  hash: string | null;
  prevHash: string | null;
}

export interface LedgerCheck {
  intact: boolean;
  checked: number;
  brokenAtSeq: number | null;
  verifiedAt: string;
}

export interface ExamDisputeSummary {
  exam: ExamRef & { resultsStatus: string };
  canApplyRemedies: boolean;
  counts: {
    total: number;
    active: number;
    overdue: number;
    appeals: number;
    byStatus: Record<DisputeStatus, number>;
    byCategory: Record<DisputeCategory, number>;
    outcomes: Record<DisputeOutcome, number>;
  };
  timeliness: { avgResolutionHours: number | null; onTimePercent: number | null };
  remedies: { count: number; affectedAttempts: number };
  /** Questions with the most disputes; `questionProblem` counts those saying the question itself was at fault. */
  hotQuestions: { questionId: string; label: string; title: string; total: number; active: number; questionProblem: number }[];
  ledger: LedgerCheck & { examEntries: number; head: { seq: number; hash: string | null; at: string } | null };
  recentLedger: LedgerRow[];
}

export interface HistoryEntry {
  seq: number;
  at: string;
  action: LedgerAction;
  label: string;
  item: { number: number; title: string } | null;
  part: Part | null;
  partMax: number | null;
  previous: number | null;
  next: number | null;
  delta: number | null;
  voided: boolean;
  outcome: DisputeOutcome | null;
  disputeId: string | null;
  attemptScoreAfter: number | null;
  reason: string | null;
  actor: string;
  scope: 'question' | 'paper' | 'exam';
  hash: string | null;
  prevHash: string | null;
}

export interface ScoreHistoryData {
  exam: ExamRef;
  published: boolean;
  attempt: { id: string; submittedAt: string | null; score: number | null; maxScore: number | null; percent: number | null; gradingStatus: string };
  entries: HistoryEntry[];
  verification: (LedgerCheck & { attemptEntries: number; head: string | null }) | null;
  message: string | null;
}

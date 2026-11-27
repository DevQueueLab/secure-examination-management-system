import type {
  AttemptStatus,
  Difficulty,
  ExamPhase,
  ExamSettings,
  ExamStaffRole,
  ExamStatus,
  GradingStatus,
  Paginated,
  QuestionType,
  ResultsStatus,
} from '@athena/shared';

/** Response shapes of the authoring API (apps/api/src/modules/questions and modules/exams). Dates are ISO strings. */

// ---------- question bank ----------

export interface CategoryRef {
  id: string;
  name: string;
  color: string | null;
}

export interface Category extends CategoryRef {
  description: string | null;
  questionCount: number;
  createdAt: string;
}

export type QuestionStatus = 'active' | 'archived';

export interface QuestionListItem {
  id: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  status: QuestionStatus;
  tags: string[];
  defaultMarks: number;
  currentVersion: number;
  /** Observed share of marks earned by real candidates (0..1), null before any data. */
  observedP: number | null;
  observedN: number;
  /** Times delivered to real candidates. */
  exposureCount: number;
  leakedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: CategoryRef | null;
  /** First 240 characters of the current version's stem (markdown). */
  stem: string;
  hasWorking: boolean;
  /** Distinct exams using the question. */
  usageCount: number;
}

export interface QuestionFilters {
  q?: string;
  type?: QuestionType;
  difficulty?: Difficulty;
  categoryId?: string;
  status?: QuestionStatus | 'all';
  tag?: string;
  sort?: 'updated' | 'title' | 'usage' | 'difficulty';
  page?: number;
  pageSize?: number;
  /** Hide questions already in this exam. */
  excludeExamId?: string;
}

export type QuestionPage = Paginated<QuestionListItem>;

export interface QuestionUsageExam {
  examId: string;
  title: string;
  code: string | null;
  status: ExamStatus;
  phase: ExamPhase;
  pinnedVersion: number;
  marks: number;
  windowOpensAt: string;
}

export interface QuestionDetail {
  id: string;
  type: QuestionType;
  title: string;
  difficulty: Difficulty;
  status: QuestionStatus;
  tags: string[];
  defaultMarks: number;
  currentVersion: number;
  observedP: number | null;
  observedN: number;
  exposureCount: number;
  leakedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string | null } | null;
  category: CategoryRef | null;
  versionId: string;
  versionCreatedAt: string;
  content: Record<string, unknown>;
  key: Record<string, unknown>;
  usage: { total: number; hidden: number; exams: QuestionUsageExam[] };
}

export interface QuestionSaveResult extends QuestionDetail {
  /** False when only metadata changed (no new version). */
  versionCreated: boolean;
  version: number;
}

/** Body of POST /questions and PUT /questions/:id. */
export interface QuestionInput {
  type: QuestionType;
  title: string;
  difficulty: Difficulty;
  categoryId: string | null;
  tags: string[];
  defaultMarks: number;
  content: Record<string, unknown>;
  key: Record<string, unknown>;
  /** PUT only: the version the edit started from (optimistic concurrency). */
  baseVersion?: number;
}

export interface QuestionVersion {
  id: string;
  version: number;
  content: Record<string, unknown>;
  key: Record<string, unknown>;
  createdAt: string;
  createdBy: { id: string; name: string | null } | null;
  /** Exam questions pinned to this exact version. */
  pinnedBy: number;
  isCurrent: boolean;
}

export interface QuestionVersions {
  currentVersion: number;
  items: QuestionVersion[];
}

/** POST /questions/preview: one candidate variant, built with the engine's own handler. */
export interface QuestionPreview {
  seed: string;
  /** Exactly what a candidate receives (options shuffled, variables substituted, no explanation). */
  candidateView: Record<string, unknown>;
  variant: Record<string, unknown>;
  /** Numeric questions: the answer for this variant (authors only). */
  expectedAnswer?: number;
}

export interface ImportRowError {
  /** CSV: line in the file (header is line 1). JSON: 1-based item number. */
  row: number;
  /** CSV column name (type, options, correct...) or JSON path. */
  field: string;
  message: string;
}

export interface QuestionImportResult {
  format: 'csv' | 'json';
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  errors: ImportRowError[];
  newCategories: string[];
  preview: {
    row: number;
    type: QuestionType;
    title: string;
    category: string | null;
    categoryIsNew: boolean;
    difficulty: Difficulty;
    marks: number;
    tags: string[];
    stem: string;
  }[];
  imported: number;
  jobId: string | null;
}

// ---------- exams ----------

export type NextActionKey = 'add_questions' | 'fix_issues' | 'review_publish' | 'enroll' | 'preview' | 'monitor' | 'grade' | 'publish_results' | 'analytics';

export interface NextAction {
  key: NextActionKey;
  label: string;
}

export interface ExamCounts {
  questions: number;
  sections: number;
  enrolled: number;
  inProgress: number;
  submitted: number;
  pendingGrading: number;
}

export interface ExamListItem {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  status: ExamStatus;
  phase: ExamPhase;
  resultsStatus: ResultsStatus;
  windowOpensAt: string;
  windowClosesAt: string;
  durationMinutes: number;
  totalMarks: number;
  computedTotal: number;
  publishedAt: string | null;
  updatedAt: string;
  myRole: ExamStaffRole | null;
  counts: ExamCounts;
  nextAction: NextAction | null;
}

export interface ExamListResponse extends Paginated<ExamListItem> {
  phaseCounts: Record<ExamPhase | 'all', number>;
}

export interface ExamFilters {
  q?: string;
  phase?: ExamPhase;
  page?: number;
  pageSize?: number;
}

export type ReviewFix =
  | { kind: 'set_total'; value: number }
  | { kind: 'set_pool_marks'; sectionId: string; value: number }
  | { kind: 'set_draw'; sectionId: string; value: number };

export interface ReviewIssue {
  code: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
  sectionId?: string;
  examQuestionId?: string;
  fix?: ReviewFix;
}

export interface ChecklistItem {
  key: 'questions' | 'marks' | 'pools' | 'schedule' | 'rubrics' | 'candidates' | 'opening';
  label: string;
  status: 'ok' | 'error' | 'warning';
  detail: string;
}

export interface PaperSection {
  id: string;
  title: string;
  isPool: boolean;
  poolSize: number;
  drawCount: number | null;
  delivered: number;
  total: number;
  workingMarks: number;
}

export interface PaperSummary {
  computedTotal: number;
  declaredTotal: number;
  workingMarks: number;
  questionCount: number;
  deliveredCount: number;
  sections: PaperSection[];
}

export interface ExamReview {
  canPublish: boolean;
  errors: ReviewIssue[];
  warnings: ReviewIssue[];
  checklist: ChecklistItem[];
  paper: PaperSummary;
}

export interface ExamQuestionRow {
  /** exam_questions id (use for PATCH/DELETE /exams/:id/questions/:examQuestionId). */
  id: string;
  questionId: string;
  questionVersionId: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  marks: number;
  workingMarks: number;
  position: number;
  pinnedVersion: number;
  latestVersion: number;
  bankStatus: QuestionStatus;
  leaked: boolean;
  observedP: number | null;
  stem: string;
  rubricCount: number;
  rubric: { answer: number; working: number };
}

export interface ExamSectionView {
  id: string;
  title: string;
  instructions: string | null;
  position: number;
  drawCount: number | null;
  paper: PaperSection | null;
  questions: ExamQuestionRow[];
}

export interface StaffMember {
  userId: string;
  role: ExamStaffRole;
  addedAt: string;
  name: string;
  email: string;
}

export interface ExamDetail {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  instructions: string;
  status: ExamStatus;
  phase: ExamPhase;
  resultsStatus: ResultsStatus;
  windowOpensAt: string;
  windowClosesAt: string;
  durationMinutes: number;
  totalMarks: number;
  settings: ExamSettings;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  myRole: ExamStaffRole | null;
  can: { edit: boolean; publish: boolean; manageCandidates: boolean; manageStaff: boolean; duplicate: boolean; archive: boolean };
  sections: ExamSectionView[];
  staff: StaffMember[];
  counts: {
    questions: number;
    sections: number;
    enrolled: number;
    attempts: { total: number; inProgress: number; awaitingSync: number; submitted: number };
    pendingGrading: number;
  };
  review: ExamReview;
  locks: {
    /** A real candidate has started: structure, timing and paper-shaping settings are frozen. */
    locked: boolean;
    realAttempts: number;
    reason: string | null;
    /** e.g. 'windowOpensAt', 'durationMinutes', 'totalMarks', 'structure', 'settings.navigation'. */
    fields: string[];
    windowClosesAt: 'free' | 'extend_only';
  };
  nextAction: NextAction | null;
}

/** Body of POST /exams and PATCH /exams/:id. Datetimes are ISO strings in UTC. */
export interface ExamInput {
  title: string;
  code?: string | null;
  description?: string | null;
  instructions?: string;
  windowOpensAt: string;
  windowClosesAt: string;
  durationMinutes: number;
  totalMarks: number;
  /** Partial settings deep-merge onto the defaults / stored settings. */
  settings?: DeepPartial<ExamSettings>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export interface EnrollmentRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  rollNumber: string | null;
  cohort: string | null;
  timeMultiplier: number;
  extraMinutes: number;
  accommodationNote: string | null;
  enrolledAt: string;
  hasAccommodation: boolean;
  attempt: {
    id: string;
    status: AttemptStatus;
    startedAt: string | null;
    submittedAt: string | null;
    score: number | null;
    maxScore: number | null;
    gradingStatus: GradingStatus | null;
  } | null;
}

export interface EnrollmentList {
  items: EnrollmentRow[];
  cohorts: string[];
  total: number;
  /** Matching candidates with extra time or a note, across every page. */
  accommodations: number;
  page: number;
  pageSize: number;
}

export interface EligibleCandidates {
  items: { userId: string; name: string; email: string; rollNumber: string | null; cohort: string | null }[];
  cohorts: { cohort: string; members: number; available: number }[];
}

export interface EligibleStaff {
  userId: string;
  name: string;
  email: string;
  roleName: string;
  allowedRoles: Exclude<ExamStaffRole, 'owner'>[];
}

export interface CandidateImportResult {
  format: 'csv' | 'json';
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  errors: ImportRowError[];
  counts: { newAccounts: number; newMembers: number; existingMembers: number; alreadyEnrolled: number };
  preview: {
    row: number;
    name: string;
    email: string;
    rollNumber: string | null;
    cohort: string | null;
    timeMultiplier: number;
    status: 'new_account' | 'new_member' | 'existing_member';
    alreadyEnrolled: boolean;
  }[];
  enrolled: number;
  /** Returned once, on commit, for accounts the import created. */
  credentials: { name: string; email: string; temporaryPassword: string }[];
  jobId: string | null;
}

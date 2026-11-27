/**
 * Domain vocabularies shared by the API (database enums, validation) and the web app (UI labels).
 * Arrays are `as const` so they can feed both pgEnum() and z.enum().
 */

export const ORGANIZATION_TYPES = ['institution', 'competition'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = ['active', 'suspended'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** System role keys seeded for every tenant. Custom roles get generated keys. */
export const SYSTEM_ROLE_KEYS = ['org_admin', 'examiner', 'grader', 'proctor', 'candidate'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Prior probability of a correct answer per difficulty label (fairness engine starting point). */
export const DIFFICULTY_PRIOR: Record<Difficulty, number> = { easy: 0.8, medium: 0.6, hard: 0.4 };

export const QUESTION_STATUSES = ['active', 'archived'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** Stored exam status. The status a user sees is derived from it and server time (see examPhase). */
export const EXAM_STATUSES = ['draft', 'published', 'archived'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

/** Lifecycle phase shown everywhere: derived, never stored. */
export const EXAM_PHASES = ['draft', 'scheduled', 'ongoing', 'completed', 'archived'] as const;
export type ExamPhase = (typeof EXAM_PHASES)[number];

export const RESULTS_STATUSES = ['unpublished', 'published'] as const;
export type ResultsStatus = (typeof RESULTS_STATUSES)[number];

export const EXAM_STAFF_ROLES = ['owner', 'co_examiner', 'grader', 'proctor'] as const;
export type ExamStaffRole = (typeof EXAM_STAFF_ROLES)[number];

export const ENROLLMENT_STATUSES = ['enrolled', 'removed'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/**
 * in_progress   – candidate is answering; writes accepted until the server deadline.
 * awaiting_sync – deadline passed while the candidate was offline; only the sealed offline journal is accepted,
 *                 and it is held for examiner review instead of counting automatically.
 * submitted     – final. Grading may still be pending for manually graded items.
 */
export const ATTEMPT_STATUSES = ['in_progress', 'awaiting_sync', 'submitted'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const SUBMIT_REASONS = ['candidate', 'timeout', 'proctor', 'offline_sync'] as const;
export type SubmitReason = (typeof SUBMIT_REASONS)[number];

export const GRADING_STATUSES = ['pending', 'partial', 'complete'] as const;
export type GradingStatus = (typeof GRADING_STATUSES)[number];

/** Per-answer grading state. */
export const SCORE_STATUSES = ['ungraded', 'auto', 'manual'] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

export const EVENT_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

/** Attempt timeline events: lifecycle, connectivity and integrity indicators (never verdicts). */
export const ATTEMPT_EVENT_TYPES = [
  'started',
  'resumed',
  'device_switched',
  'submitted',
  'auto_submitted',
  'force_submitted',
  'time_extended',
  'outage_compensated',
  'went_offline',
  'came_online',
  'offline_journal_received',
  'focus_lost',
  'focus_returned',
  'fullscreen_exited',
  'fullscreen_entered',
  'copy_attempt',
  'paste',
  'context_menu',
  'multiple_displays',
  'print_attempt',
  'announcement_read',
  'clarification_asked',
] as const;
export type AttemptEventType = (typeof ATTEMPT_EVENT_TYPES)[number];

export const INCIDENT_REVIEW_STATUSES = ['open', 'no_concern', 'follow_up', 'escalated'] as const;
export type IncidentReviewStatus = (typeof INCIDENT_REVIEW_STATUSES)[number];

export const DISPUTE_CATEGORIES = ['grading_error', 'ambiguous_question', 'technical_incident', 'other'] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_STATUSES = ['open', 'under_review', 'needs_info', 'resolved', 'appealed', 'closed'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_OUTCOMES = ['upheld', 'partially_upheld', 'rejected'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/** Question-level remedies applied to every candidate at once (fairness for ambiguous questions). */
export const REMEDY_TYPES = ['accept_alternatives', 'full_marks_all', 'drop_question'] as const;
export type RemedyType = (typeof REMEDY_TYPES)[number];

export const LEDGER_ACTIONS = [
  'auto_grade',
  'manual_grade',
  'rubric_change',
  'remedy',
  'dispute_resolution',
  'offline_answers_accepted',
  'results_published',
  'results_unpublished',
] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

export const REPORT_STATUSES = ['valid', 'superseded', 'revoked'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const IMPORT_KINDS = ['candidates', 'questions'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

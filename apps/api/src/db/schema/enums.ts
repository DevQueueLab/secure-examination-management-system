import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ATTEMPT_STATUSES,
  DIFFICULTIES,
  DISPUTE_CATEGORIES,
  DISPUTE_OUTCOMES,
  DISPUTE_STATUSES,
  ENROLLMENT_STATUSES,
  EVENT_SEVERITIES,
  EXAM_STAFF_ROLES,
  EXAM_STATUSES,
  GRADING_STATUSES,
  IMPORT_KINDS,
  INCIDENT_REVIEW_STATUSES,
  LEDGER_ACTIONS,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  REMEDY_TYPES,
  REPORT_STATUSES,
  RESULTS_STATUSES,
  SCORE_STATUSES,
  SUBMIT_REASONS,
  USER_STATUSES,
} from '@athena/shared';

export const organizationType = pgEnum('organization_type', ORGANIZATION_TYPES);
export const organizationStatus = pgEnum('organization_status', ORGANIZATION_STATUSES);
export const userStatus = pgEnum('user_status', USER_STATUSES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const questionType = pgEnum('question_type', QUESTION_TYPES);
export const difficulty = pgEnum('difficulty', DIFFICULTIES);
export const questionStatus = pgEnum('question_status', QUESTION_STATUSES);
export const examStatus = pgEnum('exam_status', EXAM_STATUSES);
export const resultsStatus = pgEnum('results_status', RESULTS_STATUSES);
export const examStaffRole = pgEnum('exam_staff_role', EXAM_STAFF_ROLES);
export const enrollmentStatus = pgEnum('enrollment_status', ENROLLMENT_STATUSES);
export const attemptStatus = pgEnum('attempt_status', ATTEMPT_STATUSES);
export const submitReason = pgEnum('submit_reason', SUBMIT_REASONS);
export const gradingStatus = pgEnum('grading_status', GRADING_STATUSES);
export const scoreStatus = pgEnum('score_status', SCORE_STATUSES);
export const eventSeverity = pgEnum('event_severity', EVENT_SEVERITIES);
export const incidentReviewStatus = pgEnum('incident_review_status', INCIDENT_REVIEW_STATUSES);
export const disputeCategory = pgEnum('dispute_category', DISPUTE_CATEGORIES);
export const disputeStatus = pgEnum('dispute_status', DISPUTE_STATUSES);
export const disputeOutcome = pgEnum('dispute_outcome', DISPUTE_OUTCOMES);
export const remedyType = pgEnum('remedy_type', REMEDY_TYPES);
export const ledgerAction = pgEnum('ledger_action', LEDGER_ACTIONS);
export const reportStatus = pgEnum('report_status', REPORT_STATUSES);
export const importKind = pgEnum('import_kind', IMPORT_KINDS);

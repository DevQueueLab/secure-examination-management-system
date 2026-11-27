import type { ExamStaffRole, Permission } from '@athena/shared';

/** Exam staff roles that may change an exam (org admins with exams.view_all always may). */
export const EDITOR_ROLES: readonly ExamStaffRole[] = ['owner', 'co_examiner'];

/** Any of these lets a caller read exams they are staff on (graders and proctors hold no exams.* permission). */
export const EXAM_READ_PERMISSIONS: Permission[] = ['exams.view_all', 'exams.manage', 'exams.create', 'grading.grade', 'monitor.view', 'analytics.view'];

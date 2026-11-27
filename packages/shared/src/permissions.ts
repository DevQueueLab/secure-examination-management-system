import type { SystemRoleKey } from './enums';

/**
 * Permission keys enforced by the API (requirePermission middleware).
 * The UI reads the same keys only to decide what to show; it is never the gatekeeper.
 */
export const PERMISSIONS = {
  'org.settings': 'Manage organization settings and branding',
  'users.view': 'View people in the organization',
  'users.manage': 'Create, edit, deactivate users and assign roles',
  'roles.manage': 'Create roles and edit their permissions',
  'audit.view': 'View the audit log',
  'questions.view': 'View the question bank',
  'questions.manage': 'Create, edit, import and archive questions',
  'exams.view_all': 'See every exam in the organization (not only assigned ones)',
  'exams.create': 'Create examinations',
  'exams.manage': 'Configure examinations they are staff on',
  'exams.publish': 'Publish and unpublish examinations',
  'candidates.manage': 'Enroll and import candidates',
  'monitor.view': 'Watch live attempts and incidents',
  'monitor.intervene': 'Announce, answer clarifications, extend time, force submit',
  'grading.grade': 'Grade written responses and apply rubrics',
  'results.publish': 'Review and publish results',
  'analytics.view': 'View examination and question analytics',
  'reports.generate': 'Generate PDF reports',
  'integrity.review': 'Review integrity indicators, provenance and leak traces',
  'disputes.resolve': 'Review and resolve candidate disputes',
  'exams.take': 'Take assigned examinations',
  'results.view_own': 'View own published results',
  'disputes.raise': 'Raise disputes on own results',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Groups for the role editor UI. */
export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  { label: 'Organization', keys: ['org.settings', 'users.view', 'users.manage', 'roles.manage', 'audit.view'] },
  { label: 'Authoring', keys: ['questions.view', 'questions.manage', 'exams.view_all', 'exams.create', 'exams.manage', 'exams.publish', 'candidates.manage'] },
  { label: 'Delivery', keys: ['monitor.view', 'monitor.intervene'] },
  { label: 'Evaluation', keys: ['grading.grade', 'results.publish', 'analytics.view', 'reports.generate', 'integrity.review', 'disputes.resolve'] },
  { label: 'Candidate', keys: ['exams.take', 'results.view_own', 'disputes.raise'] },
];

const STAFF: Permission[] = [
  'users.view',
  'questions.view',
  'questions.manage',
  'exams.create',
  'exams.manage',
  'exams.publish',
  'candidates.manage',
  'monitor.view',
  'monitor.intervene',
  'grading.grade',
  'results.publish',
  'analytics.view',
  'reports.generate',
  'integrity.review',
  'disputes.resolve',
];

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string; permissions: Permission[] }> = {
  org_admin: {
    name: 'Organization Admin',
    description: 'Manages people, roles, permissions and every examination in the organization.',
    permissions: PERMISSION_KEYS.filter((p) => !['exams.take', 'results.view_own', 'disputes.raise'].includes(p)),
  },
  examiner: {
    name: 'Examiner',
    description: 'Creates examinations and questions, enrolls candidates, monitors, grades and publishes results.',
    permissions: STAFF,
  },
  grader: {
    name: 'Grader',
    description: 'Teaching assistant: grades written responses and handles disputes on assigned exams.',
    permissions: ['questions.view', 'grading.grade', 'analytics.view', 'disputes.resolve'],
  },
  proctor: {
    name: 'Proctor',
    description: 'Invigilates assigned exams: live monitoring, announcements, clarifications, incidents.',
    permissions: ['monitor.view', 'monitor.intervene', 'integrity.review'],
  },
  candidate: {
    name: 'Candidate',
    description: 'Takes assigned examinations and views own published results.',
    permissions: ['exams.take', 'results.view_own', 'disputes.raise'],
  },
};

export function hasPermission(granted: readonly string[] | undefined, needed: Permission): boolean {
  return !!granted && granted.includes(needed);
}

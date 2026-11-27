import type { EventSeverity, ExamStaffRole, OrganizationType } from '@athena/shared';

/** GET /org/dashboard (apps/api/src/modules/org/dashboard.service.ts). Sections the caller can't use are null. */
export interface StaffDashboard {
  generatedAt: string;
  user: { name: string; role: string; roleKey: string };
  organization: {
    name: string;
    type: OrganizationType;
    accentColor: string | null;
    tagline: string | null;
  };
  live: {
    id: string;
    title: string;
    code: string | null;
    opensAt: string;
    closesAt: string;
    durationMinutes: number;
    staffRole: ExamStaffRole | null;
    enrolled: number;
    inProgress: number;
    awaitingSync: number;
    submitted: number;
  }[];
  grading: {
    pendingItems: number;
    exams: {
      id: string;
      title: string;
      code: string | null;
      pendingItems: number;
      pendingAttempts: number;
    }[];
  } | null;
  upcoming: {
    id: string;
    title: string;
    code: string | null;
    opensAt: string;
    closesAt: string;
    durationMinutes: number;
    staffRole: ExamStaffRole | null;
    enrolled: number;
  }[];
  incidents: {
    last24h: number;
    unreviewed: number;
    items: {
      id: string;
      type: string;
      severity: EventSeverity;
      examId: string;
      attemptId: string;
      reviewStatus: string | null;
      createdAt: string;
      candidateName: string;
      examTitle: string;
    }[];
  } | null;
  disputes: { open: number; overdue: number } | null;
  questionBank: { active: number } | null;
  drafts: number;
  checklist: {
    scope: 'organization' | 'mine';
    people: boolean | null;
    questions: boolean;
    exam: boolean;
    candidates: boolean;
    published: boolean;
  } | null;
}

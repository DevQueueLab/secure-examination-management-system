import type {
  ExamPhase,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
  Permission,
} from '@athena/shared';

/** Response shapes of the platform and org administration endpoints (apps/api/src/modules/{platform,org}). */

export interface PersonRole {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
}

export interface Person {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: MembershipStatus;
  accountStatus: 'active' | 'disabled';
  externalId: string | null;
  cohort: string | null;
  lastLoginAt: string | null;
  joinedAt: string;
  mustChangePassword: boolean;
  role: PersonRole;
}

export interface PeopleFacets {
  roles: { id: string; key: string; name: string; isSystem: boolean; count: number }[];
  cohorts: { cohort: string; count: number }[];
  statuses: Record<MembershipStatus, number>;
}

export interface PeoplePage {
  items: Person[];
  total: number;
  page: number;
  pageSize: number;
  facets: PeopleFacets;
}

export interface PeopleFilters {
  q?: string;
  role?: string;
  status?: MembershipStatus;
  cohort?: string;
  page: number;
  pageSize: number;
  sort?: 'name' | 'recent' | 'last_login';
}

export interface CreatePersonResult {
  person: Person;
  temporaryPassword: string | null;
  existingAccount: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  locked: boolean;
  memberCount: number;
  activeMemberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditActor {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actor: AuditActor | null;
  organization?: { id: string; name: string } | null;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    actors?: { id: string; name: string; entries: number }[];
    actions: { group: string; entries: number }[];
  };
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
}

export type RowAction = 'create' | 'link' | 'update' | 'skip';

export interface ImportRow {
  row: number;
  name: string;
  email: string;
  role: { key: string; name: string } | null;
  externalId: string | null;
  cohort: string | null;
  action: RowAction | null;
  errors: {
    field: 'name' | 'email' | 'role' | 'roll_number' | 'cohort' | 'row';
    message: string;
  }[];
  warnings: string[];
}

export interface ImportReport {
  dryRun: boolean;
  committed: boolean;
  jobId: string | null;
  filename: string | null;
  ignoredColumns: string[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
    create: number;
    link: number;
    update: number;
    skip: number;
  };
  rows: ImportRow[];
  credentials: Credential[];
}

export interface Credential {
  row?: number;
  name: string;
  email: string;
  temporaryPassword: string;
}

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  status: OrganizationStatus;
  contactEmail: string | null;
  branding: { accentColor: string | null; tagline: string | null };
  createdAt: string;
}

export interface PlatformOverview {
  generatedAt: string;
  tenants: {
    total: number;
    byType: Record<OrganizationType, number>;
    byStatus: Record<OrganizationStatus, number>;
  };
  users: { total: number; signedInLast7Days: number; activeSessions: number };
  exams: { total: number; byPhase: Record<ExamPhase, number> };
  attempts: {
    today: number;
    inProgressNow: number;
    last14Days: { day: string; attempts: number }[];
  };
  lastOutage: {
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    compensatedAttempts: number;
  } | null;
  outagesLast30Days: number;
  /** Seconds of recorded outage in the last 30 days (added with the health panel; older APIs omit it). */
  outageSecondsLast30Days?: number;
  database: {
    status: 'ok' | 'down';
    latencyMs: number | null;
    sizeBytes: number | null;
    connections: number | null;
    version: string | null;
  };
  api: { status: 'ok'; uptimeSeconds: number; startedAt: string; node: string; memoryMb: number };
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  status: OrganizationStatus;
  contactEmail: string | null;
  branding: { accentColor?: string; tagline?: string };
  createdAt: string;
  members: number;
  candidates: number;
  exams: number;
  liveExams: number;
  lastActivityAt: string | null;
}

export interface TenantPage {
  items: TenantSummary[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    all: number;
    institution: number;
    competition: number;
    active: number;
    suspended: number;
  };
}

export interface TenantDetail extends TenantSummary {
  createdBy: string | null;
  suspension: { at: string; by: string | null; reason: string } | null;
  admins: {
    membershipId: string;
    userId: string;
    name: string;
    email: string;
    status: MembershipStatus;
    lastLoginAt: string | null;
  }[];
  counts: {
    members: number;
    activeMembers: number;
    suspendedMembers: number;
    byRole: { key: string; name: string; isSystem: boolean; members: number }[];
    exams: { total: number; byPhase: Record<ExamPhase, number> };
    questions: number;
    attempts: { total: number; lastWeek: number; inProgressNow: number };
  };
  activity: {
    id: string;
    action: string;
    summary: string | null;
    createdAt: string;
    actorName: string | null;
    metadata: Record<string, unknown>;
  }[];
}

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: string;
  suggestion?: string;
}

export interface OnboardInput {
  name: string;
  slug: string;
  type: OrganizationType;
  contactEmail: string;
  adminName: string;
  adminEmail: string;
}

export interface OnboardResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: OrganizationType;
    status: OrganizationStatus;
    contactEmail: string | null;
  };
  admin: { userId: string; name: string; email: string; existingAccount: boolean };
  temporaryPassword: string | null;
}

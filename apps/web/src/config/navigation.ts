import type { Permission } from '@athena/shared';
import {
  Activity,
  BarChart3,
  Building2,
  ClipboardCheck,
  FileUp,
  Fingerprint,
  Gauge,
  Gavel,
  House,
  KeyRound,
  Library,
  ListChecks,
  MessageSquareWarning,
  PenLine,
  Plus,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { audienceOf, type Me } from '@/lib/auth';

/**
 * The single source for navigation. The sidebar, the mobile tab bar and the command palette all read it,
 * so a page is reachable everywhere or nowhere. Visibility is a UI decision only; the API enforces access.
 */

export interface Access {
  /** Visible when the user holds any of these permissions. */
  anyOf?: Permission[];
  /** Visible only to platform administrators. */
  platformAdmin?: boolean;
  /** Restrict to an audience (candidates see a different home than staff). */
  audience?: 'staff' | 'candidate';
  /** Requires an active organization (hidden for platform admins without a tenant). */
  needsOrganization?: boolean;
}

export interface NavItem extends Access {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra words the command palette matches. */
  keywords?: string[];
  /** Mark active only on an exact path match (default: prefix match). */
  exact?: boolean;
}

export interface NavSection {
  id: string;
  /** Omit for the first, unlabeled group. */
  label?: string;
  items: NavItem[];
}

const EXAM_STAFF: Permission[] = ['exams.create', 'exams.manage', 'monitor.view', 'grading.grade'];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'platform',
    label: 'Platform',
    items: [
      { id: 'platform-overview', label: 'Overview', href: '/platform', icon: Gauge, platformAdmin: true, exact: true, keywords: ['platform', 'tenants'] },
      { id: 'platform-orgs', label: 'Organizations', href: '/platform/organizations', icon: Building2, platformAdmin: true, keywords: ['tenants', 'institutions', 'competitions'] },
      { id: 'platform-audit', label: 'Platform audit', href: '/platform/audit', icon: ScrollText, platformAdmin: true, keywords: ['log', 'history'] },
    ],
  },
  {
    id: 'home',
    items: [
      { id: 'staff-home', label: 'Home', href: '/dashboard', icon: House, audience: 'staff', needsOrganization: true, exact: true, keywords: ['dashboard', 'overview'] },
      { id: 'candidate-home', label: 'My exams', href: '/dashboard', icon: ClipboardCheck, audience: 'candidate', anyOf: ['exams.take'], exact: true, keywords: ['dashboard', 'upcoming', 'available'] },
      { id: 'candidate-results', label: 'Results', href: '/results', icon: Trophy, audience: 'candidate', anyOf: ['results.view_own'], keywords: ['scores', 'grades', 'marks'] },
      { id: 'candidate-disputes', label: 'My disputes', href: '/my-disputes', icon: MessageSquareWarning, audience: 'candidate', anyOf: ['disputes.raise'], keywords: ['appeal', 'regrade'] },
    ],
  },
  {
    id: 'assess',
    label: 'Assessment',
    items: [
      { id: 'exams', label: 'Exams', href: '/exams', icon: ClipboardCheck, anyOf: EXAM_STAFF, keywords: ['examinations', 'tests', 'papers'] },
      { id: 'questions', label: 'Question bank', href: '/questions', icon: Library, anyOf: ['questions.view'], keywords: ['items', 'bank', 'mcq'] },
      { id: 'grading', label: 'Grading', href: '/grading', icon: PenLine, anyOf: ['grading.grade'], keywords: ['marking', 'rubric', 'scores'] },
      { id: 'disputes', label: 'Disputes', href: '/disputes', icon: Scale, anyOf: ['disputes.resolve'], keywords: ['appeals', 'regrade'] },
      { id: 'leak-tracer', label: 'Leak tracer', href: '/integrity/leak-tracer', icon: Fingerprint, anyOf: ['integrity.review'], keywords: ['integrity', 'watermark', 'provenance'] },
    ],
  },
  {
    id: 'org',
    label: 'Organization',
    items: [
      { id: 'people', label: 'People', href: '/people', icon: Users, anyOf: ['users.view'], keywords: ['users', 'candidates', 'staff', 'members'] },
      { id: 'roles', label: 'Roles', href: '/roles', icon: KeyRound, anyOf: ['roles.manage'], keywords: ['permissions', 'access'] },
      { id: 'audit', label: 'Audit log', href: '/audit', icon: ScrollText, anyOf: ['audit.view'], keywords: ['history', 'activity'] },
      { id: 'org-settings', label: 'Settings', href: '/settings/organization', icon: Settings, anyOf: ['org.settings'], keywords: ['organization', 'branding'] },
    ],
  },
];

/** Pages reachable from the user menu and the palette, for everyone. */
export const ACCOUNT_ITEMS: NavItem[] = [
  { id: 'profile', label: 'Profile & preferences', href: '/settings/profile', icon: UserRound, keywords: ['account', 'password', 'theme', 'accessibility'] },
];

/** Candidate bottom tab bar on phones. */
export const CANDIDATE_TAB_IDS = ['candidate-home', 'candidate-results', 'candidate-disputes', 'profile'] as const;

export interface QuickAction extends Access {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords?: string[];
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'new-exam', label: 'New exam', href: '/exams/new', icon: Plus, anyOf: ['exams.create'], keywords: ['create', 'schedule'] },
  { id: 'new-question', label: 'New question', href: '/questions/new', icon: Plus, anyOf: ['questions.manage'], keywords: ['create', 'write'] },
  { id: 'import-questions', label: 'Import questions', href: '/questions/import', icon: FileUp, anyOf: ['questions.manage'], keywords: ['csv', 'upload'] },
  { id: 'import-people', label: 'Import people', href: '/people/import', icon: UserPlus, anyOf: ['users.manage'], keywords: ['csv', 'enroll', 'candidates'] },
];

/** Sub-sections of one exam, rendered as a link nav by the exam layout. */
export interface ExamTab extends Access {
  id: string;
  label: string;
  /** Path segment after /exams/[examId]. Empty for the overview. */
  segment: string;
  icon: LucideIcon;
}

export const EXAM_TABS: ExamTab[] = [
  { id: 'overview', label: 'Overview', segment: '', icon: Gauge },
  { id: 'questions', label: 'Questions', segment: 'questions', icon: ListChecks, anyOf: ['exams.manage', 'exams.create'] },
  { id: 'candidates', label: 'Candidates', segment: 'candidates', icon: Users, anyOf: ['candidates.manage', 'exams.manage'] },
  { id: 'settings', label: 'Settings', segment: 'settings', icon: SlidersHorizontal, anyOf: ['exams.manage'] },
  { id: 'fairness', label: 'Fairness', segment: 'fairness', icon: Scale, anyOf: ['exams.manage'] },
  { id: 'monitor', label: 'Monitor', segment: 'monitor', icon: Activity, anyOf: ['monitor.view'] },
  { id: 'grading', label: 'Grading', segment: 'grading', icon: PenLine, anyOf: ['grading.grade'] },
  { id: 'results', label: 'Results', segment: 'results', icon: Trophy, anyOf: ['results.publish', 'grading.grade'] },
  { id: 'analytics', label: 'Analytics', segment: 'analytics', icon: BarChart3, anyOf: ['analytics.view'] },
  { id: 'integrity', label: 'Integrity', segment: 'integrity', icon: ShieldCheck, anyOf: ['integrity.review'] },
  { id: 'disputes', label: 'Disputes', segment: 'disputes', icon: Gavel, anyOf: ['disputes.resolve'] },
];

export function hasAccess(me: Me | null | undefined, access: Access): boolean {
  if (!me) return false;
  if (access.platformAdmin && !me.user.isPlatformAdmin) return false;
  if (access.needsOrganization && !me.organization) return false;
  if (access.audience) {
    const audience = audienceOf(me);
    if (access.audience === 'staff' && audience !== 'staff') return false;
    if (access.audience === 'candidate' && audience !== 'candidate') return false;
  }
  if (access.anyOf && access.anyOf.length > 0) {
    const granted = new Set<string>(me.permissions);
    if (!access.anyOf.some((p) => granted.has(p))) return false;
  }
  return true;
}

/** Sections with only the items this user may see; empty sections dropped. */
export function visibleNav(me: Me | null | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => hasAccess(me, item)) })).filter(
    (section) => section.items.length > 0,
  );
}

export function visibleQuickActions(me: Me | null | undefined): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => hasAccess(me, a));
}

export function visibleExamTabs(me: Me | null | undefined): ExamTab[] {
  return EXAM_TABS.filter((t) => hasAccess(me, t));
}

export function candidateTabs(me: Me | null | undefined): NavItem[] {
  const all = [...visibleNav(me).flatMap((s) => s.items), ...ACCOUNT_ITEMS];
  return CANDIDATE_TAB_IDS.map((id) => all.find((i) => i.id === id)).filter((i): i is NavItem => !!i);
}

/** Is `item` the current page? */
export function isActive(pathname: string, item: Pick<NavItem, 'href' | 'exact'>): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

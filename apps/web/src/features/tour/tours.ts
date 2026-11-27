import type { Permission } from '@athena/shared';
import { api } from '@/lib/api';
import { audienceOf, type Me } from '@/lib/auth';

export interface TourContext {
  me: Me;
  can: (permission: Permission) => boolean;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Selectors tried in order; the first visible match gets the spotlight. None, or no match: a centred card. */
  target?: string[];
  /** Where the step lives. A function resolves it when the step opens; null stays on the current page. */
  route?: string | ((ctx: TourContext) => Promise<string | null>);
  /** Hide the step when this returns false (a permission the person lacks). */
  when?: (ctx: TourContext) => boolean;
}

const HEADING = ['main h1', 'h1'];
const SEARCH = ['[data-tour="search"]', 'button:has(kbd)', 'header button[aria-label*="Search" i]'];

/** An exam to show, preferring the given phases in order (a live one for Monitor, say). */
function examRoute(suffix: string, phases: string[], fallback = true) {
  return async (): Promise<string | null> => {
    try {
      const page = await api.get<{ items: { id: string; phase: string }[] }>('/exams', {
        query: { pageSize: 50 },
      });
      const pick =
        phases.map((p) => page.items.find((e) => e.phase === p)).find(Boolean) ??
        (fallback ? page.items[0] : undefined);
      return pick ? `/exams/${pick.id}${suffix}` : null;
    } catch {
      return null;
    }
  };
}

const shortcuts: TourStep = {
  id: 'shortcuts',
  title: 'Get anywhere fast',
  body: 'Press Ctrl K (⌘K on a Mac) to jump to any page or exam, and ? to see every shortcut.',
  target: SEARCH,
};

function home(body: string): TourStep {
  return { id: 'home', title: 'Your home', body, route: '/dashboard', target: HEADING };
}

function platformTour(): TourStep[] {
  return [
    {
      id: 'platform-home',
      title: 'The platform at a glance',
      body: 'Every organization on Athena, how much they use it, and how the service is holding up.',
      route: '/platform',
      target: HEADING,
    },
    {
      id: 'platform-health',
      title: 'Service health',
      body: 'Availability, database latency and outages, checked every 30 seconds.',
      route: '/platform',
      target: ['[data-tour="platform-health"]'],
    },
    {
      id: 'platform-day',
      title: 'Day at a glance',
      body: 'Everything platform administrators did today, on one rule. Point at a tick to read it.',
      route: '/platform',
      target: ['[data-tour="day-glance"]', 'section[aria-labelledby="day-glance-title"]'],
    },
    {
      id: 'platform-orgs',
      title: 'Organizations',
      body: 'Onboard a school, university or competition organizer here. Each gets its own private space.',
      route: '/platform/organizations',
      target: ['[data-tour="onboard"]', ...HEADING],
    },
    {
      id: 'platform-audit',
      title: 'Platform audit',
      body: 'Every action a platform administrator takes is recorded here.',
      route: '/platform/audit',
      target: HEADING,
    },
    shortcuts,
  ];
}

function adminTour(): TourStep[] {
  return [
    home(
      'This page shows what is live, what needs you and what is coming up across your organization.',
    ),
    {
      id: 'day',
      title: 'Day at a glance',
      body: 'Today’s activity on one rule. Point at a tick to read it, select it to open the entry.',
      route: '/dashboard',
      target: ['[data-tour="day-glance"]', 'section[aria-labelledby="day-glance-title"]'],
      when: (x) => x.can('audit.view'),
    },
    {
      id: 'people',
      title: 'People',
      body: 'Add people one at a time, or import many at once from a spreadsheet.',
      route: '/people',
      target: ['[data-tour="people-actions"]', ...HEADING],
      when: (x) => x.can('users.view'),
    },
    {
      id: 'roles',
      title: 'Roles',
      body: 'Roles decide what each person can do. Adjust them, or add one of your own.',
      route: '/roles',
      target: HEADING,
      when: (x) => x.can('roles.manage'),
    },
    {
      id: 'settings',
      title: 'Your organization',
      body: 'Set the name, contact address and brand colour everyone sees.',
      route: '/settings/organization',
      target: ['[data-tour="branding"]', ...HEADING],
      when: (x) => x.can('org.settings'),
    },
    {
      id: 'audit',
      title: 'Audit log',
      body: 'Every change anyone makes is recorded here, in plain sentences.',
      route: '/audit',
      target: HEADING,
      when: (x) => x.can('audit.view'),
    },
    shortcuts,
  ];
}

function examinerTour(): TourStep[] {
  return [
    home('This page shows the live exam, what needs you, and what is coming up.'),
    {
      id: 'needs-you',
      title: 'Needs you',
      body: 'Grading, incidents and disputes waiting on you, with one action each.',
      route: '/dashboard',
      target: ['[data-tour="needs-you"]', 'aside[aria-labelledby="needs-you"]'],
    },
    {
      id: 'exams',
      title: 'Exams',
      body: 'Every exam, from first draft to published results.',
      route: '/exams',
      target: HEADING,
    },
    {
      id: 'exam-overview',
      title: 'Inside an exam',
      body: 'Each exam has its window, a readiness check and the publish button in one place.',
      route: examRoute('', ['scheduled', 'draft', 'ongoing', 'completed']),
      target: ['[data-tour="exam-overview"]', ...HEADING],
    },
    {
      id: 'bank',
      title: 'Question bank',
      body: 'Write, import and reuse questions. The editor shows a live preview as you type.',
      route: '/questions',
      target: HEADING,
      when: (x) => x.can('questions.view'),
    },
    {
      id: 'monitor',
      title: 'Monitor',
      body: 'While an exam runs, watch every candidate and step in from here.',
      route: examRoute('/monitor', ['ongoing'], false),
      target: ['[data-tour="monitor"]', ...HEADING],
      when: (x) => x.can('monitor.view'),
    },
    shortcuts,
  ];
}

function graderTour(): TourStep[] {
  return [
    home('This page lists the answers waiting for you and anything else that needs a grader.'),
    {
      id: 'grading',
      title: 'Grading',
      body: 'Answers waiting for you, exam by exam.',
      route: '/grading',
      target: HEADING,
    },
    {
      id: 'keys',
      title: 'Grade from the keyboard',
      body: 'J and K move between answers, 1 to 9 tick rubric items, and Ctrl Enter saves and moves on.',
    },
    {
      id: 'disputes',
      title: 'Disputes',
      body: 'When a candidate questions a mark, the dispute lands here for a decision.',
      route: '/disputes',
      target: HEADING,
      when: (x) => x.can('disputes.resolve'),
    },
    shortcuts,
  ];
}

function proctorTour(): TourStep[] {
  return [
    home('This page shows which exams are live and which incidents need a look.'),
    {
      id: 'monitor',
      title: 'The live roster',
      body: 'See who is writing, who has stalled, and incidents as they happen.',
      route: examRoute('/monitor', ['ongoing'], false),
      target: ['[data-tour="monitor"]', ...HEADING],
    },
    {
      id: 'intervene',
      title: 'Step in',
      body: 'Send an announcement, give a candidate extra time, or submit for them, all from the roster.',
      target: ['[data-tour="monitor-actions"]'],
      when: (x) => x.can('monitor.intervene'),
    },
    {
      id: 'hall',
      title: 'Hall display',
      body: 'Put the clock and announcements on a projector for the room.',
      target: ['[data-tour="hall-display"]', 'a[href$="/monitor/hall"]'],
    },
    shortcuts,
  ];
}

function candidateTour(): TourStep[] {
  return [
    home('This page shows your exams: what is open now and what is coming up.'),
    {
      id: 'system-check',
      title: 'Check your device',
      body: 'Before each exam, its lobby runs a quick system check so you know your device is ready.',
    },
    {
      id: 'in-exam',
      title: 'During an exam',
      body: 'Answers save on your device first, so a dropped connection loses nothing. Keep it to one tab.',
    },
    {
      id: 'results',
      title: 'Results',
      body: 'Published results and certificates appear here.',
      route: '/results',
      target: HEADING,
      when: (x) => x.can('results.view_own'),
    },
    {
      id: 'my-disputes',
      title: 'Disputes',
      body: 'Think a mark is wrong? Raise a dispute and follow its progress here.',
      route: '/my-disputes',
      target: HEADING,
      when: (x) => x.can('disputes.raise'),
    },
  ];
}

/** The tour for whoever is signed in: their role decides the steps, their permissions trim them. */
export function tourFor(ctx: TourContext): TourStep[] {
  const { me, can } = ctx;
  let steps: TourStep[];
  if (me.user.isPlatformAdmin && !me.organization) steps = platformTour();
  else if (audienceOf(me) === 'candidate') steps = candidateTour();
  else if (can('users.manage') || can('org.settings')) steps = adminTour();
  else if (can('exams.create') || can('exams.manage')) steps = examinerTour();
  else if (can('grading.grade')) steps = graderTour();
  else if (can('monitor.view')) steps = proctorTour();
  else steps = [home('This page shows what is waiting for you.'), shortcuts];
  return steps.filter((s) => !s.when || s.when(ctx));
}

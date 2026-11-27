import type { Tone } from '@/components/ui/badge';

export const DEMO_PASSWORD = 'Athena@2026';

/** Where a demo account lives: the platform itself, or one of the two demo tenants. */
export type DemoOrganization = 'Platform' | 'Northfield Institute of Technology' | 'CodeSprint League';

export interface DemoAccount {
  id: string;
  role: string;
  /** As seeded, so the signed-in name matches. */
  name: string;
  email: string;
  organization: DemoOrganization;
  /** What this account shows off. */
  blurb: string;
  tone: Tone | 'gray';
  icon: 'platform' | 'admin' | 'examiner' | 'grader' | 'proctor' | 'candidate';
}

/** In tenant order: the platform, then Northfield Institute of Technology, then CodeSprint League. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'platform', role: 'Platform admin', name: 'Zara Sheikh', email: 'admin@athena.app', organization: 'Platform', blurb: 'Tenants and platform audit', tone: 'gray', icon: 'platform' },
  { id: 'org-admin', role: 'Org admin', name: 'Imran Qureshi', email: 'registrar@northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'People, roles, every exam', tone: 'accent', icon: 'admin' },
  { id: 'examiner', role: 'Examiner', name: 'Dr. Sara Ahmed', email: 'sara.ahmed@northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Author, schedule, publish', tone: 'info', icon: 'examiner' },
  { id: 'examiner-omar', role: 'Examiner', name: 'Omar Farooq', email: 'omar.farooq@northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Completed exam with results', tone: 'info', icon: 'examiner' },
  { id: 'grader', role: 'Grader', name: 'Bilal Khan', email: 'bilal.khan@northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Rubrics and disputes', tone: 'success', icon: 'grader' },
  { id: 'proctor', role: 'Proctor', name: 'Hina Raza', email: 'hina.raza@northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Live monitoring', tone: 'warning', icon: 'proctor' },
  { id: 'candidate-ali', role: 'Candidate', name: 'Ali Hassan', email: 'ali.hassan@student.northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Take an exam', tone: 'accent', icon: 'candidate' },
  { id: 'candidate-ayesha', role: 'Candidate', name: 'Ayesha Malik', email: 'ayesha.malik@student.northfield.edu', organization: 'Northfield Institute of Technology', blurb: 'Results and disputes', tone: 'accent', icon: 'candidate' },
  { id: 'codesprint-organizer', role: 'Org admin', name: 'Usman Tariq', email: 'organizer@codesprint.io', organization: 'CodeSprint League', blurb: 'Competitors, teams and judges', tone: 'accent', icon: 'admin' },
  { id: 'codesprint-judge', role: 'Competition judge', name: 'Mehwish Ali', email: 'judge@codesprint.io', organization: 'CodeSprint League', blurb: 'Runs the live qualifier', tone: 'info', icon: 'examiner' },
];

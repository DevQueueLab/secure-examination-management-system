import type { Tone } from '@/components/ui/badge';

export const DEMO_PASSWORD = 'Athena@2026';

export interface DemoAccount {
  id: string;
  role: string;
  name: string;
  email: string;
  /** What this account shows off. */
  blurb: string;
  tone: Tone | 'gray';
  icon: 'platform' | 'admin' | 'examiner' | 'grader' | 'proctor' | 'candidate';
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'platform', role: 'Platform admin', name: 'Zara Sheikh', email: 'admin@athena.app', blurb: 'Tenants and platform audit', tone: 'gray', icon: 'platform' },
  { id: 'org-admin', role: 'Org admin', name: 'Imran Qureshi', email: 'registrar@northfield.edu', blurb: 'People, roles, every exam', tone: 'accent', icon: 'admin' },
  { id: 'examiner', role: 'Examiner', name: 'Sara Ahmed', email: 'sara.ahmed@northfield.edu', blurb: 'Author, schedule, publish', tone: 'info', icon: 'examiner' },
  { id: 'grader', role: 'Grader', name: 'Bilal Khan', email: 'bilal.khan@northfield.edu', blurb: 'Rubrics and disputes', tone: 'success', icon: 'grader' },
  { id: 'proctor', role: 'Proctor', name: 'Hina Raza', email: 'hina.raza@northfield.edu', blurb: 'Live monitoring', tone: 'warning', icon: 'proctor' },
  { id: 'candidate-ali', role: 'Candidate', name: 'Ali Hassan', email: 'ali.hassan@student.northfield.edu', blurb: 'Take an exam', tone: 'accent', icon: 'candidate' },
  { id: 'candidate-ayesha', role: 'Candidate', name: 'Ayesha Malik', email: 'ayesha.malik@student.northfield.edu', blurb: 'Results and disputes', tone: 'accent', icon: 'candidate' },
];

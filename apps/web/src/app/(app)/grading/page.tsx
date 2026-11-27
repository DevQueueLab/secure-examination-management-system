import type { Metadata } from 'next';
import { GradingInbox } from '@/features/grading/components/grading-inbox';

export const metadata: Metadata = { title: 'Grading' };

export default function Page() {
  return <GradingInbox />;
}

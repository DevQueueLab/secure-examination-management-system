import type { Metadata } from 'next';
import { MyResults } from '@/features/results/components/my-results';

export const metadata: Metadata = { title: 'Results' };

export default function Page() {
  return <MyResults />;
}

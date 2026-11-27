import type { Metadata } from 'next';
import { StaffInbox } from '@/features/disputes/components/staff-inbox';

export const metadata: Metadata = { title: 'Disputes' };

export default function Page() {
  return <StaffInbox />;
}

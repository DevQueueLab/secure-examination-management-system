import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { PeopleView } from '@/features/admin/people/people-view';

export const metadata: Metadata = { title: 'People' };

export default function PeoplePage() {
  return (
    <AccessGate
      anyOf={['users.view']}
      title="People"
      reason="Seeing people needs the “View people in the organization” permission. Ask an organization admin."
    >
      <PeopleView />
    </AccessGate>
  );
}

import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { ImportPeopleView } from '@/features/admin/people/import-view';

export const metadata: Metadata = { title: 'Import people' };

export default function ImportPeoplePage() {
  return (
    <AccessGate
      anyOf={['users.manage']}
      title="Import people"
      reason="Importing people needs the “Create, edit, deactivate users and assign roles” permission. Ask an organization admin."
    >
      <ImportPeopleView />
    </AccessGate>
  );
}

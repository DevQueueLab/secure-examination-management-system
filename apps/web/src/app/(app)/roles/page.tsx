import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { RolesView } from '@/features/admin/roles/roles-view';

export const metadata: Metadata = { title: 'Roles' };

export default function RolesPage() {
  return (
    <AccessGate
      anyOf={['roles.manage', 'users.manage', 'users.view']}
      title="Roles"
      reason="Roles are visible to people who can view or manage people. Ask an organization admin."
    >
      <RolesView />
    </AccessGate>
  );
}

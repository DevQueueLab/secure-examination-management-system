import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { OrgSettingsView } from '@/features/admin/settings/org-settings-view';

export const metadata: Metadata = { title: 'Organization settings' };

export default function OrganizationSettingsPage() {
  return (
    <AccessGate
      anyOf={['org.settings']}
      title="Organization settings"
      reason="Changing settings needs the “Manage organization settings and branding” permission."
    >
      <OrgSettingsView />
    </AccessGate>
  );
}

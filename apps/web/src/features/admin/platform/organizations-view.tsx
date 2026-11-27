'use client';

import type { OrganizationStatus, OrganizationType } from '@athena/shared';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useTenants } from '../api';
import { SearchField } from '../components/search-field';
import { formatCount, plural } from '../format';
import { OnboardSheet } from './onboard-sheet';
import { TenantsTable } from './tenants-table';

type TypeFilter = 'all' | OrganizationType;
type StatusFilter = 'all' | OrganizationStatus;

export function OrganizationsView() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [onboarding, setOnboarding] = useState(false);
  const tenants = useTenants({
    q: q || undefined,
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
  });
  const f = tenants.data?.facets;
  const filtered = !!(q || type !== 'all' || status !== 'all');

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle={
          f
            ? `${formatCount(f.all)} on Athena: ${plural(f.institution, 'institution')} and ${plural(f.competition, 'competition')}`
            : 'Every tenant on Athena.'
        }
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Organizations' }]}
        actions={
          <Button variant="filled" onClick={() => setOnboarding(true)}>
            <Plus aria-hidden /> Onboard organization
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={q}
          onChange={setQ}
          label="Search organizations"
          placeholder="Name, address or contact email"
          className="lg:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<TypeFilter>
            aria-label="Type"
            value={type}
            onValueChange={setType}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'institution', label: 'Institutions' },
              { value: 'competition', label: 'Competitions' },
            ]}
          />
          <SegmentedControl<StatusFilter>
            aria-label="Status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'active', label: 'Active' },
              {
                value: 'suspended',
                label: f?.suspended ? `Suspended (${f.suspended})` : 'Suspended',
              },
            ]}
          />
        </div>
      </div>

      {tenants.isPending ? (
        <SkeletonRows rows={6} />
      ) : tenants.isError && !tenants.data ? (
        <EmptyState
          icon={<Building2 />}
          title="Couldn’t load organizations"
          description={errorMessage(tenants.error)}
          action={
            <Button variant="gray" onClick={() => void tenants.refetch()}>
              Try again
            </Button>
          }
        />
      ) : tenants.data!.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Building2 />}
            title="No organizations match"
            description="Try another name, or clear the type and status filters."
            action={
              <Button
                variant="gray"
                onClick={() => {
                  setQ('');
                  setType('all');
                  setStatus('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Building2 />}
            title="No organizations yet"
            description="Each organization gets a private space with its own people, roles, question bank and exams."
            action={
              <Button variant="filled" onClick={() => setOnboarding(true)}>
                Onboard organization
              </Button>
            }
          />
        )
      ) : (
        <div aria-busy={tenants.isFetching || undefined}>
          <TenantsTable tenants={tenants.data!.items} />
        </div>
      )}

      <OnboardSheet open={onboarding} onOpenChange={setOnboarding} />
    </>
  );
}

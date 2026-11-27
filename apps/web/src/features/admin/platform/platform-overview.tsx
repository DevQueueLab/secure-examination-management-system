'use client';

import { EXAM_PHASES, type ExamPhase } from '@athena/shared';
import { Building2, CloudOff, Gauge, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PhaseBadge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { MetricStrip } from '../components/metric-strip';
import { usePlatformOverview, useTenants } from '../api';
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  plural,
  timeAgo,
} from '../format';
import type { PlatformOverview as Overview } from '../types';
import { AttemptsChart } from './attempts-chart';
import { OnboardSheet } from './onboard-sheet';
import { TenantsTable } from './tenants-table';

const PHASE_LABEL: Record<ExamPhase, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  ongoing: 'Live now',
  completed: 'Completed',
  archived: 'Archived',
};

function HealthRow({
  label,
  value,
  tone = 'success',
  detail,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  detail?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot tone={tone} />
        <div className="min-w-0">
          <p className="text-callout text-label">{label}</p>
          {detail && <p className="text-footnote text-label-secondary">{detail}</p>}
        </div>
      </div>
      <p className="shrink-0 text-right text-callout tabular-nums text-label-secondary">{value}</p>
    </div>
  );
}

function Health({ data }: { data: Overview }) {
  const db = data.database;
  const outage = data.lastOutage;
  return (
    <div className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
      <HealthRow
        label="API"
        value={`up ${formatDuration(data.api.uptimeSeconds)}`}
        detail={`Node ${data.api.node}, ${formatCount(data.api.memoryMb)} MB in use`}
      />
      <HealthRow
        label="Database"
        tone={
          db.status === 'ok'
            ? db.latencyMs !== null && db.latencyMs > 200
              ? 'warning'
              : 'success'
            : 'danger'
        }
        value={db.status === 'ok' ? `${db.latencyMs ?? '—'} ms` : 'Unreachable'}
        detail={
          db.status === 'ok'
            ? `PostgreSQL ${db.version?.split(' ')[0] ?? ''}, ${db.sizeBytes ? formatBytes(db.sizeBytes) : '—'}, ${db.connections ?? 0} connections`
            : 'Health check failed'
        }
      />
      <HealthRow
        label="Signed in now"
        tone="neutral"
        value={formatCount(data.users.activeSessions)}
        detail="Sessions active in the last 15 minutes"
      />
      <HealthRow
        label="Outages"
        tone={data.outagesLast30Days > 0 ? 'warning' : 'success'}
        value={
          data.outagesLast30Days === 0 ? 'None in 30 days' : `${data.outagesLast30Days} in 30 days`
        }
        detail={
          outage
            ? `Last ${timeAgo(outage.endedAt)}, ${formatDuration(outage.durationSeconds)}. ${formatCount(outage.compensatedAttempts)} ${outage.compensatedAttempts === 1 ? 'attempt was' : 'attempts were'} given the time back.`
            : 'Candidates get lost time back automatically after any outage.'
        }
      />
    </div>
  );
}

function ExamPhases({ byPhase, total }: { byPhase: Record<ExamPhase, number>; total: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4">
      {EXAM_PHASES.map((p) => {
        const n = byPhase[p] ?? 0;
        return (
          <div key={p} className="flex items-center gap-3">
            <span className="w-28 shrink-0">
              <PhaseBadge phase={p} />
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-label-tertiary"
                style={{ width: total ? `${(n / total) * 100}%` : 0 }}
              />
            </span>
            <span
              className="w-10 text-right text-callout tabular-nums text-label"
              aria-label={`${PHASE_LABEL[p]}: ${n}`}
            >
              {formatCount(n)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading platform overview" className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

export function PlatformOverview() {
  const [onboarding, setOnboarding] = useState(false);
  const overview = usePlatformOverview();
  const tenants = useTenants({});
  const data = overview.data;

  return (
    <>
      <PageHeader
        title="Platform"
        subtitle="Every organization on Athena, how much they use it, and how the service is holding up."
        actions={
          <Button variant="filled" onClick={() => setOnboarding(true)}>
            <Plus aria-hidden /> Onboard organization
          </Button>
        }
      />

      {overview.isPending ? (
        <OverviewSkeleton />
      ) : overview.isError ? (
        <EmptyState
          icon={<Gauge />}
          title="Couldn’t load the overview"
          description={errorMessage(overview.error)}
          action={
            <Button variant="gray" onClick={() => void overview.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          <MetricStrip
            metrics={[
              {
                label: 'Organizations',
                value: formatCount(data!.tenants.total),
                detail: `${plural(data!.tenants.byType.institution, 'institution')}, ${plural(data!.tenants.byType.competition, 'competition')}${data!.tenants.byStatus.suspended ? `, ${data!.tenants.byStatus.suspended} suspended` : ''}`,
              },
              {
                label: 'People',
                value: formatCount(data!.users.total),
                detail: `${formatCount(data!.users.signedInLast7Days)} signed in this week`,
              },
              {
                label: 'In an exam now',
                value: formatCount(data!.attempts.inProgressNow),
                detail: `${data!.exams.byPhase.ongoing} ${data!.exams.byPhase.ongoing === 1 ? 'exam is' : 'exams are'} live`,
              },
              {
                label: 'Attempts today',
                value: formatCount(data!.attempts.today),
                detail: `${formatCount(data!.exams.total)} exams on the platform`,
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Section
              title="Attempts"
              description="Exam attempts started each day across all organizations, last 14 days. Practice runs are excluded."
            >
              <div className="rounded-xl bg-surface p-4">
                <AttemptsChart days={data!.attempts.last14Days} />
              </div>
            </Section>
            <Section title="Exams" description="Where every organization’s exams are right now.">
              <ExamPhases byPhase={data!.exams.byPhase} total={data!.exams.total} />
            </Section>
          </div>

          <Section
            title="Health"
            description={
              <>
                Checked {timeAgo(data!.generatedAt)}, refreshes every 30 seconds.
                <span className="sr-only"> Generated {formatDateTime(data!.generatedAt)}.</span>
              </>
            }
          >
            <Health data={data!} />
          </Section>

          <Section
            title="Organizations"
            description="Athena sees counts only. Exam content, answers and grades stay inside each organization."
            actions={
              <Button asChild variant="plain" size="sm">
                <Link href="/platform/organizations">See all</Link>
              </Button>
            }
          >
            {tenants.isPending ? (
              <SkeletonRows rows={5} />
            ) : tenants.isError ? (
              <EmptyState
                size="sm"
                icon={<CloudOff />}
                title="Couldn’t load organizations"
                description={errorMessage(tenants.error)}
              />
            ) : tenants.data.items.length === 0 ? (
              <EmptyState
                icon={<Building2 />}
                title="No organizations yet"
                description="Onboard a school, university or competition organizer to give them their own private space on Athena."
                action={
                  <Button variant="filled" onClick={() => setOnboarding(true)}>
                    Onboard organization
                  </Button>
                }
              />
            ) : (
              <TenantsTable tenants={tenants.data.items.slice(0, 8)} compact />
            )}
          </Section>
        </div>
      )}

      <OnboardSheet open={onboarding} onOpenChange={setOnboarding} />
    </>
  );
}

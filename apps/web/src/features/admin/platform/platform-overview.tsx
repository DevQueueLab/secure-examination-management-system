'use client';

import { EXAM_PHASES, type ExamPhase } from '@athena/shared';
import { Building2, CloudOff, Gauge, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { INK_BG, numeral, SegmentRule, Ticks, type Ink } from '../components/instrument';
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

const PHASE_INK: Record<ExamPhase, Ink> = {
  draft: 'rest',
  scheduled: 'graphite',
  ongoing: 'carmine',
  completed: 'gold',
  archived: 'wine',
};

const DAY = 86_400;
const pct = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

type Status = 'ok' | 'slow' | 'degraded' | 'outage' | 'down';
const STATUS: Record<Status, { text: string; className: string }> = {
  ok: { text: 'Healthy', className: 'text-label-tertiary' },
  slow: { text: 'Slow', className: 'text-warning-text' },
  degraded: { text: 'Degraded', className: 'text-warning-text' },
  outage: { text: 'Outage recorded', className: 'text-warning-text' },
  down: { text: 'Down', className: 'text-danger-text' },
};

/** One gauge on the health panel: a name, a light reading, its scale and the facts behind it. */
function Instrument({
  title,
  reading,
  unit,
  status,
  children,
  detail,
}: {
  title: string;
  reading: ReactNode;
  unit?: string;
  status?: Status;
  children?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col bg-bg py-6 sm:px-6 sm:max-xl:odd:pl-0 xl:first:pl-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-footnote font-medium text-label-secondary">{title}</h3>
        {status && (
          <span className={cn('text-caption font-medium', STATUS[status].className)}>
            {STATUS[status].text}
          </span>
        )}
      </div>
      <p className="mt-3 flex items-baseline gap-1.5 text-label">
        <span className={cn(numeral, 'text-[2.5rem]/none')}>{reading}</span>
        {unit && <span className="text-callout text-label-tertiary">{unit}</span>}
      </p>
      {children && <div className="mt-5">{children}</div>}
      {detail && <p className="mt-3 text-pretty text-caption text-label-tertiary">{detail}</p>}
    </div>
  );
}

/** Thirty days on the rule, with a carmine mark where the last outage ended. */
function OutageTrack({ endedAt, generatedAt }: { endedAt: string | null; generatedAt: string }) {
  const at = endedAt
    ? 1 - (new Date(generatedAt).getTime() - new Date(endedAt).getTime()) / (30 * DAY * 1000)
    : null;
  const inside = at !== null && at >= 0 && at <= 1;
  return (
    <div
      role="img"
      aria-label={
        inside ? `Last outage ended ${timeAgo(endedAt!)}` : 'No outages in the last 30 days'
      }
      className="min-w-36"
    >
      <div className="relative h-[22px]">
        <Ticks height={12} className="absolute inset-x-0 bottom-0" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-separator-strong" />
        {inside && (
          <span
            aria-hidden
            className="absolute bottom-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-data-1"
            style={{ left: `${(at! * 100).toFixed(2)}%` }}
          />
        )}
      </div>
      <div
        aria-hidden
        className="mt-1 flex justify-between text-[0.625rem] leading-3 tabular-nums text-label-tertiary"
      >
        <span>30 days ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function Health({ data }: { data: Overview }) {
  const db = data.database;
  const outage = data.lastOutage;
  const lost = data.outageSecondsLast30Days ?? (data.outagesLast30Days === 0 ? 0 : null);
  const availability = lost === null ? null : Math.max(0, 100 - (lost / (30 * DAY)) * 100);
  const latency = db.latencyMs;
  const dbStatus: Status =
    db.status !== 'ok' ? 'down' : latency !== null && latency > 200 ? 'slow' : 'ok';

  return (
    <div className="grid gap-px border-y border-separator bg-separator sm:grid-cols-2 xl:grid-cols-4">
      <Instrument
        title="Availability, last 30 days"
        reading={availability === null ? '—' : pct.format(availability)}
        unit={availability === null ? undefined : '%'}
        status={availability !== null && availability < 99.5 ? 'degraded' : 'ok'}
        detail={`API up ${formatDuration(data.api.uptimeSeconds)} since its last restart. Node ${data.api.node}, ${formatCount(data.api.memoryMb)} MB in use.`}
      >
        {availability !== null && (
          <MarksRule
            size="sm"
            marker="both"
            label="Availability over the last 30 days"
            value={availability}
            min={99}
            max={100}
            labels="ends"
            format={(v) => `${v}%`}
            valueText={`${pct.format(availability)}% available`}
          />
        )}
      </Instrument>

      <Instrument
        title="Database latency"
        reading={
          db.status !== 'ok'
            ? 'Unreachable'
            : latency === null
              ? '—'
              : latency < 10
                ? latency.toFixed(1)
                : Math.round(latency)
        }
        unit={db.status === 'ok' && latency !== null ? 'ms' : undefined}
        status={dbStatus}
        detail={
          db.status === 'ok'
            ? `PostgreSQL ${db.version?.split(' ')[0] ?? ''}, ${db.sizeBytes ? formatBytes(db.sizeBytes) : 'size unknown'}, ${plural(db.connections ?? 0, 'connection')}.`
            : 'The health check could not reach the database.'
        }
      >
        {db.status === 'ok' && latency !== null && (
          <MarksRule
            size="sm"
            label="Database latency"
            value={Math.min(latency, 250)}
            max={250}
            pass={200}
            labels="ends"
            format={(v) => `${v} ms`}
            valueText={`${Math.round(latency)} milliseconds; slow above 200`}
          />
        )}
      </Instrument>

      <Instrument
        title="Signed in now"
        reading={formatCount(data.users.activeSessions)}
        unit={data.users.activeSessions === 1 ? 'session' : 'sessions'}
        detail={`Active in the last 15 minutes. ${formatCount(data.users.signedInLast7Days)} of ${plural(data.users.total, 'person', 'people')} signed in this week.`}
      />

      <Instrument
        title="Outages, last 30 days"
        reading={formatCount(data.outagesLast30Days)}
        status={data.outagesLast30Days > 0 ? 'outage' : 'ok'}
        detail={
          outage
            ? `Last ended ${timeAgo(outage.endedAt)} after ${formatDuration(outage.durationSeconds)}. ${plural(outage.compensatedAttempts, 'attempt')} got the time back.`
            : 'Candidates get lost time back automatically after any outage.'
        }
      >
        <OutageTrack endedAt={outage?.endedAt ?? null} generatedAt={data.generatedAt} />
      </Instrument>
    </div>
  );
}

function ExamPhases({ byPhase, total }: { byPhase: Record<ExamPhase, number>; total: number }) {
  return (
    <div className="flex flex-col gap-4">
      <SegmentRule
        label={`Exams by phase: ${EXAM_PHASES.map((p) => `${byPhase[p] ?? 0} ${PHASE_LABEL[p].toLowerCase()}`).join(', ')}`}
        segments={EXAM_PHASES.map((p) => ({ key: p, value: byPhase[p] ?? 0, ink: PHASE_INK[p] }))}
        startLabel="0"
        endLabel={`${formatCount(total)} exams`}
      />
      <ul className="divide-y divide-separator border-y border-separator">
        {EXAM_PHASES.map((p) => (
          <li key={p} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-[2px]', INK_BG[PHASE_INK[p]])}
            />
            <span className="flex-1 text-callout text-label">{PHASE_LABEL[p]}</span>
            <span className={cn(numeral, 'text-title-3 text-label')}>
              {formatCount(byPhase[p] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
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
        <div className="flex flex-col gap-12">
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

          <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Section
              title="Attempts"
              description="Exam attempts started each day across all organizations, last 14 days. Practice runs are excluded."
            >
              <AttemptsChart days={data!.attempts.last14Days} />
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

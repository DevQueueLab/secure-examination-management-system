'use client';

import { ScrollText, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AthenaMark } from '@/components/brand';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useAuditFeed } from '../api';
import { SearchField } from '../components/search-field';
import { dayLabel, formatCount, formatDateTime, timeAgo } from '../format';
import type { AuditEntry, AuditFilters } from '../types';
import { AuditSentence, auditText, groupLabel, groupOf, metadataRows } from './audit-sentence';

type Period = '24h' | '7d' | '30d' | 'all';
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
const ALL = '__all';

function EntryRow({ entry, showOrg }: { entry: AuditEntry; showOrg: boolean }) {
  const details = metadataRows(entry.metadata).filter((r) => r.value !== '—');
  const group = groupOf(entry.action);
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <div className="pt-0.5">
        {entry.actor?.isPlatformAdmin ? (
          <span title="Athena platform administrator">
            <AthenaMark size={28} />
          </span>
        ) : (
          <Avatar name={entry.actor?.name ?? 'Athena'} size="sm" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-callout text-label-secondary" title={auditText(entry)}>
          <AuditSentence entry={entry} />
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary">
          <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
            {timeAgo(entry.createdAt)}
          </time>
          <Badge
            size="sm"
            tone={
              group === 'platform'
                ? 'accent'
                : group === 'auth' && entry.action.endsWith('failed')
                  ? 'danger'
                  : 'neutral'
            }
          >
            {groupLabel(group)}
          </Badge>
          {showOrg && entry.organization && (
            <span className="truncate">{entry.organization.name}</span>
          )}
          {entry.ip && <span className="tabular-nums">{entry.ip}</span>}
        </p>
        {details.length > 0 && (
          <details className="group mt-1.5">
            <summary className="inline-flex cursor-default list-none rounded-md text-footnote font-medium text-accent-text hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show details</span>
              <span className="hidden group-open:inline">Hide details</span>
            </summary>
            <dl className="mt-2 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-fill-secondary px-3 py-2.5 text-footnote">
              {details.map((d) => (
                <div key={d.key} className="contents">
                  <dt className="text-label-secondary">{d.label}</dt>
                  <dd className="min-w-0 break-words text-label">{d.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading activity" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3.5">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The audit log as a readable, filterable timeline. `platform` shows platform actions across tenants. */
export function AuditTimeline({ scope }: { scope: 'org' | 'platform' }) {
  const [q, setQ] = useState('');
  const [actor, setActor] = useState(ALL);
  const [group, setGroup] = useState(ALL);
  const [period, setPeriod] = useState<Period>('7d');

  const filters = useMemo<AuditFilters>(
    () => ({
      q: q || undefined,
      actor: actor === ALL ? undefined : actor,
      action: group === ALL ? undefined : group,
      from: period === 'all' ? undefined : new Date(Date.now() - PERIOD_MS[period]).toISOString(),
    }),
    [q, actor, group, period],
  );
  const query = useAuditFeed(scope, filters);

  const pages = query.data?.pages ?? [];
  const entries = pages.flatMap((p) => p.items);
  const first = pages[0];
  const total = first?.total ?? 0;

  const days = useMemo(() => {
    const out: { label: string; entries: AuditEntry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(e);
      else out.push({ label, entries: [e] });
    }
    return out;
  }, [entries]);

  const filtered = !!(q || actor !== ALL || group !== ALL);
  const reset = () => {
    setQ('');
    setActor(ALL);
    setGroup(ALL);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={q}
          onChange={setQ}
          label="Search activity"
          placeholder="Search people, exams, actions"
          className="lg:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          {scope === 'org' && (
            <Select
              aria-label="Person"
              size="md"
              className="w-48"
              value={actor}
              onValueChange={setActor}
              options={[
                { value: ALL, label: 'Everyone' },
                ...(first?.facets.actors ?? []).map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `${formatCount(a.entries)} entries`,
                })),
              ]}
            />
          )}
          <Select
            aria-label="Category"
            className="w-44"
            value={group}
            onValueChange={setGroup}
            options={[
              { value: ALL, label: 'All activity' },
              ...(first?.facets.actions ?? []).map((g) => ({
                value: g.group,
                label: groupLabel(g.group),
                description: `${formatCount(g.entries)} entries`,
              })),
            ]}
          />
          <SegmentedControl<Period>
            aria-label="Time period"
            value={period}
            onValueChange={setPeriod}
            options={[
              { value: '24h', label: '24 hours' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </div>

      {query.isPending ? (
        <TimelineSkeleton />
      ) : query.isError && entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="Couldn’t load the audit log"
          description={errorMessage(query.error)}
          action={
            <Button variant="gray" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={
            filtered
              ? 'No activity matches'
              : period === 'all'
                ? 'Nothing recorded yet'
                : 'Quiet in this period'
          }
          description={
            filtered
              ? 'Try another person, category or a longer period.'
              : scope === 'platform'
                ? 'Onboarding, suspensions and platform sign-ins appear here as they happen.'
                : 'Sign-ins, role changes, publishing and grading decisions appear here as they happen.'
          }
          action={
            filtered ? (
              <Button variant="gray" onClick={reset}>
                Clear filters
              </Button>
            ) : period !== 'all' ? (
              <Button variant="gray" onClick={() => setPeriod('all')}>
                Show all time
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6" aria-busy={query.isFetching || undefined}>
          <p className="flex items-center gap-2 text-footnote text-label-secondary">
            <ShieldCheck aria-hidden className="size-3.5 text-success-text" />
            {formatCount(total)} {total === 1 ? 'entry' : 'entries'}. Entries are written by the
            server as actions happen and can’t be edited or deleted.
          </p>
          {days.map((day) => (
            <section key={day.label} aria-label={day.label} className="flex flex-col gap-2">
              <h2 className="px-1 text-footnote font-semibold text-label-secondary">{day.label}</h2>
              <ol className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {day.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} showOrg={scope === 'platform'} />
                ))}
              </ol>
            </section>
          ))}
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="gray"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Show older activity
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

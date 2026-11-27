'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { monitorKeys, useIncidents } from '../api';
import { PRIORITY_RANK, SEVERITY_LABEL, plural } from '../format';
import type { IndicatorSeverity, LiveAttempt, MonitorEvent } from '../types';
import { IndicatorRow } from './indicator-review';
import { IndicatorNotice, PriorityPill } from './live-bits';

type StatusFilter = 'open' | 'reviewed' | 'all';
const SEVERITIES: IndicatorSeverity[] = ['high', 'medium', 'low'];
const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3 };

const isOpen = (e: MonitorEvent) => !e.review || e.review.status === 'open';

/** Indicators grouped by candidate, the ones needing review first. */
export function IncidentsPanel({
  examId,
  attempts,
  canReview,
  onOpenCandidate,
}: {
  examId: string;
  attempts: LiveAttempt[];
  canReview: boolean;
  onOpenCandidate: (attemptId: string) => void;
}) {
  const query = useIncidents(examId);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [severities, setSeverities] = useState<Set<IndicatorSeverity>>(new Set(SEVERITIES));
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [clearing, setClearing] = useState<string | null>(null);

  const byAttempt = useMemo(() => new Map(attempts.map((a) => [a.attemptId, a])), [attempts]);
  const all = useMemo(() => query.data?.incidents ?? [], [query.data]);
  const counts = { open: all.filter(isOpen).length, reviewed: all.filter((e) => !isOpen(e)).length };

  const groups = useMemo(() => {
    const filtered = all.filter(
      (e) => e.severity !== 'info' && severities.has(e.severity) && (status === 'all' || (status === 'open' ? isOpen(e) : !isOpen(e))),
    );
    const map = new Map<string, { attemptId: string; events: MonitorEvent[] }>();
    for (const e of filtered) {
      const g = map.get(e.attemptId) ?? { attemptId: e.attemptId, events: [] };
      g.events.push(e);
      map.set(e.attemptId, g);
    }
    const score = (g: { attemptId: string; events: MonitorEvent[] }) => [
      PRIORITY_RANK[byAttempt.get(g.attemptId)?.reviewPriority ?? 'none'],
      Math.max(...g.events.map((e) => SEVERITY_RANK[e.severity] ?? 0)),
      g.events.filter(isOpen).length,
    ];
    return [...map.values()].sort((a, b) => {
      const [pa, sa, oa] = score(a);
      const [pb, sb, ob] = score(b);
      return pb! - pa! || sb! - sa! || ob! - oa! || a.events[0]!.candidate.name.localeCompare(b.events[0]!.candidate.name);
    });
  }, [all, severities, status, byAttempt]);

  const toggleSeverity = (s: IndicatorSeverity) =>
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next.size ? next : new Set(SEVERITIES);
    });

  const clearGroup = async (attemptId: string, events: MonitorEvent[]) => {
    const open = events.filter(isOpen);
    const name = open[0]?.candidate.name ?? 'this candidate';
    const ok = await confirm({
      title: `Mark ${plural(open.length, 'indicator')} as no concern?`,
      description: `For ${name}. Do this only after checking them: each one is recorded with your name.`,
      confirmLabel: 'Mark as no concern',
    });
    if (!ok) return;
    setClearing(attemptId);
    let failed = 0;
    for (const e of open) {
      try {
        await api.patch(`/monitoring/events/${e.id}/review`, { status: 'no_concern', note: '' });
      } catch {
        failed++;
      }
    }
    setClearing(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: monitorKeys.incidents(examId) }),
      qc.invalidateQueries({ queryKey: monitorKeys.live(examId) }),
      qc.invalidateQueries({ queryKey: monitorKeys.timeline(examId, attemptId) }),
    ]);
    if (failed) toast.error(`${plural(failed, 'indicator')} couldn’t be saved`, { description: 'Try those again from the list.' });
    else toast.success(`Marked ${plural(open.length, 'indicator')} as no concern`);
  };

  return (
    <div className="flex flex-col gap-4">
      <IndicatorNotice />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Review status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'open', label: `To review ${counts.open}` },
            { value: 'reviewed', label: `Reviewed ${counts.reviewed}` },
            { value: 'all', label: 'All' },
          ]}
        />
        <div role="group" aria-label="Severity" className="flex items-center gap-1.5">
          {SEVERITIES.map((s) => {
            const on = severities.has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSeverity(s)}
                className={cn(
                  'h-7 rounded-full px-3 text-subheadline font-medium transition-colors',
                  on ? 'bg-fill-strong text-label' : 'bg-transparent text-label-secondary ring-1 ring-inset ring-separator hover:text-label',
                )}
              >
                {SEVERITY_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>

      {query.isPending ? (
        <SkeletonRows rows={4} />
      ) : query.isLoadingError ? (
        <EmptyState size="sm" title="Couldn’t load indicators" description={errorMessage(query.error)} action={<Button onClick={() => query.refetch()}>Try again</Button>} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={status === 'open' && all.length ? 'Everything is reviewed' : 'No indicators'}
          description={
            status === 'open' && all.length
              ? 'New indicators appear here as candidates’ browsers report them.'
              : 'Window switches, pastes, full-screen exits and other browser signals appear here as they happen.'
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface">
          {groups.map((g) => {
            const first = g.events[0]!;
            const attempt = byAttempt.get(g.attemptId);
            const open = g.events.filter(isOpen).length;
            return (
              <li key={g.attemptId} className="px-4 pb-1 pt-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3">
                  <Avatar name={first.candidate.name} size="md" />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenCandidate(g.attemptId)}
                      className="rounded-sm text-left text-headline text-label hover:underline"
                    >
                      {first.candidate.name}
                    </button>
                    <p className="flex flex-wrap gap-x-3 text-footnote text-label-secondary tabular-nums">
                      {first.candidate.rollNumber && <span>{first.candidate.rollNumber}</span>}
                      <span>{open ? `${open} to review` : 'All reviewed'}</span>
                      {open !== g.events.length && <span>{g.events.length} shown</span>}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {attempt && <PriorityPill priority={attempt.reviewPriority} />}
                    {canReview && open > 1 && (
                      <Button size="sm" variant="ghost" loading={clearing === g.attemptId} onClick={() => void clearGroup(g.attemptId, g.events)}>
                        All no concern
                      </Button>
                    )}
                    <Button size="sm" variant="gray" onClick={() => onOpenCandidate(g.attemptId)}>
                      Timeline
                    </Button>
                  </div>
                </div>
                <ul className="divide-y divide-separator">
                  {g.events.map((e) => (
                    <IndicatorRow key={e.id} examId={examId} event={e} canReview={canReview} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import { ChevronDown, Search, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/cn';
import { count, duration, LEVEL_LABEL, LEVEL_TONE, PRIORITY_LABEL, PRIORITY_TONE, provenanceLine } from '../format';
import type { IntegrityOverview, OverviewAttempt, ReviewPriority } from '../types';
import { CompositionBar } from './composition-bar';

const PRIORITIES: ReviewPriority[] = ['high', 'medium', 'low', 'none'];
/** One tick per attempt: carmine to review first, gold worth a look, graphite for minor signals, pale graphite for nothing. */
const PRIORITY_FILL: Record<ReviewPriority, string> = {
  high: 'var(--data-1)',
  medium: 'var(--data-3)',
  low: 'var(--data-2)',
  none: 'var(--data-5)',
};
/** Tick height also encodes priority, so the strip never relies on colour alone. */
const TICK_HEIGHT: Record<ReviewPriority, string> = { high: 'h-7', medium: 'h-5', low: 'h-4', none: 'h-3' };

export function OverviewPanel({
  data,
  onReplay,
  onOpenPair,
}: {
  data: IntegrityOverview;
  onReplay: (answerId: string) => void;
  onOpenPair: (a: string, b: string) => void;
}) {
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.attempts.filter(
      (a) =>
        (filter === 'all' || a.priority !== 'none') &&
        (!q || a.candidate.name.toLowerCase().includes(q) || (a.candidate.rollNumber ?? '').toLowerCase().includes(q)),
    );
  }, [data.attempts, filter, query]);

  if (data.totals.attempts === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title="No attempts yet"
        description="As candidates work, how their answers were entered and how the exam tab was used appear here for review."
      />
    );
  }

  const { byPriority } = data.totals;
  const needsReview = data.totals.attempts - byPriority.none;

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="review-first">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          {needsReview === 0 ? (
            <h2 id="review-first" className="text-title-3 text-label">
              Nothing needs review in {count(data.totals.attempts, 'attempt')}
            </h2>
          ) : (
            <h2 id="review-first" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="numeral text-[3.5rem] leading-none text-label">{byPriority.high}</span>
              <span className="text-title-3 text-label">to review first, of {count(data.totals.attempts, 'attempt')}</span>
            </h2>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-subheadline text-label-secondary" data-numeric>
            <span>{count(data.totals.openIndicators, 'open indicator')}</span>
            <span>{count(data.totals.answersWithPastes, 'written answer')} with pastes</span>
            <span>{count(data.totals.flaggedPairs, 'similar pair')}</span>
          </p>
        </div>
        <div
          role="img"
          aria-label={PRIORITIES.map((p) => `${PRIORITY_LABEL[p]}: ${byPriority[p]}`).join(', ')}
          className="mt-5 flex h-7 w-full items-end justify-between gap-px border-b pb-px"
        >
          {PRIORITIES.flatMap((p) =>
            Array.from({ length: byPriority[p] }, (_, i) => (
              <span key={`${p}-${i}`} className={cn('w-[3px] min-w-px shrink rounded-t-[1px]', TICK_HEIGHT[p])} style={{ background: PRIORITY_FILL[p] }} />
            )),
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {PRIORITIES.map((p) => (
            <li key={p} className="flex items-center gap-1.5 text-subheadline text-label-secondary">
              <span aria-hidden className="h-3 w-[3px] rounded-[1px]" style={{ background: PRIORITY_FILL[p] }} />
              {PRIORITY_LABEL[p]}
              <span className="font-medium tabular-nums text-label">{byPriority[p]}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          aria-label="Which attempts to show"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'review', label: `Needs review (${needsReview})` },
            { value: 'all', label: `Everyone (${data.totals.attempts})` },
          ]}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a candidate"
          aria-label="Find a candidate by name or roll number"
          leading={<Search />}
          containerClassName="sm:w-64"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<ShieldCheck />}
          title={query ? 'No candidate matches' : 'Nothing needs review'}
          description={query ? 'Try another name or roll number.' : 'No attempt has an indicator worth a reviewer’s time. Switch to Everyone to see every attempt.'}
        />
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl bg-surface">
          {rows.map((row) => (
            <AttemptRow
              key={row.candidate.attemptId}
              row={row}
              open={openId === row.candidate.attemptId}
              onToggle={() => setOpenId((id) => (id === row.candidate.attemptId ? null : row.candidate.attemptId))}
              onReplay={onReplay}
              onOpenPair={onOpenPair}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttemptRow({
  row,
  open,
  onToggle,
  onReplay,
  onOpenPair,
}: {
  row: OverviewAttempt;
  open: boolean;
  onToggle: () => void;
  onReplay: (answerId: string) => void;
  onOpenPair: (a: string, b: string) => void;
}) {
  const active = row.reasons.filter((r) => !r.cleared);
  const top = active[0] ?? row.reasons[0];
  const panelId = `attempt-${row.candidate.attemptId}`;

  return (
    <li className="border-b border-separator last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-fill-secondary focus-visible:-outline-offset-2"
      >
        <Avatar name={row.candidate.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-label">{row.candidate.name}</span>
            {row.candidate.rollNumber && <span className="shrink-0 text-footnote text-label-tertiary">{row.candidate.rollNumber}</span>}
            {row.status !== 'submitted' && (
              <Badge size="sm" tone="success" dot>
                In progress
              </Badge>
            )}
          </span>
          <span className="truncate text-subheadline text-label-secondary">
            {top ? top.text : 'No indicators'}
            {active.length > 1 && <span className="ml-2 text-label-tertiary">+{active.length - 1} more</span>}
          </span>
        </span>
        <Badge tone={PRIORITY_TONE[row.priority]} dot className="hidden shrink-0 sm:inline-flex">
          {PRIORITY_LABEL[row.priority]}
        </Badge>
        <StatusDot tone={PRIORITY_TONE[row.priority]} className="sm:hidden" />
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-label-tertiary transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={panelId}>
          <AttemptDetail row={row} onReplay={onReplay} onOpenPair={onOpenPair} />
        </div>
      )}
    </li>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg bg-bg px-3 py-2.5">
      <span className="text-footnote text-label-secondary">{label}</span>
      <span className="mt-0.5 text-callout font-medium tabular-nums text-label">{value}</span>
      {hint && <span className="text-footnote text-label-tertiary">{hint}</span>}
    </div>
  );
}

function AttemptDetail({
  row,
  onReplay,
  onOpenPair,
}: {
  row: OverviewAttempt;
  onReplay: (answerId: string) => void;
  onOpenPair: (a: string, b: string) => void;
}) {
  const cleared = row.incidents.review.no_concern;
  return (
    <div className="flex flex-col gap-5 px-4 pb-5 pl-4 sm:pl-[3.75rem]">
      {row.reasons.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Reasons">
          {row.reasons.map((reason, i) => (
            <li key={i} className={cn('flex gap-3', reason.cleared && 'opacity-60')}>
              <StatusDot tone={LEVEL_TONE[reason.level]} className="mt-2" />
              <div className="min-w-0">
                <p className="text-callout text-label">
                  {reason.text}
                  <span className="ml-2 text-footnote text-label-tertiary">{LEVEL_LABEL[reason.level]}</span>
                  {reason.cleared && (
                    <Badge size="sm" tone="success" className="ml-2 align-middle">
                      Cleared by a reviewer
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-subheadline text-label-secondary">
                  <span className="font-medium text-label-secondary">Could also be: </span>
                  {reason.innocent}
                </p>
                {reason.ref?.answerId && (
                  <Button variant="plain" size="sm" className="-ml-2.5 mt-1" onClick={() => onReplay(reason.ref!.answerId!)}>
                    Replay how it was written
                  </Button>
                )}
                {reason.ref?.otherAttemptId && (
                  <Button variant="plain" size="sm" className="-ml-2.5 mt-1" onClick={() => onOpenPair(row.candidate.attemptId, reason.ref!.otherAttemptId!)}>
                    Compare the two attempts
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-label-secondary">No indicators for this attempt.</p>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Fact label="Left the exam tab" value={row.focus.count ? `${count(row.focus.count, 'time')}` : 'Never'} hint={row.focus.count ? `${duration(row.focus.totalMs)} in total` : undefined} />
        <Fact
          label="Offline"
          value={row.offline.intervals.length ? duration(row.offline.totalMs) : 'Never'}
          hint={row.offline.intervals.length ? count(row.offline.intervals.length, 'interruption') : undefined}
        />
        <Fact label="Device switches" value={String(row.deviceSwitches)} />
        <Fact
          label="Indicators"
          value={`${row.incidents.review.open} open`}
          hint={cleared ? `${cleared} cleared` : row.incidents.review.escalated ? `${row.incidents.review.escalated} escalated` : undefined}
        />
      </div>

      {row.written.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-footnote font-medium text-label-secondary">Written answers</h4>
          <ul className="flex flex-col gap-2">
            {row.written.map((w) => (
              <li key={w.answerId} className="flex flex-col gap-2 rounded-lg bg-bg px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-callout text-label">{w.label}</p>
                  <p className="text-footnote text-label-secondary" data-numeric>
                    {w.summary ? provenanceLine(w.summary, w.composition) : `${count(w.chars, 'char')}, no authorship log`}
                  </p>
                </div>
                <CompositionBar composition={w.composition} size="sm" labels={false} className="w-full sm:w-32" />
                <Button size="sm" variant="tinted" disabled={!w.hasReplay} onClick={() => onReplay(w.answerId)}>
                  Replay
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

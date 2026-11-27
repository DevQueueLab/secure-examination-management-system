'use client';

import { Cpu, EyeOff, Gavel, History, ListChecks, PenLine, Send, Users, WifiOff, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { LedgerAction } from '@athena/shared';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useScoreHistory } from './api';
import { Hash, IntegrityBadge, ScoreChange } from './components/primitives';
import { fmtDateTime, fmtMarks, fmtPercent, fmtRelative, plural } from './format';
import type { HistoryEntry } from './types';

const ICON: Record<LedgerAction, LucideIcon> = {
  auto_grade: Cpu,
  manual_grade: PenLine,
  rubric_change: ListChecks,
  remedy: Users,
  dispute_resolution: Gavel,
  offline_answers_accepted: WifiOff,
  results_published: Send,
  results_unpublished: EyeOff,
};

const PART = { answer: 'answer', working: 'working' } as const;

function scopeOf(e: HistoryEntry): string {
  if (e.item) return `Question ${e.item.number}: ${e.item.title}${e.part ? `, ${PART[e.part]}` : ''}`;
  if (e.scope === 'paper') return 'Whole paper';
  return 'Everyone’s results';
}

function Value({ e }: { e: HistoryEntry }) {
  if (e.voided) return <span className="text-callout text-label-secondary">No longer counts</span>;
  if (e.next === null) return null;
  if (e.previous === null) {
    return (
      <span className="text-callout tabular-nums text-label">
        <span className="font-semibold">{fmtMarks(e.next)}</span>
        {e.partMax !== null && <span className="text-label-secondary"> of {fmtMarks(e.partMax)}</span>}
      </span>
    );
  }
  return <ScoreChange before={e.previous} after={e.next} max={e.partMax} size="sm" />;
}

/**
 * A candidate's score history, read from the hash-chained grade ledger: every mark set or changed, why,
 * by which role (never a name), and whether the chain still verifies. Quiet until results are published.
 */
export function ScoreHistory({ attemptId, className }: { attemptId: string; className?: string }) {
  const { data, isPending, error } = useScoreHistory(attemptId);
  if (isPending) {
    return (
      <Card className={cn('flex flex-col gap-3', className)}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </Card>
    );
  }
  if (error || !data || !data.published || !data.verification) return null;
  const v = data.verification;
  const entries = data.entries;

  return (
    <Card padding="none" className={cn('overflow-hidden', className)}>
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-fill text-label-secondary">
            <History aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-headline text-label">Score history</h3>
            <p className="mt-0.5 max-w-prose text-footnote text-label-secondary">
              Every change to your marks, straight from the grade ledger. Each entry is chained to the one before it, so none can be edited or removed without the check below failing.
            </p>
          </div>
        </div>
        <div className="shrink-0 self-start">
          <IntegrityBadge ok={v.intact} okLabel="Ledger verified" badLabel={`Ledger broken at #${v.brokenAtSeq ?? '?'}`} />
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-5 text-callout text-label-secondary">No marks have been recorded for this attempt yet.</p>
      ) : (
        <ol className="flex flex-col px-5 py-4">
          {entries.map((e, i) => {
            const Icon = ICON[e.action] ?? History;
            const notable = e.action === 'dispute_resolution' || e.action === 'remedy';
            return (
              <li key={e.seq} className="relative flex gap-3 pb-5 last:pb-0">
                {i < entries.length - 1 && <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-separator" />}
                <span
                  className={cn(
                    'relative grid size-7 shrink-0 place-items-center rounded-full',
                    notable ? 'bg-accent-tint text-accent-text' : 'bg-fill text-label-secondary',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-callout font-semibold text-label">
                      {e.label}
                      {e.disputeId && (
                        <Link href={`/my-disputes/${e.disputeId}`} className="ml-2 text-footnote font-medium text-accent-text hover:underline">
                          View dispute
                        </Link>
                      )}
                    </p>
                    <Value e={e} />
                  </div>
                  <p className="text-footnote text-label-secondary">{scopeOf(e)}</p>
                  {e.reason && e.action !== 'auto_grade' && <p className="whitespace-pre-wrap text-subheadline text-label">{e.reason}</p>}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
                    <span className="font-medium text-label-secondary">{e.actor}</span>
                    <time dateTime={e.at} className="tabular-nums">
                      {fmtDateTime(e.at)}
                    </time>
                    <span className="inline-flex items-center gap-1.5">
                      Entry #{e.seq}
                      <Hash value={e.hash} className="text-caption" />
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-1 border-t bg-fill-secondary px-5 py-3 text-footnote text-label-secondary sm:flex-row sm:items-center sm:justify-between">
        <span>
          Current score{' '}
          <span className="font-semibold tabular-nums text-label">
            {fmtMarks(data.attempt.score)} of {fmtMarks(data.attempt.maxScore)}
          </span>
          {data.attempt.percent !== null ? ` (${fmtPercent(data.attempt.percent)})` : ''}
        </span>
        <span>
          {v.intact ? `${plural(v.checked, 'ledger entry', 'ledger entries')} checked ${fmtRelative(v.verifiedAt)}` : 'The ledger failed verification, so these entries can’t be trusted until the exam office checks them.'}
        </span>
      </div>
    </Card>
  );
}

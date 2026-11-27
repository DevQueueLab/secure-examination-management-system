'use client';

import { Gavel, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '../format';
import type { Resolution } from '../types';
import { Hash, OutcomeBadge, ScoreChange } from './primitives';

const PART_LABEL = { answer: 'Answer', working: 'Working' } as const;

/**
 * The decision, its written reason and exactly what it changed. Score changes come from the grade
 * ledger entry the decision wrote, so what is shown here is what was recorded.
 */
export function ResolutionCard({
  resolution: r,
  audience,
  questionLabel,
  className,
  children,
}: {
  resolution: Resolution;
  audience: 'candidate' | 'staff';
  questionLabel?: string | null;
  className?: string;
  /** What the reader can do next, such as appealing, shown under the decision. */
  children?: ReactNode;
}) {
  const change = r.change;
  const scoreMoved = r.scoreBefore !== null && r.scoreAfter !== null && Math.abs(r.scoreAfter - r.scoreBefore) > 1e-9;
  const who = audience === 'candidate' ? (r.resolverRole ?? 'the exam team') : (r.resolvedBy ?? 'staff');
  return (
    <Card padding="none" className={cn('overflow-hidden', className)}>
      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-fill text-label-secondary">
              <Gavel aria-hidden className="size-4" />
            </span>
            <div>
              <h3 className="text-headline text-label">Decision</h3>
              <p className="text-footnote text-label-secondary">
                Decided by {who} on {fmtDateTime(r.resolvedAt)}
              </p>
            </div>
          </div>
          <OutcomeBadge outcome={r.outcome} label={r.outcomeLabel} />
        </div>

        <blockquote className="whitespace-pre-wrap rounded-lg bg-fill-secondary px-4 py-3 text-callout text-label">{r.note}</blockquote>

        {change?.byRemedy && (
          <p className="flex items-start gap-2 text-callout text-label">
            <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-label-secondary" />
            <span>
              Fixed for every candidate who sat this question: {change.byRemedy.summary ?? change.byRemedy.label}.
              {!scoreMoved && audience === 'candidate' ? ' You already had these marks, so your score stays the same.' : ''}
            </span>
          </p>
        )}

        {r.scoreBefore !== null && r.scoreAfter !== null ? (
          <dl className="divide-y divide-separator border-y border-separator">
            {change?.part && change.partBefore !== null && change.partAfter !== null && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <dt className="text-subheadline text-label-secondary">
                  {questionLabel ? `${questionLabel}, ` : ''}
                  {PART_LABEL[change.part].toLowerCase()}
                </dt>
                <dd>
                  <ScoreChange before={change.partBefore} after={change.partAfter} max={change.partMax} showUnchanged />
                </dd>
              </div>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-subheadline text-label-secondary">Paper total</dt>
              <dd>
                <ScoreChange before={r.scoreBefore} after={r.scoreAfter} max={r.maxScore} showUnchanged />
              </dd>
            </div>
          </dl>
        ) : (
          audience === 'candidate' && <p className="text-footnote text-label-secondary">Any change to your marks shows here once results are published.</p>
        )}
      </div>
      {children && <div className="border-t px-5 py-4">{children}</div>}
      {change?.ledger && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-fill-secondary px-5 py-3 text-footnote text-label-secondary">
          <span>Recorded in the grade ledger as entry #{change.ledger.seq}</span>
          <Hash value={change.ledger.hash} />
        </div>
      )}
    </Card>
  );
}

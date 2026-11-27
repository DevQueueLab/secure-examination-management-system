'use client';

import { Link2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fmtDateTime, fmtRelative, plural } from '../format';
import type { ExamDisputeSummary } from '../types';
import { Hash, IntegrityBadge, ScoreChange } from './primitives';

const PART = { answer: 'answer', working: 'working' } as Record<string, string>;

/**
 * The exam's slice of the hash-chained grade ledger. Each entry's hash covers the one before it, so editing
 * or deleting any entry breaks every later link, and the check on top fails.
 */
export function LedgerPanel({ data }: { data: ExamDisputeSummary }) {
  const l = data.ledger;
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-fill text-label-secondary">
            <Link2 aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-headline text-label">Grade ledger</h3>
            <p className="mt-0.5 max-w-prose text-footnote text-label-secondary">
              Every mark on this exam is an entry chained by hash to the one before it. Change or delete any entry and every later link stops matching.
            </p>
          </div>
        </div>
        <div className="shrink-0 self-start">
          <IntegrityBadge ok={l.intact} okLabel="Chain intact" badLabel={`Broken at entry #${l.brokenAtSeq ?? '?'}`} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b bg-fill-secondary px-5 py-2.5 text-footnote text-label-secondary">
        <span>
          {plural(l.checked, 'entry', 'entries')} verified {fmtRelative(l.verifiedAt)}
        </span>
        <span>{plural(l.examEntries, 'entry', 'entries')} for this exam</span>
        {l.head && (
          <span className="inline-flex items-center gap-1.5">
            Latest #{l.head.seq} <Hash value={l.head.hash} />
          </span>
        )}
      </div>
      {data.recentLedger.length === 0 ? (
        <p className="px-5 py-5 text-callout text-label-secondary">No marks recorded yet.</p>
      ) : (
        <ol className="divide-y divide-separator">
          {data.recentLedger.map((r) => (
            <li key={r.seq} className="grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
              <span className="text-footnote font-medium tabular-nums text-label-secondary">#{r.seq}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 text-subheadline">
                  <span className="font-semibold text-label">{r.label}</span>
                  {r.candidate && <span className="text-label-secondary">{r.candidate}</span>}
                  {r.question && (
                    <span className="text-label-secondary">
                      {r.question}
                      {r.part ? `, ${PART[r.part] ?? r.part}` : ''}
                    </span>
                  )}
                </p>
                {r.reason && <p className="line-clamp-2 text-footnote text-label-secondary">{r.reason}</p>}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
                  <span className="font-medium text-label-secondary">{r.actor}</span>
                  <span className="tabular-nums">{fmtDateTime(r.at)}</span>
                  <span className="inline-flex items-center gap-1.5">
                    Previous <Hash value={r.prevHash} className="text-caption" />
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    This entry <Hash value={r.hash} className="text-caption" />
                  </span>
                </p>
              </div>
              <span className="sm:text-right">{r.next !== null ? <ScoreChange before={r.previous} after={r.next} size="sm" /> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

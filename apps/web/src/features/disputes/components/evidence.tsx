'use client';

import { LockKeyhole, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Markdown } from '@/features/workspace/components/markdown';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtDuration, fmtMarks, fmtSigned, fmtTime, plural } from '../format';
import type { Evidence, FormattedResponse } from '../types';
import { Hash, IntegrityBadge } from './primitives';

const INCIDENT_LABEL: Record<string, string> = {
  connectivity_lost: 'Connection lost',
  connectivity_restored: 'Connection restored',
  offline: 'Went offline',
  online: 'Back online',
  device_switch: 'Switched device',
  time_extended: 'Time extended',
  attempt_submitted: 'Submitted',
  attempt_auto_submitted: 'Submitted automatically',
  attempt_started: 'Started',
  attempt_resumed: 'Resumed',
};

const SUBMIT_REASON: Record<string, string> = {
  candidate: 'by the candidate',
  timer: 'when time ran out',
  proctor: 'by a proctor',
  auto: 'automatically',
};

function humanize(type: string) {
  return INCIDENT_LABEL[type] ?? type.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-subheadline font-semibold text-label">{title}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function ResponseText({ formatted }: { formatted: FormattedResponse }) {
  if (!formatted.text) return <p className="text-callout text-label-secondary">No answer was given.</p>;
  if (formatted.format === 'code') {
    return <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-footnote text-label">{formatted.text}</pre>;
  }
  if (formatted.format === 'list') {
    return (
      <ul className="flex flex-col gap-1 rounded-lg bg-fill-secondary px-3 py-2.5 text-callout text-label">
        {formatted.text.split('\n').map((line, i) => (
          <li key={i}>
            <Markdown inline>{line}</Markdown>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="rounded-lg bg-fill-secondary px-3 py-2.5 text-callout text-label">
      <Markdown inline>{formatted.text}</Markdown>
    </div>
  );
}

/**
 * The record frozen when the dispute was raised: the question as seen, the answer, the marks and rubric,
 * and for incidents the attempt's connection history. Later edits to marks cannot change it; the seal proves it.
 */
export function EvidencePanel({
  evidence: e,
  audience,
  preview = false,
  questionLabel,
  className,
}: {
  evidence: Evidence;
  audience: 'candidate' | 'staff';
  preview?: boolean;
  /** Staff number questions in paper order ("Q6"); the candidate's own paper may have shown it elsewhere. */
  questionLabel?: string | null;
  className?: string;
}) {
  const parts = e.score?.parts;
  const working = parts?.working ?? null;
  const showScores = !!e.score;
  return (
    <section className={cn('border-y border-separator', className)}>
      <div className="flex flex-col gap-3 border-b border-separator py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-fill text-label-secondary">
            <LockKeyhole aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-headline text-label">{preview ? 'What the reviewer will see' : 'Frozen record'}</h3>
            <p className="mt-0.5 text-footnote text-label-secondary">
              {preview
                ? 'This is captured and sealed the moment you submit, so later changes to marks can’t alter it.'
                : `Captured ${fmtDateTime(e.frozenAt)}, when the dispute was raised. Sealed, so later changes to marks can’t alter it.`}
            </p>
          </div>
        </div>
        {!preview && (
          <div className="shrink-0 self-start">
            <IntegrityBadge ok={e.sealIntact} okLabel="Seal intact" badLabel="Seal broken" size="sm" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 py-5">
        {e.item ? (
          <Block
            title={questionLabel ? `${questionLabel}: ${e.item.title}` : `Question ${e.item.number}: ${e.item.title}`}
            aside={<span className="shrink-0 text-footnote text-label-secondary">{`${e.item.typeLabel}, ${plural(e.item.marks + e.item.workingMarks, 'mark')}`}</span>}
          >
            {questionLabel && questionLabel !== `Q${e.item.number}` && <p className="-mt-1 text-footnote text-label-secondary">Question {e.item.number} on the candidate’s paper</p>}
            {e.item.stem ? <Markdown className="text-callout text-label">{e.item.stem}</Markdown> : null}
            {e.item.voidReason && <p className="text-footnote text-warning-text">This question no longer counts: {e.item.voidReason}</p>}
          </Block>
        ) : (
          <p className="text-callout text-label-secondary">This dispute is about the whole attempt, not one question.</p>
        )}

        {e.item && e.answer && (
          <Block title={audience === 'candidate' ? 'Your answer' : 'Candidate’s answer'} aside={e.answer.answeredAt ? <span className="text-footnote tabular-nums text-label-secondary">Saved {fmtTime(e.answer.answeredAt)}</span> : null}>
            <ResponseText formatted={e.answer.formatted} />
            {e.answer.working && (e.answer.working.text || e.answer.working.scratchPages > 0) && (
              <div className="flex flex-col gap-1">
                <p className="text-footnote font-medium text-label-secondary">Working</p>
                {e.answer.working.text && <p className="whitespace-pre-wrap rounded-lg bg-fill-secondary px-3 py-2.5 text-callout text-label">{e.answer.working.text}</p>}
                {e.answer.working.scratchPages > 0 && <p className="text-footnote text-label-secondary">{plural(e.answer.working.scratchPages, 'scratch page')} attached</p>}
              </div>
            )}
          </Block>
        )}
        {e.item && !e.answer && <p className="text-callout text-label-secondary">No answer was saved for this question.</p>}

        {e.item && (
          <Block title="Marks at the time">
            {showScores && parts ? (
              <table className="w-full text-callout">
                <tbody className="divide-y divide-separator">
                  <tr>
                    <th scope="row" className="py-1.5 text-left font-normal text-label">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        Answer
                        {parts.answer.auto && <span className="text-footnote text-label-secondary">marked automatically</span>}
                      </span>
                    </th>
                    <td className="py-1.5 text-right tabular-nums text-label">
                      {fmtMarks(parts.answer.score)} <span className="text-label-secondary">/ {fmtMarks(parts.answer.max)}</span>
                    </td>
                  </tr>
                  {working && (
                    <tr>
                      <th scope="row" className="py-1.5 text-left font-normal text-label">
                        Working
                      </th>
                      <td className="py-1.5 text-right tabular-nums text-label">
                        {fmtMarks(working.score)} <span className="text-label-secondary">/ {fmtMarks(working.max)}</span>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row" className="py-1.5 text-left font-semibold text-label">
                      This question
                    </th>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-label">
                      {fmtMarks(e.score?.item)} <span className="font-normal text-label-secondary">/ {fmtMarks(e.item.marks + e.item.workingMarks)}</span>
                    </td>
                  </tr>
                  {e.attempt.score !== undefined && e.attempt.score !== null && (
                    <tr>
                      <th scope="row" className="py-1.5 text-left font-normal text-label-secondary">
                        Whole paper
                      </th>
                      <td className="py-1.5 text-right tabular-nums text-label-secondary">
                        {fmtMarks(e.attempt.score)} / {fmtMarks(e.attempt.maxScore)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <p className="text-callout text-label-secondary">Marks are not shown until results are published.</p>
            )}
          </Block>
        )}

        {e.rubric.length > 0 && (
          <Block title="Rubric applied">
            <ul className="flex flex-col gap-1">
              {e.rubric.map((r, i) => (
                <li key={r.id ?? i} className="flex items-baseline gap-3 text-callout">
                  <span className={cn('w-10 shrink-0 font-semibold tabular-nums', r.points < 0 ? 'text-danger-text' : 'text-label')}>{fmtSigned(r.points)}</span>
                  <span className="text-label">
                    {r.label}
                    {r.target === 'working' && <span className="text-label-secondary"> (working)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {e.feedback && (
          <Block title="Grader’s feedback">
            <p className="whitespace-pre-wrap text-callout text-label">{e.feedback}</p>
          </Block>
        )}

        {e.correctAnswer && (
          <Block title="Answer key">
            <div className="text-callout text-label">
              <Markdown inline>{e.correctAnswer}</Markdown>
            </div>
          </Block>
        )}

        {(e.connectivity || e.incidents.length > 0) && (
          <Block title="Attempt history">
            {e.connectivity && (
              <p className="flex items-start gap-2 text-callout text-label">
                <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-label-secondary" />
                <span>
                  {e.connectivity.offlineSpells
                    ? `Offline ${plural(e.connectivity.offlineSpells, 'time')}, ${fmtDuration(e.connectivity.offlineSeconds)} in all.`
                    : 'No time offline was recorded.'}{' '}
                  {e.connectivity.deviceSwitches ? `${plural(e.connectivity.deviceSwitches, 'device switch', 'device switches')}. ` : ''}
                  {e.connectivity.timeExtendedSeconds ? `Given ${fmtDuration(e.connectivity.timeExtendedSeconds)} extra. ` : ''}
                  {e.connectivity.submitReason ? `Submitted ${SUBMIT_REASON[e.connectivity.submitReason] ?? e.connectivity.submitReason}.` : ''}
                </span>
              </p>
            )}
            {e.incidents.length > 0 && (
              <ol className="flex flex-col gap-1">
                {e.incidents.slice(0, 12).map((ev, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-subheadline">
                    <span className="w-16 shrink-0 tabular-nums text-label-secondary">{fmtTime(ev.at)}</span>
                    <span className={cn('text-label', ev.severity === 'high' || ev.severity === 'critical' ? 'font-semibold' : '')}>{humanize(ev.type)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Block>
        )}

        {e.appealOf && (
          <Block title="Decision under appeal">
            <p className="text-callout text-label">{e.appealOf.note ?? 'No reason was recorded.'}</p>
          </Block>
        )}

        {audience === 'staff' && e.grading && e.grading.graders.length > 0 && (
          <p className="text-footnote text-label-secondary">
            Graded by {e.grading.graders.map((g) => g.name).join(', ')}
            {e.grading.gradedAt ? ` on ${fmtDateTime(e.grading.gradedAt)}` : ''}
          </p>
        )}
      </div>

      {!preview && e.ledgerHead && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-separator py-3 text-footnote text-label-secondary">
          <span>Grade ledger at capture: entry #{e.ledgerHead.seq}</span>
          <Hash value={e.ledgerHead.hash} />
        </div>
      )}
    </section>
  );
}

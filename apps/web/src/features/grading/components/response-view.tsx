'use client';

import { ClipboardPaste, Clock, Flag, PenLine, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { fmtDuration, fmtMarks, fmtRelative, plural } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import type { GradeableAnswer, Provenance, QuestionAnswers } from '../types';
import { Prose } from './prose';
import { ScratchPageView } from './scratch-page';

/** "92% pasted", linked to the attempt's integrity timeline. Neutral when the answer was typed. */
export function ProvenanceChip({ provenance, href }: { provenance: Provenance; href: string }) {
  const pasted = provenance.pastedPercent ?? 0;
  const heavy = pasted >= 50;
  const detail = [
    provenance.typedPercent !== null ? `${provenance.typedPercent}% typed` : null,
    provenance.pasteCount ? plural(provenance.pasteCount, 'paste') : 'No pastes',
    provenance.largestPaste ? `largest ${provenance.largestPaste.toLocaleString()} characters` : null,
    provenance.bursts ? plural(provenance.bursts, 'burst') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Tooltip content={`${detail.charAt(0).toUpperCase()}${detail.slice(1)}. Open the integrity timeline.`}>
      <Link
        href={href}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-footnote font-medium transition-colors',
          heavy ? 'bg-warning-tint text-warning-text hover:bg-warning/15' : 'bg-fill text-label-secondary hover:bg-fill-strong hover:text-label',
        )}
      >
        <ClipboardPaste aria-hidden className="size-3" />
        {pasted > 0 ? `${pasted}% pasted` : 'Typed by hand'}
      </Link>
    </Tooltip>
  );
}

function QuestionBlock({ question }: { question: QuestionAnswers['question'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-fill-secondary">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left outline-none focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus"
      >
        <span className="text-subheadline font-semibold text-label">{question.label}</span>
        <span className="min-w-0 flex-1 truncate text-subheadline text-label-secondary">{question.title}</span>
        <span className="text-footnote font-medium text-accent-text">{open ? 'Hide question' : 'Show question'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {question.stem ? <Prose>{question.stem}</Prose> : <p className="text-callout text-label-secondary">No question text.</p>}
          {question.workingGuidance && (
            <p className="text-subheadline text-label-secondary">
              <span className="font-medium text-label">Working asked for: </span>
              {question.workingGuidance}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResponseBody({ answer }: { answer: Pick<GradeableAnswer, 'response' | 'answered'> }) {
  const r = answer.response;
  if (!answer.answered || !r.text) {
    return <div className="rounded-xl bg-fill-secondary px-4 py-8 text-center text-callout text-label-secondary">No response was submitted.</div>;
  }
  if (r.format === 'code') {
    const lines = r.text.split('\n');
    return (
      <div className="overflow-hidden rounded-xl bg-surface-sunken ring-1 ring-separator">
        {r.language && <div className="border-b px-4 py-1.5 text-caption font-medium text-label-secondary">{r.language}</div>}
        <pre className="overflow-x-auto py-3 font-mono text-[13px] leading-[1.6] text-label">
          <code className="grid grid-cols-[auto_1fr]">
            {lines.map((line, i) => (
              <span key={i} className="contents">
                <span aria-hidden className="select-none pl-4 pr-4 text-right tabular-nums text-label-quaternary">
                  {i + 1}
                </span>
                <span className="whitespace-pre pr-4">{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words rounded-xl px-0.5 font-serif text-[1.0625rem] leading-[1.7] text-label [overflow-wrap:anywhere]">{r.text}</div>
  );
}

export function ResponseView({
  examId,
  data,
  answer,
  group,
}: {
  examId: string;
  data: QuestionAnswers;
  answer: GradeableAnswer;
  /** Set when grading a group of identical answers: the candidates it covers. */
  group?: GradeableAnswer[];
}) {
  const showName = !data.anonymous && answer.candidate.name;
  return (
    <article className="flex flex-col gap-5" aria-label={group ? `${group.length} identical answers` : `Response from ${answer.candidate.label}`}>
      <QuestionBlock question={data.question} />

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {group ? (
          <div className="flex items-center gap-2">
            <Users aria-hidden className="size-4 text-label-tertiary" />
            <h2 className="text-title-3 text-label">{plural(group.length, 'identical answer')}</h2>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-title-3 text-label">{showName ? answer.candidate.name : answer.candidate.label}</h2>
            {showName && answer.candidate.rollNumber && <p className="text-footnote text-label-secondary">{answer.candidate.rollNumber}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {!group && answer.provenance && <ProvenanceChip provenance={answer.provenance} href={`/exams/${examId}/integrity?attemptId=${answer.attemptId}`} />}
          {!group && answer.flagged && (
            <Badge tone="info">
              <Flag aria-hidden /> Flagged by candidate
            </Badge>
          )}
          {!group && answer.timeSpentMs > 0 && (
            <Badge tone="neutral">
              <Clock aria-hidden /> {fmtDuration(answer.timeSpentMs)} on this question
            </Badge>
          )}
        </div>
      </header>

      {group && (
        <p className="-mt-2 text-subheadline text-label-secondary">
          The same decision is recorded for {group.map((g) => g.candidate.label).join(', ')}. Each gets its own ledger entry.
        </p>
      )}

      <section aria-label="Response" className="flex flex-col gap-2">
        <ResponseBody answer={answer} />
      </section>

      {!group && answer.working && (answer.working.text.trim() || answer.working.scratchPages.length > 0) && (
        <section aria-labelledby={`working-${answer.id}`} className="flex flex-col gap-3 border-t pt-5">
          <h3 id={`working-${answer.id}`} className="flex items-center gap-1.5 text-headline text-label">
            <PenLine aria-hidden className="size-4 text-label-tertiary" /> Working
          </h3>
          {answer.working.text.trim() && (
            <div className="whitespace-pre-wrap break-words rounded-xl bg-fill-secondary px-4 py-3 font-mono text-subheadline leading-relaxed text-label">{answer.working.text}</div>
          )}
          {answer.working.scratchPages.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {answer.working.scratchPages.map((p, i) => (
                <ScratchPageView key={p.pageKey} page={p} index={i} />
              ))}
            </div>
          )}
        </section>
      )}

      {!group && answer.gradedAt && (
        <p className="text-footnote text-label-tertiary">
          <Meta
            items={[
              `Last graded ${fmtRelative(answer.gradedAt)}${answer.gradedBy ? ` by ${answer.gradedBy}` : ''}`,
              <span key="s" className="tabular-nums">
                {fmtMarks(answer.itemScore)} of {fmtMarks(answer.itemMax)}
              </span>,
            ]}
          />
        </p>
      )}
    </article>
  );
}

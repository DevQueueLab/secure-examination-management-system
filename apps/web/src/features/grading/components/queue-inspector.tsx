'use client';

import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { plural } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import { useQuestionAnswers } from '../api';
import type { GradeableAnswer, QueueQuestion } from '../types';
import { Prose, stemText } from './prose';

const ungraded = (a: GradeableAnswer) => !a.parts.answer.graded || (a.parts.working !== null && !a.parts.working.graded);

/**
 * The queue's working surface: the next script waiting for a grader, read in place, with the question above it.
 * Starting from here opens the grader on that question, where the keyboard paths take over.
 */
export function QueueInspector({ examId, question, onOpen }: { examId: string; question: QueueQuestion; onOpen: () => void }) {
  const { data, isPending, error } = useQuestionAnswers(examId, question.questionId);
  const next = data?.answers.find((a) => a.answered && ungraded(a)) ?? data?.answers.find(ungraded) ?? null;
  const r = next?.response;
  return (
    <aside aria-labelledby="queue-inspector-heading" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24 lg:border-l lg:border-separator lg:pl-8">
      <div>
        <h2 id="queue-inspector-heading" className="flex gap-2.5 text-headline text-label">
          <span className="tabular-nums">{question.label}</span>
          <span className="min-w-0">{question.title}</span>
        </h2>
        <p className="mt-0.5 text-footnote text-label-secondary">
          <Meta items={[question.typeLabel, question.remaining ? `${plural(question.remaining, 'answer')} to grade` : `All ${question.total} graded`]} />
        </p>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading the next script">
          <SkeletonText lines={3} />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : error || !data ? (
        <p className="text-subheadline text-label-secondary">The next script couldn’t be loaded here. Open the question to grade it.</p>
      ) : (
        <>
          {data.question.stem && (
            <div className="line-clamp-6 text-label-secondary">
              <Prose className="text-callout">{stemText(data.question.stem)}</Prose>
            </div>
          )}
          {next ? (
            <div className="flex flex-col gap-2">
              <p className="text-footnote font-medium text-label-secondary">
                <Meta items={[next.candidate.label, next.flagged ? 'Flagged by the candidate' : null]} />
              </p>
              {!next.answered || !r?.text ? (
                <p className="text-callout text-label-tertiary">No answer</p>
              ) : (
                <div className={cn('max-h-72 overflow-y-auto rounded-xl bg-surface p-4', r.format === 'code' && 'font-mono text-[13px] leading-relaxed')}>
                  <p className="whitespace-pre-wrap break-words text-callout text-label">{r.text}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-subheadline text-label-secondary">Every answer to this question is graded.</p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="filled" onClick={onOpen}>
          {question.remaining ? 'Start grading' : 'Open question'}
        </Button>
        <span className="text-footnote text-label-secondary">In the grader, J and K step through answers, 1 to 9 tick criteria and Ctrl+Enter saves.</span>
      </div>
    </aside>
  );
}

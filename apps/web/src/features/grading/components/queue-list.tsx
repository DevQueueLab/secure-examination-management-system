'use client';

import { CircleCheck, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { cn } from '@/lib/cn';
import { fmtMarks, plural } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import type { GradingQueue, QueueQuestion } from '../types';
import { QueueInspector } from './queue-inspector';

const PART_NAME = { answer: 'Answer', working: 'Working' } as const;

function QuestionRow({ q, onOpen, onRubric }: { q: QueueQuestion; onOpen: () => void; onRubric: () => void }) {
  const done = q.total > 0 && q.remaining === 0;
  return (
    <li className="group relative flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-fill-secondary sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-px inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md bg-fill px-1.5 text-subheadline font-semibold tabular-nums text-label">{q.label}</span>
        <div className="min-w-0">
          {/* The row's main link covers the row; the rubric link sits above it. */}
          <button type="button" onClick={onOpen} className="text-left text-callout font-medium text-label outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-none focus-visible:after:outline-[length:var(--focus-width)] focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus">
            {q.title}
          </button>
          <p className="mt-0.5 text-footnote text-label-secondary">
            <Meta items={[q.typeLabel, q.sectionTitle, q.parts.map((p) => `${PART_NAME[p.part]} ${fmtMarks(p.max)}`).join(' + ')]} />
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 pl-11 sm:pl-0">
        <div className="flex w-40 flex-col gap-1.5">
          <span className="text-footnote tabular-nums text-label-secondary">
            {q.total === 0 ? 'No submissions yet' : done ? `All ${q.total} graded` : `${q.graded} of ${q.total} graded`}
          </span>
          <MarksRule settle size="sm" marker="fill" labels="none" tone={done ? 'gold' : 'accent'} value={q.graded} max={Math.max(1, q.total)} label={`${q.label} grading progress`} valueText={`${q.graded} of ${q.total}`} />
        </div>
        <button
          type="button"
          onClick={onRubric}
          className={cn(
            'relative z-10 inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-footnote font-medium outline-none transition-colors',
            'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus',
            q.rubricCount ? 'bg-fill text-label-secondary hover:bg-fill-strong hover:text-label' : 'bg-warning-tint text-warning-text hover:bg-warning/15',
          )}
        >
          <ListChecks aria-hidden className="size-3" />
          {q.rubricCount ? plural(q.rubricCount, 'criterion', 'criteria') : 'Add a rubric'}
        </button>
      </div>
    </li>
  );
}

export function QueueList({
  examId,
  queue,
  onOpen,
  onRubric,
}: {
  examId: string;
  queue: GradingQueue;
  onOpen: (questionId: string) => void;
  onRubric: (questionId: string) => void;
}) {
  if (!queue.questions.length) {
    return (
      <EmptyState
        icon={<ListChecks />}
        title="Nothing here needs a human grader"
        description="Every question on this paper is marked automatically, so scores are ready as soon as candidates submit."
        action={
          <Link href={`/exams/${examId}/results`} className="inline-flex h-9 items-center rounded-lg bg-accent-tint px-3.5 text-callout font-medium text-accent-text hover:bg-accent/15">
            Go to results
          </Link>
        }
      />
    );
  }
  const allDone = queue.progress.total > 0 && queue.progress.remaining === 0;
  const blanks = queue.questions.reduce((s, q) => s + q.blank, 0);
  const focus = queue.questions.find((q) => q.remaining > 0) ?? queue.questions[0]!;
  return (
    <div className="flex flex-col gap-4">
      {allDone && (
        <EmptyState
          art="laurel"
          icon={<CircleCheck />}
          surface={false}
          title="Every submitted answer is graded"
          description={queue.exam.resultsStatus === 'published' ? 'Results are already published; new grades reach candidates straight away.' : 'Review the results before publishing them.'}
          action={
            <Link href={`/exams/${examId}/results`} className="inline-flex h-11 items-center rounded-lg bg-accent px-4 text-callout font-medium text-on-accent outline-none hover:bg-accent-hover focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus sm:h-9">
              Review results
            </Link>
          }
        />
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <ul className="divide-y divide-separator border-y border-separator" aria-label="Questions to grade">
            {queue.questions.map((q) => (
              <QuestionRow key={q.questionId} q={q} onOpen={() => onOpen(q.questionId)} onRubric={() => onRubric(q.questionId)} />
            ))}
          </ul>
          <p className="px-1 text-footnote text-label-secondary">
            <Meta
              items={[
                plural(queue.submitted, 'submission'),
                queue.inProgress ? `${queue.inProgress} still writing` : null,
                blanks ? plural(blanks, 'empty written answer') : null,
                queue.anonymous ? 'Names are hidden while grading' : null,
              ]}
            />
          </p>
        </div>
        {/* The page is a working surface: the next script is open beside the list. Phones keep the plain list. */}
        <div className="max-lg:hidden">
          <QueueInspector examId={examId} question={focus} onOpen={() => onOpen(focus.questionId)} />
        </div>
      </div>
    </div>
  );
}

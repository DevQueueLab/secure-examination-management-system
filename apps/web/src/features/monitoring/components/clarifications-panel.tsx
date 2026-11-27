'use client';

import { MessageCircleQuestionMark, Users } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/input';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAnswerClarification, useClarifications } from '../api';
import { useServerNow } from '../clock';
import { ago, clockTime } from '../format';
import type { StaffClarification } from '../types';

const QUICK_REPLIES = [
  'Please answer the question as it is written. There is no error in it.',
  'I can’t give hints about the answer, but the question is correct as written.',
  'Make the most reasonable standard assumption and state it in your answer.',
];

function Composer({ examId, c, onDone }: { examId: string; c: StaffClarification; onDone?: () => void }) {
  const [answer, setAnswer] = useState(c.answer ?? '');
  const [broadcast, setBroadcast] = useState(c.answer ? c.broadcast : true);
  const [error, setError] = useState<string | null>(null);
  const send = useAnswerClarification(examId);

  const submit = async () => {
    if (!answer.trim()) {
      setError('Write an answer first');
      return;
    }
    try {
      await send.mutateAsync({ id: c.id, answer: answer.trim(), broadcast });
      toast.success(broadcast ? 'Answer sent to every candidate' : `Answer sent to ${c.candidate.name}`);
      onDone?.();
    } catch (err) {
      setError(isApiError(err) && err.fields.answer ? err.fields.answer : errorMessage(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-1.5" aria-label="Quick replies">
        {QUICK_REPLIES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setAnswer(r)}
            className="h-7 max-w-full truncate rounded-full bg-fill px-3 text-subheadline text-label-secondary transition-colors hover:bg-fill-strong hover:text-label"
          >
            {r.split('.')[0]}
          </button>
        ))}
      </div>
      <Textarea
        aria-label={`Answer to ${c.candidate.name}`}
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        maxLength={2000}
        placeholder="Write your answer…"
        aria-invalid={!!error || undefined}
        className="min-h-16"
      />
      {error && (
        <p role="alert" className="text-footnote font-medium text-danger-text">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Switch
          size="sm"
          checked={broadcast}
          onCheckedChange={setBroadcast}
          label={<span className="text-callout">Broadcast to everyone (recommended for fairness)</span>}
          description={broadcast ? 'Every candidate sees the question and your answer. The asker’s name is never shown.' : `Only ${c.candidate.name} sees your answer.`}
          className="sm:order-none"
        />
        <div className="flex shrink-0 gap-2 sm:ml-4">
          {onDone && c.answer && (
            <Button variant="gray" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="filled" loading={send.isPending}>
            {broadcast ? 'Send to everyone' : 'Send privately'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ClarificationCard({ examId, c, canAnswer, now }: { examId: string; c: StaffClarification; canAnswer: boolean; now: number }) {
  const [editing, setEditing] = useState(false);
  const waiting = !c.answer;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <Avatar name={c.candidate.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-headline text-label">{c.candidate.name}</span>
            {c.candidate.rollNumber && <span className="text-footnote text-label-secondary tabular-nums">{c.candidate.rollNumber}</span>}
            <time dateTime={c.createdAt} title={clockTime(c.createdAt, true)} className={cn('ml-auto text-footnote tabular-nums', waiting ? 'font-medium text-warning-text' : 'text-label-secondary')}>
              {waiting ? `waiting ${ago(c.createdAt, now).replace(' ago', '')}` : ago(c.createdAt, now)}
            </time>
          </div>
          {c.item && (
            <p className="mt-0.5 text-footnote text-label-secondary">
              About question {c.item.number} on their paper{c.item.questionTitle ? `, “${c.item.questionTitle}”` : ''}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-body text-label">{c.question}</p>
        </div>
      </div>
      <div className="sm:pl-11">
        {waiting || editing ? (
          canAnswer ? (
            <Composer examId={examId} c={c} onDone={editing ? () => setEditing(false) : undefined} />
          ) : (
            <p className="text-subheadline text-label-secondary">Waiting for a proctor or examiner to answer.</p>
          )
        ) : (
          <div className="flex flex-col gap-1.5 rounded-lg bg-fill-secondary px-3.5 py-3">
            <p className="whitespace-pre-wrap text-callout text-label">{c.answer}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-label-secondary">
              {c.broadcast ? (
                <Badge tone="info" size="sm">
                  <Users aria-hidden />
                  Everyone
                </Badge>
              ) : (
                <Badge size="sm">Private</Badge>
              )}
              {c.answeredBy && <span>{c.answeredBy.name}</span>}
              {c.answeredAt && <time dateTime={c.answeredAt}>{clockTime(c.answeredAt)}</time>}
              {canAnswer && (
                <Button variant="plain" size="sm" className="ml-auto -my-1" onClick={() => setEditing(true)}>
                  Edit answer
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** Candidate questions: unanswered first (oldest first, so nobody waits longest), then the answered ones. */
export function ClarificationsPanel({ examId, canAnswer }: { examId: string; canAnswer: boolean }) {
  const query = useClarifications(examId);
  const now = useServerNow();
  if (query.isPending) return <SkeletonRows rows={3} />;
  if (query.isLoadingError)
    return <EmptyState size="sm" title="Couldn’t load clarifications" description={errorMessage(query.error)} action={<Button onClick={() => query.refetch()}>Try again</Button>} />;
  const items = query.data ?? [];
  const waiting = items.filter((c) => !c.answer);
  const answered = items.filter((c) => c.answer);
  if (!items.length)
    return (
      <EmptyState
        icon={<MessageCircleQuestionMark />}
        title="No questions yet"
        description="When a candidate asks for a clarification it appears here, and you get a notification on this page."
      />
    );
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
        <h3 id="waiting-heading" className="px-1 text-headline text-label">
          Waiting for an answer <span className="text-label-secondary tabular-nums">{waiting.length}</span>
        </h3>
        {waiting.length ? (
          <ol className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface">
            {waiting.map((c) => (
              <ClarificationCard key={c.id} examId={examId} c={c} canAnswer={canAnswer} now={now} />
            ))}
          </ol>
        ) : (
          <p className="rounded-xl bg-surface px-5 py-4 text-callout text-label-secondary">Every question has an answer.</p>
        )}
      </section>
      {answered.length > 0 && (
        <section aria-labelledby="answered-heading" className="flex flex-col gap-3">
          <h3 id="answered-heading" className="px-1 text-headline text-label">
            Answered <span className="text-label-secondary tabular-nums">{answered.length}</span>
          </h3>
          <ol className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface">
            {answered.map((c) => (
              <ClarificationCard key={c.id} examId={examId} c={c} canAnswer={canAnswer} now={now} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

'use client';

import { QUESTION_TYPE_META, type QuestionType } from '@athena/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { GroupedList, GroupedListItem } from '@/components/ui/grouped-list';
import { Textarea } from '@/components/ui/input';
import { Section } from '@/components/ui/section';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMarks, fmtSigned, plural } from '../analytics/format';
import { LoadError } from '../authoring/components/load-error';
import { Prose } from '../grading/components/prose';
import { formatDuration } from '../monitoring/format';

// ---- API contract: GET /attempts/exams/:examId/offline-journals (see the API's offline-journal.service.ts)

/** Marks for one part of a question: the answer, or the method marks for working. Null awaits a grader. */
interface ScorePart {
  score: number | null;
  max: number;
}

interface AnswerVersion {
  revision: number;
  text: string | null;
  format: 'text' | 'code' | 'choice' | 'list';
  language?: string;
  working: string | null;
  scratchPages: number;
  parts: { answer: ScorePart; working: ScorePart | null };
  score: number | null;
}

interface HeldAnswer {
  itemId: string;
  number: number;
  type: QuestionType;
  stem: string;
  marks: number;
  voided: boolean;
  counted: AnswerVersion & { savedAt: string | null };
  held: AnswerVersion & { changedAt: string | null };
  /** Change to this question's score if accepted; a range while a grader still has to mark a part. */
  effect: { min: number; max: number };
}

export interface HeldJournal {
  attemptId: string;
  candidate: { id: string; name: string; email: string };
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  lastSeenAt: string | null;
  journal: {
    sealedAt: string | null;
    lastServerSync: string | null;
    receivedAt: string | null;
    graceMinutes: number;
    entries: number;
    invalid: number;
  };
  maxScore: number;
  scoreNow: { score: number; pendingItems: number };
  scoreIfAccepted: { score: number; pendingItems: number };
  answers: HeldAnswer[];
}

interface JournalDecision {
  accepted: boolean;
  applied: number;
  score: number | null;
  maxScore: number;
}

export const offlineHeldKeys = {
  exam: (examId: string) => ['attempts', 'offline-journals', examId] as const,
};

function useHeldJournals(examId: string) {
  return useQuery({
    queryKey: offlineHeldKeys.exam(examId),
    queryFn: async () =>
      (await api.get<{ items: HeldJournal[] }>(`/attempts/exams/${examId}/offline-journals`)).items,
    staleTime: 10_000,
  });
}

function useJournalDecision(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      attemptId,
      accept,
      note,
    }: {
      attemptId: string;
      accept: boolean;
      note: string;
    }) =>
      api.post<JournalDecision>(`/attempts/${attemptId}/offline-journal/decision`, {
        accept,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    // Also after a failure: another examiner may have decided first, and the list should show it.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: offlineHeldKeys.exam(examId) });
      void qc.invalidateQueries({ queryKey: ['results', examId] });
      void qc.invalidateQueries({ queryKey: ['analytics', examId] });
      void qc.invalidateQueries({ queryKey: ['grading'] });
      void qc.invalidateQueries({ queryKey: ['exams', examId] });
    },
  });
}

// ---- formatting

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const dayTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** Seconds matter here: a journal sealed one second after the deadline reads differently from one sealed later. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? timeFormat.format(d)
    : dayTimeFormat.format(d);
}

const offsetMs = (iso: string, deadline: string) => Date.parse(iso) - Date.parse(deadline);

/** "6 min before the deadline", "1 s after the deadline". */
function relativeToDeadline(iso: string, deadline: string): string {
  const ms = offsetMs(iso, deadline);
  if (Math.abs(ms) < 500) return 'at the deadline';
  return `${formatDuration(Math.abs(ms))} ${ms < 0 ? 'before' : 'after'} the deadline`;
}

const marksWord = (n: number) => (Math.abs(n) === 1 ? 'mark' : 'marks');

function awaitingGrader(n: number): string {
  return n === 0
    ? 'Every question is graded'
    : `Graded questions only: ${plural(n, 'question')} ${n === 1 ? 'awaits' : 'await'} a grader`;
}

function partText(label: string, part: ScorePart): string {
  return part.score === null
    ? `${label} awaits a grader`
    : `${label} ${fmtMarks(part.score)} of ${fmtMarks(part.max)}`;
}

function scoreText({ answer, working }: AnswerVersion['parts']): string {
  if (!working)
    return answer.score === null
      ? `Awaits a grader, out of ${fmtMarks(answer.max)}`
      : `${fmtMarks(answer.score)} of ${fmtMarks(answer.max)}`;
  return `${partText('Answer', answer)}, ${partText('working', working)}`;
}

// ---- view

/**
 * Late offline answers awaiting a decision (IC-5.3). When a candidate's connection drops near the end, the
 * server submits on time with what it holds, while the browser keeps saving to a local journal and uploads it
 * on reconnecting. Those newer answers count only if an examiner accepts them here. Each held answer is shown
 * beside the one that counted, with the score either way as the API computes it. Mount next to the results
 * checklist's `offline_held` blocker.
 */
export function OfflineHeldReview({ examId }: { examId: string }) {
  const query = useHeldJournals(examId);

  return (
    <Section
      as="h3"
      title="Late offline answers"
      description="Saved on a candidate’s device after the connection dropped, and uploaded when it came back. They count only if you accept them."
    >
      {query.isPending ? (
        <div role="status" aria-label="Loading late answers" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <SkeletonRows rows={3} />
        </div>
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => void query.refetch()} what="exam" size="sm" />
      ) : query.data.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<CloudCheck />}
          title="No late answers are waiting"
          description="Answers uploaded from a device after its deadline appear here until someone decides on them."
        />
      ) : (
        <div className="flex flex-col gap-10">
          {query.data.map((journal) => (
            <JournalReview key={journal.attemptId} examId={examId} journal={journal} />
          ))}
        </div>
      )}
    </Section>
  );
}

function JournalReview({ examId, journal }: { examId: string; journal: HeldJournal }) {
  const confirm = useConfirm();
  const decision = useJournalDecision(examId);
  const [note, setNote] = useState('');
  const { candidate, deadlineAt, scoreNow, scoreIfAccepted, maxScore } = journal;
  const count = journal.answers.length;
  const headingId = `offline-held-${journal.attemptId}`;
  const newlyPending = scoreIfAccepted.pendingItems - scoreNow.pendingItems;

  const decide = async (accept: boolean) => {
    const ok = await confirm(
      accept
        ? {
            title: `Accept ${plural(count, 'late answer')} from ${candidate.name}?`,
            description: [
              `${count === 1 ? 'It replaces the answer' : 'They replace the answers'} submitted at the deadline and ${count === 1 ? 'is' : 'are'} graded now.`,
              `The score becomes ${fmtMarks(scoreIfAccepted.score)} of ${fmtMarks(maxScore)}${newlyPending > 0 ? `, and ${plural(newlyPending, 'more question')} ${newlyPending === 1 ? 'goes' : 'go'} to a grader` : ''}.`,
              'You can’t undo this.',
            ].join(' '),
            confirmLabel: 'Accept answers',
          }
        : {
            title: `Reject the late answers from ${candidate.name}?`,
            description:
              'The answers submitted at the deadline stand, and the held versions are discarded. You can’t undo this.',
            confirmLabel: 'Reject answers',
            destructive: true,
          },
    );
    if (!ok) return;
    decision.mutate(
      { attemptId: journal.attemptId, accept, note },
      {
        onSuccess: (result) =>
          toast.success(
            result.accepted
              ? `Accepted ${plural(result.applied, 'late answer')}`
              : 'Rejected the late answers',
            {
              description: result.accepted
                ? `${candidate.name}’s score is now ${fmtMarks(result.score)} of ${fmtMarks(result.maxScore)}.`
                : `${candidate.name}’s answers from the deadline stand.`,
            },
          ),
        onError: (error) =>
          toast.error('The decision wasn’t saved', { description: errorMessage(error) }),
      },
    );
  };

  const accepting = decision.isPending && decision.variables?.accept === true;
  const rejecting = decision.isPending && decision.variables?.accept === false;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Avatar name={candidate.name} size="lg" />
        <div className="min-w-0">
          <h4 id={headingId} className="truncate text-headline text-label">
            {candidate.name}
          </h4>
          <p className="truncate text-footnote text-label-secondary">{candidate.email}</p>
        </div>
      </header>

      <GroupedList footer="Device times come from the candidate’s browser, set against the server clock when it was last online. They are the device’s account, not proof.">
        {journal.lastSeenAt && (
          <GroupedListItem
            title="Last contact with the server"
            description={relativeToDeadline(journal.lastSeenAt, deadlineAt)}
            value={stamp(journal.lastSeenAt)}
          />
        )}
        <GroupedListItem
          title="Deadline"
          description={
            journal.submittedAt
              ? `The server submitted the answers it had at ${stamp(journal.submittedAt)}`
              : undefined
          }
          value={stamp(deadlineAt)}
        />
        {journal.journal.sealedAt && (
          <GroupedListItem
            title="Journal sealed on the device"
            description={
              <span
                className={cn(
                  offsetMs(journal.journal.sealedAt, deadlineAt) > 60_000 && 'text-warning-text',
                )}
              >
                {relativeToDeadline(journal.journal.sealedAt, deadlineAt)}, device time
              </span>
            }
            value={stamp(journal.journal.sealedAt)}
          />
        )}
        {journal.journal.receivedAt && (
          <GroupedListItem
            title="Journal uploaded"
            description={`${relativeToDeadline(journal.journal.receivedAt, deadlineAt)}, inside the ${journal.journal.graceMinutes} min allowed for reconnecting`}
            value={stamp(journal.journal.receivedAt)}
          />
        )}
      </GroupedList>

      <GroupedList
        header={plural(count, 'held answer')}
        footer={
          journal.journal.invalid > 0
            ? `${plural(journal.journal.invalid, 'more change')} in the journal couldn’t be read as an answer and ${journal.journal.invalid === 1 ? 'was' : 'were'} left out.`
            : undefined
        }
      >
        {journal.answers.map((answer) => (
          <HeldAnswerRow key={answer.itemId} answer={answer} deadlineAt={deadlineAt} />
        ))}
      </GroupedList>

      <GroupedList>
        <GroupedListItem
          title="Score as submitted"
          description={awaitingGrader(scoreNow.pendingItems)}
          value={`${fmtMarks(scoreNow.score)} of ${fmtMarks(maxScore)}`}
        />
        <GroupedListItem
          title="Score if you accept"
          description={awaitingGrader(scoreIfAccepted.pendingItems)}
          value={
            <span className="font-medium text-label">
              {fmtMarks(scoreIfAccepted.score)} of {fmtMarks(maxScore)}
            </span>
          }
        />
      </GroupedList>

      <Field
        label="Note"
        hint="Optional. Recorded with your decision in the audit log, and in the grade ledger if you accept."
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          className="min-h-16"
          placeholder="For example: the connection dropped near the end and every change predates the deadline."
          disabled={decision.isPending}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="gray"
          onClick={() => void decide(false)}
          loading={rejecting}
          disabled={decision.isPending}
        >
          Reject
        </Button>
        <Button
          variant="filled"
          onClick={() => void decide(true)}
          loading={accepting}
          disabled={decision.isPending}
        >
          Accept {plural(count, 'answer')}
        </Button>
      </div>
    </article>
  );
}

function HeldAnswerRow({ answer, deadlineAt }: { answer: HeldAnswer; deadlineAt: string }) {
  const { counted, held } = answer;
  const changedLate = held.changedAt !== null && offsetMs(held.changedAt, deadlineAt) > 0;
  return (
    <div role="listitem" className="relative flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-subheadline">
            <span className="font-semibold text-label">Question {answer.number}</span>
            <span className="text-label-secondary">{QUESTION_TYPE_META[answer.type].label}</span>
            <span className="text-label-secondary">
              {fmtMarks(answer.marks)} {marksWord(answer.marks)}
            </span>
          </p>
          {answer.stem && (
            <Prose className="mt-1 text-subheadline text-label-secondary">{answer.stem}</Prose>
          )}
        </div>
        <EffectBadge effect={answer.effect} voided={answer.voided} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <VersionPane
          title="Counted at the deadline"
          version={counted}
          when={counted.savedAt ? `Saved ${relativeToDeadline(counted.savedAt, deadlineAt)}` : null}
        />
        <VersionPane
          title="Held from the device"
          version={held}
          when={
            held.changedAt ? (
              <span className={cn(changedLate && 'text-warning-text')}>
                Changed {relativeToDeadline(held.changedAt, deadlineAt)}, device time
              </span>
            ) : (
              'The device recorded no time for this change'
            )
          }
        />
      </div>
    </div>
  );
}

function EffectBadge({ effect, voided }: { effect: HeldAnswer['effect']; voided: boolean }) {
  if (voided)
    return (
      <Badge tone="neutral" className="mt-0.5">
        Voided question
      </Badge>
    );
  const exact = effect.min === effect.max;
  const tone: Tone = !exact
    ? 'info'
    : effect.min > 0
      ? 'success'
      : effect.min < 0
        ? 'danger'
        : 'neutral';
  const text = !exact
    ? `${fmtSigned(effect.min)} to ${fmtSigned(effect.max)} ${marksWord(effect.max)}`
    : effect.min === 0
      ? 'No change'
      : `${fmtSigned(effect.min)} ${marksWord(effect.min)}`;
  return (
    <Badge tone={tone} className="mt-0.5">
      <span className="sr-only">If accepted: </span>
      {text}
      {!exact && <span className="sr-only">, depending on the grader</span>}
    </Badge>
  );
}

function VersionPane({
  title,
  version,
  when,
}: {
  title: string;
  version: AnswerVersion;
  when: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-fill-secondary p-3">
      <p className="text-footnote font-medium text-label-secondary">{title}</p>
      <ResponseText version={version} />
      {version.working && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-footnote text-label-secondary [overflow-wrap:anywhere]">
          <span className="font-medium text-label">Working: </span>
          {version.working}
        </p>
      )}
      {version.scratchPages > 0 && (
        <p className="text-footnote text-label-secondary">
          {plural(version.scratchPages, 'scratch page')}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-0.5 pt-1 text-footnote">
        <p className="font-medium text-label">{scoreText(version.parts)}</p>
        {when && <p className="text-label-secondary">{when}</p>}
      </div>
    </div>
  );
}

function ResponseText({ version }: { version: AnswerVersion }) {
  const text = version.text?.trim() ? version.text : null;
  if (!text) return <p className="text-callout text-label-tertiary">No answer</p>;
  if (version.format === 'code')
    return (
      <pre
        aria-label={version.language ? `${version.language} code` : 'Code'}
        className="max-h-60 overflow-auto rounded-md bg-surface-sunken p-2.5 font-mono text-footnote text-label"
      >
        {text}
      </pre>
    );
  if (version.format === 'choice' || version.format === 'list')
    return (
      <ul className="flex flex-col gap-1">
        {text.split('\n').map((line, i) => (
          <li key={i}>
            <Prose className="text-callout">{line}</Prose>
          </li>
        ))}
      </ul>
    );
  return (
    <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-callout text-label [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

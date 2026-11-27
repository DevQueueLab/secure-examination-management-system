'use client';

import { ClipboardPaste, Eraser, Flag, Inbox, Users } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMarks, plural } from '../../analytics/format';
import { useGradeAnswer, useGradeGroup, useQuestionAnswers, useZeroBlanks } from '../api';
import { evaluatePart, humanParts, initialDraft, initialGroupDraft, itemsFor, sameDraft, toGradeInput, type Draft } from '../draft';
import type { AnswerGroup, GradeableAnswer, Part, QueueQuestion } from '../types';
import { ResponseView } from './response-view';
import { RubricPanel, type ServerErrors } from './rubric-panel';

type Entry =
  | { kind: 'answer'; key: string; answer: GradeableAnswer; graded: boolean }
  | { kind: 'group'; key: string; group: AnswerGroup; answers: GradeableAnswer[]; graded: boolean };

const excerpt = (t: string | null, n = 64) => {
  if (!t) return null;
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function StatusDot({ graded, dirty, blank }: { graded: boolean; dirty: boolean; blank: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-1.5 inline-flex size-2 shrink-0 rounded-full',
        dirty ? 'bg-accent' : graded ? 'bg-success' : blank ? 'bg-label-quaternary' : 'ring-[1.5px] ring-inset ring-label-tertiary',
      )}
    />
  );
}

export interface GraderProps {
  examId: string;
  questionId: string;
  questions: QueueQuestion[];
  onBack: () => void;
  onSelectQuestion: (questionId: string) => void;
}

/** Three panes: anonymised responses, the response itself, and the rubric. Keyboard first. */
export function Grader({ examId, questionId, questions, onBack, onSelectQuestion }: GraderProps) {
  const { data, isPending, error, refetch } = useQuestionAnswers(examId, questionId);
  const grade = useGradeAnswer(examId, questionId);
  const gradeGroup = useGradeGroup(examId, questionId);
  const zeroBlanks = useZeroBlanks(examId, questionId);

  const [groupMode, setGroupMode] = useState(false);
  const [filter, setFilter] = useState<'all' | 'todo'>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, ServerErrors>>({});
  const [saving, setSaving] = useState(false);
  const listRefs = useRef(new Map<string, HTMLButtonElement>());
  const centerRef = useRef<HTMLDivElement>(null);
  const groupSwitchId = useId();

  const rubric = useMemo(() => data?.rubric ?? [], [data]);
  const grouping = groupMode && !!data?.groups.length;

  const allEntries = useMemo<Entry[]>(() => {
    if (!data) return [];
    if (!grouping) return data.answers.map((a) => ({ kind: 'answer', key: a.id, answer: a, graded: a.graded }));
    const byId = new Map(data.answers.map((a) => [a.id, a]));
    const grouped = new Set(data.groups.flatMap((g) => g.answerIds));
    const groups: Entry[] = data.groups.map((g) => {
      const answers = g.answerIds.map((id) => byId.get(id)).filter((a): a is GradeableAnswer => !!a);
      return { kind: 'group', key: `group:${g.key}`, group: g, answers, graded: answers.every((a) => a.graded) };
    });
    const singles: Entry[] = data.answers.filter((a) => !grouped.has(a.id)).map((a) => ({ kind: 'answer', key: a.id, answer: a, graded: a.graded }));
    return [...groups, ...singles];
  }, [data, grouping]);

  const entries = useMemo(() => (filter === 'todo' ? allEntries.filter((e) => !e.graded || e.key === selectedKey) : allEntries), [allEntries, filter, selectedKey]);
  const current = entries.find((e) => e.key === selectedKey) ?? entries.find((e) => !e.graded) ?? entries[0] ?? null;
  const index = current ? entries.indexOf(current) : -1;

  const baseDraft = (e: Entry): Draft => (e.kind === 'group' ? initialGroupDraft(e.answers, rubric) : initialDraft(e.answer, rubric));
  const draft = current ? (drafts[current.key] ?? baseDraft(current)) : null;
  const dirty = !!current && !!draft && !sameDraft(draft, baseDraft(current));
  const isDirty = (e: Entry) => !!drafts[e.key] && !sameDraft(drafts[e.key]!, baseDraft(e));

  const select = (key: string) => {
    setSelectedKey(key);
    centerRef.current?.scrollTo({ top: 0 });
  };
  const move = (delta: number) => {
    if (!entries.length) return;
    const next = entries[Math.min(entries.length - 1, Math.max(0, index + delta))];
    if (next && next.key !== current?.key) select(next.key);
  };

  useEffect(() => {
    if (current) listRefs.current.get(current.key)?.scrollIntoView({ block: 'nearest' });
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDraft = (next: Draft) => {
    if (!current) return;
    setDrafts((d) => ({ ...d, [current.key]: next }));
    if (errors[current.key]) setErrors((e) => ({ ...e, [current.key]: {} }));
  };

  /** After saving, go to the next answer still waiting for a grade (wrapping), or simply the next one. */
  const nextKeyAfter = (key: string): string | null => {
    const at = allEntries.findIndex((e) => e.key === key);
    const ordered = [...allEntries.slice(at + 1), ...allEntries.slice(0, Math.max(0, at))];
    return (ordered.find((e) => !e.graded) ?? allEntries[at + 1])?.key ?? null;
  };

  const save = async () => {
    if (!current || !draft || !data || saving) return;
    if (current.graded && !dirty) {
      move(1);
      return;
    }
    const parts: Part[] = current.kind === 'group' ? (draft.answer ? ['answer'] : []) : humanParts(current.answer);
    const local: ServerErrors = {};
    for (const part of parts) {
      const d = draft[part];
      const state = current.kind === 'group' ? current.answers[0]!.parts[part] : current.answer.parts[part];
      if (!d || !state) continue;
      const outcome = evaluatePart(d, itemsFor(rubric, part), state.max);
      if (outcome.error) local[part] = { [outcome.error.field]: outcome.error.message };
    }
    if (Object.keys(local).length) {
      setErrors((e) => ({ ...e, [current.key]: local }));
      return;
    }
    if (!parts.length) {
      move(1);
      return;
    }
    const key = current.key;
    const nextKey = nextKeyAfter(key);
    setSaving(true);
    let part: Part = parts[0]!;
    try {
      if (current.kind === 'group') {
        await gradeGroup.mutateAsync({ answerIds: current.answers.map((a) => a.id), ...toGradeInput('answer', draft.answer!, draft.feedback) });
        toast.success(`Graded ${plural(current.answers.length, 'identical answer')}`);
      } else {
        for (const p of parts) {
          part = p;
          await grade.mutateAsync({ answerId: current.answer.id, input: toGradeInput(p, draft[p]!, draft.feedback) });
        }
      }
      setDrafts(({ [key]: _done, ...rest }) => rest);
      setErrors(({ [key]: _gone, ...rest }) => rest);
      const remaining = allEntries.filter((e) => !e.graded && e.key !== key).length;
      if (remaining === 0) toast.success(`Every answer to ${data.question.label} is graded`);
      if (nextKey) select(nextKey);
    } catch (err) {
      if (isApiError(err) && err.isValidation && Object.keys(err.fields).length) {
        const { feedback, ...rest } = err.fields;
        setErrors((e) => ({ ...e, [key]: { [part]: rest, ...(feedback ? { feedback: { feedback } } : {}) } }));
      } else {
        toast.error(errorMessage(err, 'The grade was not saved. Try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleNth = (n: number) => {
    if (!current || !draft) return;
    const order: { part: Part; id: string }[] = [];
    for (const part of ['answer', 'working'] as const) {
      const d = draft[part];
      if (!d || d.explicit) continue;
      for (const item of itemsFor(rubric, part)) order.push({ part, id: item.id });
    }
    const hit = order[n - 1];
    if (!hit) return;
    const d = draft[hit.part]!;
    setDraft({ ...draft, [hit.part]: { ...d, ids: d.ids.includes(hit.id) ? d.ids.filter((x) => x !== hit.id) : [...d.ids, hit.id] } });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void save();
      return;
    }
    const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      move(-1);
    } else if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      toggleNth(Number(e.key));
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const question = questions.find((q) => q.questionId === questionId);
  const ungradedBlanks = data?.answers.filter((a) => !a.answered && !a.graded).length ?? 0;
  const progress = data?.progress ?? (question ? { total: question.total, graded: question.graded } : { total: 0, graded: 0 });

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5">
        All questions
      </Button>
      <Select
        size="sm"
        aria-label="Question"
        className="w-[min(22rem,100%)]"
        value={questionId}
        onValueChange={onSelectQuestion}
        options={questions.map((q) => ({
          value: q.questionId,
          label: (
            <span className="inline-flex min-w-0 gap-2">
              <span className="font-semibold tabular-nums">{q.label}</span>
              <span className="truncate">{q.title}</span>
            </span>
          ),
          description: q.total ? (q.remaining ? `${q.remaining} of ${q.total} to grade` : `All ${q.total} graded`) : 'No submissions yet',
        }))}
      />
      <div className="flex min-w-40 flex-1 items-center gap-2.5 sm:max-w-64">
        <span className="whitespace-nowrap text-subheadline font-medium tabular-nums text-label">
          Graded {progress.graded}/{progress.total}
        </span>
        <ProgressBar size="sm" tone={progress.total && progress.graded === progress.total ? 'success' : 'accent'} value={progress.graded} max={Math.max(1, progress.total)} label={`Graded ${progress.graded} of ${progress.total}`} />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {ungradedBlanks > 0 && (
          <Button
            size="sm"
            variant="gray"
            loading={zeroBlanks.isPending}
            onClick={() =>
              zeroBlanks.mutate(undefined, {
                onSuccess: (r) => toast.success(`Gave 0 marks to ${plural(r.graded, 'empty answer')}`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <Eraser /> Zero {plural(ungradedBlanks, 'empty answer')}
          </Button>
        )}
        {!!data?.groups.length && (
          <div className="flex items-center gap-2">
            <Switch
              id={groupSwitchId}
              size="sm"
              checked={groupMode}
              onCheckedChange={(on) => {
                setGroupMode(on);
                setSelectedKey(null);
              }}
            />
            <label htmlFor={groupSwitchId} className="select-none text-subheadline text-label">
              Group identical <span className="tabular-nums text-label-secondary">({data.groups.length})</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
          <Skeleton className="h-[28rem] rounded-xl max-lg:hidden" />
          <div className="rounded-xl bg-surface p-6">
            <Skeleton className="h-6 w-48" />
            <SkeletonText lines={8} className="mt-6" />
          </div>
          <Skeleton className="h-[28rem] rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <EmptyState
          icon={<Inbox />}
          title="Couldn’t load the answers"
          description={errorMessage(error)}
          action={
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (!data.answers.length) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <EmptyState
          icon={<Inbox />}
          title="No answers to grade yet"
          description="Answers to this question appear here as candidates submit. Examiner previews are never included."
        />
      </div>
    );
  }

  const shown = current?.kind === 'group' ? current.answers[0]! : current?.answer;

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      {/* Phones and tablets: step through answers instead of the list. */}
      {current && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface px-2 py-1.5 lg:hidden">
          <Button size="sm" variant="ghost" aria-label="Previous answer" disabled={index <= 0} onClick={() => move(-1)}>
            Previous
          </Button>
          <span className="flex flex-col items-center text-center">
            <span className="text-subheadline font-medium text-label">{current.kind === 'group' ? `${current.answers.length} identical answers` : current.answer.candidate.label}</span>
            <span className="text-caption tabular-nums text-label-secondary">
              {index + 1} of {entries.length}
            </span>
          </span>
          <Button size="sm" variant="ghost" aria-label="Next answer" disabled={index >= entries.length - 1} onClick={() => move(1)}>
            Next
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:h-[calc(100dvh-18rem)] lg:min-h-[32rem] lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        {/* Left: responses */}
        <nav aria-label="Responses" className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-surface max-lg:hidden">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
            <span className="text-subheadline font-semibold text-label">{data.anonymous ? 'Anonymised' : 'Candidates'}</span>
            <SegmentedControl
              size="sm"
              aria-label="Show"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'todo', label: 'To grade' },
              ]}
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {entries.map((e) => {
              const selected = e.key === current?.key;
              const a = e.kind === 'group' ? e.answers[0]! : e.answer;
              const title = e.kind === 'group' ? `${e.answers.length} identical` : data.anonymous || !a.candidate.name ? a.candidate.label : a.candidate.name;
              const score = e.kind === 'group' ? null : a.itemScore;
              return (
                <li key={e.key}>
                  <button
                    ref={(el) => {
                      if (el) listRefs.current.set(e.key, el);
                      else listRefs.current.delete(e.key);
                    }}
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => select(e.key)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 outline-none',
                      'focus-visible:outline-[length:var(--focus-width)] focus-visible:-outline-offset-2 focus-visible:outline-focus',
                      selected ? 'bg-accent-tint' : 'hover:bg-fill-secondary',
                    )}
                  >
                    <StatusDot graded={e.graded} dirty={isDirty(e)} blank={!a.answered} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {e.kind === 'group' && <Users aria-hidden className="size-3.5 shrink-0 text-label-tertiary" />}
                        <span className={cn('truncate text-callout text-label', selected && 'font-semibold')}>{title}</span>
                        {e.kind === 'answer' && a.flagged && <Flag aria-label="Flagged by candidate" className="size-3 shrink-0 text-info" />}
                        {e.kind === 'answer' && (a.provenance?.pastedPercent ?? 0) >= 50 && (
                          <ClipboardPaste aria-label={`${a.provenance!.pastedPercent}% pasted`} className="size-3 shrink-0 text-warning" />
                        )}
                      </span>
                      <span className="block truncate text-footnote text-label-secondary">
                        {a.answered ? excerpt(a.response.text) : 'No response'}
                      </span>
                    </span>
                    <span className="mt-px shrink-0 text-footnote tabular-nums text-label-secondary">
                      {score !== null && e.graded ? `${fmtMarks(score)}/${fmtMarks(a.itemMax)}` : e.kind === 'group' ? `×${e.answers.length}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
            {!entries.length && <li className="px-3 py-6 text-center text-footnote text-label-secondary">Everything here is graded.</li>}
          </ul>
        </nav>

        {/* Centre: the response */}
        <div ref={centerRef} className="min-h-0 overflow-y-auto rounded-xl bg-surface p-5 sm:p-6">
          {current && shown ? (
            <ResponseView examId={examId} data={data} answer={shown} group={current.kind === 'group' ? current.answers : undefined} />
          ) : (
            <EmptyState surface={false} size="sm" icon={<Inbox />} title="Pick a response" description="Choose an answer on the left to start grading." />
          )}
        </div>

        {/* Right: the rubric */}
        <aside aria-label="Rubric and score" className="min-h-0 overflow-hidden rounded-xl bg-surface max-lg:max-h-none">
          {current && draft && shown ? (
            <RubricPanel
              key={current.key}
              parts={shown.parts}
              rubric={rubric}
              draft={draft}
              onChange={setDraft}
              errors={errors[current.key] ?? {}}
              saving={saving}
              dirty={dirty}
              onSave={() => void save()}
              groupSize={current.kind === 'group' ? current.answers.length : undefined}
              graded={current.graded}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

'use client';

import { Ellipsis, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useMemo, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMarks, fmtSigned, plural } from '../../analytics/format';
import { useQuestionAnswers, useRubric, useRubricMutations, type RubricDraft } from '../api';
import { projectRescore } from '../draft';
import type { Part, QueueQuestion, Rescore, RubricItem } from '../types';

const PART_NAME: Record<Part, string> = { answer: 'Answer', working: 'Working' };

interface FormState {
  label: string;
  description: string;
  points: string;
  target: Part;
}

function parsePoints(s: string): number | null {
  const t = s.trim().replace('−', '-').replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return Number(t);
}

function validate(f: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.label.trim()) errors.label = 'Give the criterion a short label';
  else if (f.label.trim().length > 200) errors.label = 'Keep the label under 200 characters';
  const p = parsePoints(f.points);
  if (p === null) errors.points = 'Points must be a number, like 2 or −1';
  else if (Math.abs(p) > 100) errors.points = 'Points must be between −100 and 100';
  else if (Math.abs(p * 1000 - Math.round(p * 1000)) > 1e-6) errors.points = 'Use at most three decimals';
  if (f.description.length > 1000) errors.description = 'Keep the description under 1000 characters';
  return errors;
}

const rescoreToast = (r: Rescore | undefined, verb: string) => {
  if (!r || r.answers === 0) return toast.success(verb);
  toast.success(verb, { description: `Re-scored ${plural(r.answers, 'answer')} across ${plural(r.attempts, 'attempt')}; ${plural(r.changedScores, 'score')} changed. Each change is in the grade ledger.` });
};

function ItemForm({
  initial,
  hasWorking,
  submitLabel,
  busy,
  serverErrors,
  preview,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  hasWorking: boolean;
  submitLabel: string;
  busy: boolean;
  serverErrors: Record<string, string>;
  preview?: (points: number | null, form: FormState) => ReactNode;
  onSubmit: (f: FormState) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState(false);
  const local = validate(form);
  const errors = { ...(touched ? local : {}), ...serverErrors };
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (Object.keys(local).length) return;
        onSubmit(form);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field label="Criterion" error={errors.label}>
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="States the base case correctly" autoFocus />
        </Field>
        <Field label="Points" error={errors.points}>
          <Input inputMode="decimal" className="tabular-nums" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="2" />
        </Field>
      </div>
      <Field label="Guidance for graders" hint="Optional. What earns this, in a sentence." error={errors.description}>
        <Textarea rows={2} className="min-h-16 text-callout" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      {hasWorking && (
        <Field label="Grades the">
          <SegmentedControl
            size="sm"
            aria-label="Part this criterion grades"
            value={form.target}
            onValueChange={(target) => setForm({ ...form, target })}
            options={[
              { value: 'answer', label: 'Answer' },
              { value: 'working', label: 'Working' },
            ]}
          />
        </Field>
      )}
      {preview?.(parsePoints(form.points), form)}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="gray" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="filled" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function RubricEditor({ examId, questions, questionId, onSelectQuestion }: { examId: string; questions: QueueQuestion[]; questionId: string | null; onSelectQuestion: (id: string) => void }) {
  const selected = questionId ?? questions[0]?.questionId ?? null;
  if (!questions.length) {
    return <EmptyState icon={<ListChecks />} title="No written questions" description="Rubrics apply to long answers, code and shown working. This paper is marked automatically." />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Questions" className="h-fit rounded-xl bg-surface p-1.5">
        <ul>
          {questions.map((q) => (
            <li key={q.questionId}>
              <button
                type="button"
                aria-current={q.questionId === selected || undefined}
                onClick={() => onSelectQuestion(q.questionId)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors',
                  'focus-visible:outline-[length:var(--focus-width)] focus-visible:-outline-offset-2 focus-visible:outline-focus',
                  q.questionId === selected ? 'bg-accent-tint' : 'hover:bg-fill-secondary',
                )}
              >
                <span className="text-callout font-semibold tabular-nums text-label">{q.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-callout text-label">{q.title}</span>
                  <span className={cn('block text-footnote', q.rubricCount ? 'text-label-secondary' : 'text-warning-text')}>
                    {q.rubricCount ? plural(q.rubricCount, 'criterion', 'criteria') : 'No rubric yet'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {selected && <QuestionRubric key={selected} examId={examId} questionId={selected} />}
    </div>
  );
}

function QuestionRubric({ examId, questionId }: { examId: string; questionId: string }) {
  const { data, isPending, error } = useRubric(examId, questionId);
  const answersQuery = useQuestionAnswers(examId, questionId);
  const { create, update, remove } = useRubricMutations(examId, questionId);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Part | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const parts = data?.question.parts ?? [];
  const hasWorking = parts.some((p) => p.part === 'working');
  const items = useMemo(() => [...(data?.items ?? [])].sort((a, b) => a.position - b.position), [data]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 rounded-xl bg-surface p-5">
        <Skeleton className="h-6 w-64" />
        <SkeletonRows rows={3} className="bg-transparent" />
      </div>
    );
  }
  if (error || !data) return <EmptyState icon={<ListChecks />} title="Couldn’t load the rubric" description={errorMessage(error)} />;

  const answers = answersQuery.data?.answers ?? [];
  const affected = (item: RubricItem, points: number | null) =>
    answers
      .map((a) => ({ a, p: projectRescore(a, items, item.id, points) }))
      .filter((x): x is { a: (typeof answers)[number]; p: NonNullable<ReturnType<typeof projectRescore>> } => !!x.p);

  const fail = (e: unknown) => {
    if (isApiError(e) && e.isValidation && Object.keys(e.fields).length) setFormErrors(e.fields);
    else toast.error(errorMessage(e));
  };

  const submitNew = (target: Part) => (f: FormState) => {
    const draft: RubricDraft = { label: f.label.trim(), description: f.description.trim() || null, points: parsePoints(f.points)!, target: hasWorking ? f.target : target, position: items.length };
    create.mutate(draft, {
      onSuccess: () => {
        setAdding(null);
        setFormErrors({});
        toast.success('Criterion added');
      },
      onError: fail,
    });
  };

  const submitEdit = (item: RubricItem) => async (f: FormState) => {
    const points = parsePoints(f.points)!;
    const patch: Partial<RubricDraft> = {};
    if (f.label.trim() !== item.label) patch.label = f.label.trim();
    if ((f.description.trim() || null) !== item.description) patch.description = f.description.trim() || null;
    if (points !== item.points) patch.points = points;
    if (hasWorking && f.target !== item.target) patch.target = f.target;
    if (!Object.keys(patch).length) return setEditing(null);
    if (item.usage > 0 && (patch.points !== undefined || patch.target !== undefined)) {
      const ok = await confirm({
        title: `Re-score ${plural(item.usage, 'answer')}?`,
        description: `Every answer with “${item.label}” ticked is re-scored now, in one step. Each change is written to the grade ledger and, once results are published, reaches the candidate’s result.`,
        confirmLabel: 'Re-score answers',
      });
      if (!ok) return;
    }
    update.mutate(
      { id: item.id, patch },
      {
        onSuccess: (r) => {
          setEditing(null);
          setFormErrors({});
          rescoreToast(r.rescored, 'Criterion updated');
        },
        onError: fail,
      },
    );
  };

  const del = async (item: RubricItem) => {
    const ok = await confirm({
      title: `Delete “${item.label}”?`,
      description: item.usage
        ? `${plural(item.usage, 'answer')} lose${item.usage === 1 ? 's' : ''} its ${fmtSigned(item.points)} and ${item.usage === 1 ? 'is' : 'are'} re-scored now. The change is recorded in the grade ledger.`
        : 'No answer uses it yet.',
      confirmLabel: 'Delete criterion',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(item.id, { onSuccess: (r) => rescoreToast(r.rescored, 'Criterion deleted'), onError: (e) => toast.error(errorMessage(e)) });
  };

  const moveItem = (item: RubricItem, dir: -1 | 1) => {
    const sameTarget = items.filter((i) => i.target === item.target);
    const at = sameTarget.indexOf(item);
    const other = sameTarget[at + dir];
    if (!other) return;
    update.mutate({ id: item.id, patch: { position: other.position } });
    update.mutate({ id: other.id, patch: { position: item.position } });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-surface p-5">
        <h2 className="flex gap-2.5 text-title-3 text-label">
          <span className="tabular-nums">{data.question.label}</span>
          <span>{data.question.title}</span>
        </h2>
        <p className="mt-1 text-subheadline text-label-secondary">
          {parts.map((p, n) => `${n === 0 ? PART_NAME[p.part] : PART_NAME[p.part].toLowerCase()} worth ${fmtMarks(p.max)}`).join(' and ')}. A part’s score is the sum of the ticked criteria plus any adjustment, held between 0 and its marks.
          Changing points re-scores every answer that uses the criterion.
        </p>
      </div>

      {parts.map(({ part, max }) => {
        const partItems = items.filter((i) => i.target === part);
        const positive = partItems.filter((i) => i.points > 0).reduce((s, i) => s + i.points, 0);
        return (
          <section key={part} aria-labelledby={`rubric-${part}`} className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-3 px-1">
              <h3 id={`rubric-${part}`} className="text-headline text-label">
                {PART_NAME[part]} criteria
              </h3>
              {partItems.length > 0 && (
                <span className={cn('text-footnote tabular-nums', positive === max ? 'text-label-secondary' : 'text-warning-text')}>
                  Positive criteria total {fmtMarks(positive)} of {fmtMarks(max)}
                </span>
              )}
            </div>
            <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
              {partItems.map((item, i) => (
                <li key={item.id} className="px-4 py-3">
                  {editing === item.id ? (
                    <ItemForm
                      initial={{ label: item.label, description: item.description ?? '', points: String(item.points), target: item.target }}
                      hasWorking={hasWorking}
                      submitLabel={item.usage ? 'Save and re-score' : 'Save'}
                      busy={update.isPending}
                      serverErrors={formErrors}
                      onCancel={() => {
                        setEditing(null);
                        setFormErrors({});
                      }}
                      onSubmit={(f) => void submitEdit(item)(f)}
                      preview={(points) => {
                        if (!item.usage || points === null || points === item.points) return null;
                        const rows = affected(item, points);
                        const changed = rows.filter((r) => r.p.from !== r.p.to);
                        return (
                          <div className="rounded-lg bg-fill-secondary px-3 py-2.5">
                            <p className="text-footnote font-medium text-label">
                              {plural(item.usage, 'answer')} will be re-scored{rows.length ? `; ${plural(changed.length, 'score')} change${changed.length === 1 ? 's' : ''}` : ''}.
                            </p>
                            {changed.length > 0 && (
                              <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-footnote tabular-nums text-label-secondary sm:grid-cols-2">
                                {changed.slice(0, 8).map(({ a, p }) => (
                                  <li key={a.id}>
                                    {a.candidate.label}: {fmtMarks(p.from)} → <span className="font-medium text-label">{fmtMarks(p.to)}</span>
                                  </li>
                                ))}
                                {changed.length > 8 && <li>and {changed.length - 8} more</li>}
                              </ul>
                            )}
                          </div>
                        );
                      }}
                    />
                  ) : (
                    <div className="flex items-start gap-3">
                      <span className={cn('mt-px w-12 shrink-0 text-callout font-semibold tabular-nums', item.points < 0 ? 'text-danger-text' : 'text-label')}>{fmtSigned(item.points)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-callout font-medium text-label">{item.label}</p>
                        {item.description && <p className="mt-0.5 text-footnote text-label-secondary">{item.description}</p>}
                        <p className="mt-0.5 text-footnote text-label-tertiary">{item.usage ? `Ticked on ${plural(item.usage, 'answer')}` : 'Not used yet'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Tooltip content="Edit">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${item.label}`}
                            onClick={() => {
                              setEditing(item.id);
                              setAdding(null);
                              setFormErrors({});
                            }}
                          >
                            <Pencil />
                          </Button>
                        </Tooltip>
                        <DropdownMenu>
                          <Tooltip content="More">
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-sm" variant="ghost" aria-label={`More for ${item.label}`}>
                                <Ellipsis />
                              </Button>
                            </DropdownMenuTrigger>
                          </Tooltip>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={i === 0} onSelect={() => moveItem(item, -1)}>
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={i === partItems.length - 1} onSelect={() => moveItem(item, 1)}>
                              Move down
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => void del(item)}>
                              Delete criterion
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              <li className="px-4 py-3">
                {adding === part ? (
                  <ItemForm
                    initial={{ label: '', description: '', points: '', target: part }}
                    hasWorking={hasWorking}
                    submitLabel="Add criterion"
                    busy={create.isPending}
                    serverErrors={formErrors}
                    onCancel={() => {
                      setAdding(null);
                      setFormErrors({});
                    }}
                    onSubmit={submitNew(part)}
                  />
                ) : (
                  <Button
                    variant="plain"
                    size="sm"
                    className="-ml-2.5"
                    onClick={() => {
                      setAdding(part);
                      setEditing(null);
                      setFormErrors({});
                    }}
                  >
                    <Plus /> Add {part === 'working' ? 'a working' : 'a'} criterion
                  </Button>
                )}
              </li>
            </ul>
          </section>
        );
      })}
    </div>
  );
}

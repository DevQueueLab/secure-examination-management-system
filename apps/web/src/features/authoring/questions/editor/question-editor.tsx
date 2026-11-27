'use client';

import { DIFFICULTIES, QUESTION_TYPES, QUESTION_TYPE_META, type Difficulty, type QuestionType } from '@athena/shared';
import { Archive, ArchiveRestore, CircleAlert, Copy, Eye, History, MoreHorizontal, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, ViewTransition } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Shortcut } from '@/components/ui/kbd';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { authoringKeys, useCreateQuestion, useQuestion, useQuestionAction, useTags, useUpdateQuestion } from '../../api';
import { LoadError } from '../../components/load-error';
import { NumberStepper } from '../../components/number-stepper';
import { DIFFICULTY_LABEL, ObservedBar, QUESTION_TYPE_ICON, TypePill } from '../../components/pills';
import { RichText } from '../../components/rich-text';
import { formatWhen } from '../../lib/datetime';
import { revealFirstError, unclaimed } from '../../lib/field-errors';
import { formatMarks, plural } from '../../lib/format';
import type { QuestionDetail, QuestionVersion } from '../../types';
import { CandidatePreviewDialog } from './candidate-preview';
import { CategoryField } from './category-field';
import { ChipsInput } from './chips-input';
import { draftFromQuestion, newDraft, toInput, validateDraft, type Draft } from './draft';
import { TypeEditor } from './type-editors';
import { VersionHistorySheet } from './version-history';

/** /questions/new and /questions/[id]. */
export function QuestionEditorPage({ questionId }: { questionId?: string }) {
  if (!questionId) return <NewQuestion />;
  return <ExistingQuestion questionId={questionId} />;
}

function ExistingQuestion({ questionId }: { questionId: string }) {
  const query = useQuestion(questionId);
  if (query.isError)
    return (
      <>
        <PageHeader title="Question" breadcrumbs={[{ label: 'Question bank', href: '/questions' }, { label: 'Question' }]} />
        <LoadError error={query.error} what="question" onRetry={() => void query.refetch()} backHref="/questions" backLabel="Question bank" />
      </>
    );
  if (!query.data) return <EditorSkeleton />;
  return <Editor key={query.data.id} question={query.data} />;
}

function NewQuestion() {
  const [type, setType] = useState<QuestionType | null>(null);
  if (!type) return <TypePicker onPick={setType} />;
  return <Editor key={type} initialType={type} onChangeType={() => setType(null)} />;
}

const TYPE_GROUPS: { title: string; hint: string; types: QuestionType[] }[] = [
  { title: 'Marked automatically', hint: 'Scored the moment a candidate submits.', types: QUESTION_TYPES.filter((t) => QUESTION_TYPE_META[t].autoGraded) },
  { title: 'Marked by a grader', hint: 'Graded against a rubric, without names if the exam grades anonymously.', types: QUESTION_TYPES.filter((t) => !QUESTION_TYPE_META[t].autoGraded) },
];

function TypePicker({ onPick }: { onPick: (t: QuestionType) => void }) {
  return (
    <>
      <PageHeader title="New question" subtitle="Choose the kind of answer you want. You can’t change the type after saving." breadcrumbs={[{ label: 'Question bank', href: '/questions' }, { label: 'New question' }]} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex max-w-3xl flex-col gap-8">
          {TYPE_GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-2" aria-label={g.title}>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-headline text-label">{g.title}</h2>
                <p className="text-footnote text-label-secondary">{g.hint}</p>
              </div>
              <ul className="flex flex-col overflow-hidden rounded-xl bg-surface shadow-xs">
                {g.types.map((t, i) => {
                  const Icon = QUESTION_TYPE_ICON[t];
                  const meta = QUESTION_TYPE_META[t];
                  return (
                    <li key={t} className={cn(i > 0 && 'border-t border-separator')}>
                      <button
                        type="button"
                        onClick={() => onPick(t)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-fill-secondary focus-visible:bg-fill-secondary focus-visible:outline-none active:bg-fill"
                      >
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text">
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-callout font-medium text-label">{meta.label}</span>
                          <span className="text-footnote text-label-secondary">{meta.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <aside className="flex flex-col gap-2 lg:pt-1">
          <h2 className="text-headline text-label">Adding many at once?</h2>
          <p className="text-footnote text-label-secondary">Import a CSV or JSON file. Every row is checked before anything is saved.</p>
          <Button asChild variant="gray" size="sm" className="self-start">
            <Link href="/questions/import">Import questions</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}

const serialize = (d: Draft) => JSON.stringify(toInput(d));

function Editor({ question, initialType, onChangeType }: { question?: QuestionDetail; initialType?: QuestionType; onChangeType?: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { can } = useAuth();
  const create = useCreateQuestion();
  const update = useUpdateQuestion(question?.id ?? '');
  const action = useQuestionAction();
  const tags = useTags();
  const initial = useMemo(() => (question ? draftFromQuestion(question) : newDraft(initialType!)), [question, initialType]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [baseline, setBaseline] = useState(() => serialize(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const archived = question?.status === 'archived';
  const readOnly = archived || !can('questions.manage');
  const dirty = serialize(draft) !== baseline;
  const saving = create.isPending || update.isPending;

  const change = useCallback((fn: (d: Draft) => Draft) => {
    setDraft(fn);
    setErrors((e) => (Object.keys(e).length ? {} : e));
  }, []);

  // Leaving with unsaved work asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = () => {
    if (readOnly || saving) return;
    const found = validateDraft(draft);
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error(`${plural(new Set(Object.keys(found).map((k) => k.replace(/^content\.(options|items)\.\d+\.text$/, 'content.$1'))).size, 'thing')} to fix before saving`);
      revealFirstError();
      return;
    }
    const onError = (e: unknown) => {
      if (isApiError(e) && e.code === 'VERSION_CONFLICT') setConflict(true);
      else if (isApiError(e) && Object.keys(e.fields).length) {
        setErrors(e.fields);
        toast.error(e.message || 'Some fields need another look.');
        revealFirstError();
      } else toast.error(errorMessage(e));
    };
    if (!question) {
      create.mutate(toInput(draft), {
        onSuccess: (q) => {
          setBaseline(serialize(draft));
          toast.success('Question saved as v1');
          router.replace(`/questions/${q.id}`);
        },
        onError,
      });
      return;
    }
    update.mutate(toInput(draft, question.currentVersion), {
      onSuccess: (r) => {
        const fresh = draftFromQuestion(r);
        setDraft(fresh);
        setBaseline(serialize(fresh));
        toast.success(r.versionCreated ? `Saved as v${r.version}${r.usage.total ? '. Exams keep their pinned version until you update them.' : ''}` : 'Details saved. The content didn’t change, so no new version.');
      },
      onError,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const loadVersion = (v: QuestionVersion) => {
    change((d) => ({ ...d, content: structuredClone(v.content), key: structuredClone(v.key) }));
    setHistoryOpen(false);
    toast.info(`v${v.version} loaded. Save to make it the newest version.`);
  };

  const runAction = async (kind: 'archive' | 'restore' | 'duplicate') => {
    if (!question) return;
    if (kind === 'archive') {
      const ok = await confirm({
        title: 'Archive this question?',
        description: 'It leaves the bank and can’t be added to new exams. Exams already using it keep their version. You can restore it later.',
        confirmLabel: 'Archive',
        destructive: true,
      });
      if (!ok) return;
    }
    action.mutate(
      { id: question.id, action: kind },
      {
        onSuccess: (q) => {
          if (kind === 'duplicate') {
            toast.success('Copy created');
            router.push(`/questions/${q.id}`);
          } else toast.success(kind === 'archive' ? 'Question archived' : 'Question restored');
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const working = (draft.content.working ?? { enabled: false, marks: 0 }) as { enabled: boolean; marks: number; guidance?: string };
  const setWorking = (patch: Partial<typeof working>) => change((d) => ({ ...d, content: { ...d.content, working: { ...working, ...patch } } }));
  const claimed = ['title', 'difficulty', 'categoryId', 'tags', 'defaultMarks', 'content', 'key', 'type'];
  const stray = unclaimed(errors, claimed);
  const typeMeta = QUESTION_TYPE_META[draft.type];

  return (
    <div className="pb-28">
      <PageHeader
        title={question ? question.title : 'New question'}
        breadcrumbs={[{ label: 'Question bank', href: '/questions' }, { label: question ? question.title : 'New question' }]}
        meta={
          <span className="flex items-center gap-2">
            <TypePill type={draft.type} size="md" full />
            {question && (
              <Badge size="md" tone="neutral">
                v{question.currentVersion}
              </Badge>
            )}
            {archived && (
              <Badge size="md" tone="warning">
                Archived
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {!question && onChangeType && (
              <Button
                variant="plain"
                onClick={async () => {
                  if (dirty && !(await confirm({ title: 'Change the question type?', description: 'What you’ve written for the answer is cleared.', confirmLabel: 'Change type' }))) return;
                  onChangeType();
                }}
              >
                Change type
              </Button>
            )}
            <Button variant="gray" onClick={() => setPreviewOpen(true)}>
              <Eye aria-hidden /> Preview
            </Button>
            {question && (
              <>
                <Button variant="gray" onClick={() => setHistoryOpen(true)}>
                  <History aria-hidden /> History
                </Button>
                {can('questions.manage') && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="gray" size="icon" aria-label="More actions">
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem icon={<Copy />} onSelect={() => runAction('duplicate')}>
                        Duplicate
                      </DropdownMenuItem>
                      {archived ? (
                        <DropdownMenuItem icon={<ArchiveRestore />} onSelect={() => runAction('restore')}>
                          Restore to bank
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem icon={<Archive />} destructive onSelect={() => runAction('archive')}>
                          Archive
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </>
        }
      />

      {conflict && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl bg-warning-tint px-4 py-3 text-callout text-warning-text sm:flex-row sm:items-center">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <p className="flex-1">Someone saved a newer version while you were editing. Load it to continue; copy anything you want to keep first, because your changes here will be replaced.</p>
          <Button
            variant="gray"
            size="sm"
            onClick={async () => {
              try {
                // Refreshes the cache too, so the next save is based on the version just loaded.
                const r = await qc.fetchQuery({ queryKey: authoringKeys.question(question!.id), queryFn: () => api.get<QuestionDetail>(`/questions/${question!.id}`), staleTime: 0 });
                const fresh = draftFromQuestion(r);
                setDraft(fresh);
                setBaseline(serialize(fresh));
                setErrors({});
                setConflict(false);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <RefreshCw aria-hidden /> Load latest
          </Button>
        </div>
      )}
      {archived && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-callout text-label-secondary shadow-xs">
          <Archive aria-hidden className="size-4 shrink-0 text-label-tertiary" />
          <p className="flex-1">This question is archived and read-only. Restore it to edit or add it to exams.</p>
          {can('questions.manage') && (
            <Button variant="tinted" size="sm" onClick={() => runAction('restore')} loading={action.isPending}>
              Restore
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <Card className="flex flex-col gap-5">
            <Field label="Title" required error={errors.title} hint="A short name for lists and search. Candidates don’t see it.">
              <Input value={draft.title} onChange={(e) => change((d) => ({ ...d, title: e.target.value }))} placeholder="Binary search complexity" maxLength={200} disabled={readOnly} />
            </Field>
            <Field
              label={draft.type === 'true_false' ? 'Statement' : draft.type === 'fill_blanks' ? 'Instructions' : 'Question'}
              required={draft.type !== 'fill_blanks'}
              error={errors['content.stem']}
              hint={
                draft.type === 'numeric' && typeof draft.key.formula === 'string'
                  ? 'Markdown and $maths$ work. Write {{name}} where a variable’s value goes.'
                  : 'Markdown works: **bold**, lists, `code`. Maths with $x^2$ inline or $$\\int_0^1 x\\,dx$$ on its own line.'
              }
            >
              <Textarea
                value={draft.content.stem ?? ''}
                onChange={(e) => change((d) => ({ ...d, content: { ...d.content, stem: e.target.value } }))}
                rows={4}
                placeholder={draft.type === 'fill_blanks' ? 'Complete the statement.' : 'What is the worst-case time complexity of binary search on $n$ sorted elements?'}
                disabled={readOnly}
              />
            </Field>
            {String(draft.content.stem ?? '').trim() && (
              <div className="flex flex-col gap-1.5">
                <span className="text-footnote font-medium text-label-secondary">How candidates see it</span>
                <div className="rounded-xl bg-surface-sunken px-4 py-3">
                  <RichText>{String(draft.content.stem)}</RichText>
                </div>
              </div>
            )}
          </Card>

          <section className="flex flex-col gap-3" aria-labelledby="answer-title">
            <div className="flex flex-col gap-0.5">
              <h2 id="answer-title" className="text-title-3 text-label">
                {typeMeta.autoGraded ? 'Answer key' : 'Answer and grading'}
              </h2>
              <p className="text-footnote text-label-secondary">{typeMeta.description}</p>
            </div>
            <Card>
              <TypeEditor draft={draft} update={change} errors={errors} disabled={readOnly} />
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="working-title">
            <div className="flex flex-col gap-0.5">
              <h2 id="working-title" className="text-title-3 text-label">
                Show your working
              </h2>
              <p className="text-footnote text-label-secondary">Method marks, graded by a person with a rubric, on top of the marks for the answer.</p>
            </div>
            <Card className="flex flex-col gap-4">
              <Checkbox
                label="Ask candidates to show their working"
                description="They get a working area (typed or scratchpad pages) under the answer."
                checked={working.enabled}
                onCheckedChange={(v) => setWorking({ enabled: v === true, marks: v === true && !working.marks ? 1 : working.marks })}
                disabled={readOnly}
              />
              {working.enabled && (
                <div className="grid gap-4 pl-7 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <Field label="Marks for working" error={errors['content.working.marks']}>
                    <NumberStepper value={working.marks} onCommit={(marks) => setWorking({ marks })} min={0} max={100} step={0.5} decimals={2} disabled={readOnly} aria-label="Marks for working" />
                  </Field>
                  <Field label="Guidance for candidates" hint="Optional" error={errors['content.working.guidance']}>
                    <Input value={working.guidance ?? ''} onChange={(e) => setWorking({ guidance: e.target.value })} placeholder="Show each step of the substitution." maxLength={1000} disabled={readOnly} />
                  </Field>
                </div>
              )}
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="explanation-title">
            <div className="flex flex-col gap-0.5">
              <h2 id="explanation-title" className="text-title-3 text-label">
                Explanation
              </h2>
              <p className="text-footnote text-label-secondary">Shown with results when the exam allows feedback. Never shown during the exam.</p>
            </div>
            <Card>
              <Field label="Explanation" error={errors['content.explanation']}>
                <Textarea
                  value={draft.content.explanation ?? ''}
                  onChange={(e) => change((d) => ({ ...d, content: { ...d.content, explanation: e.target.value } }))}
                  rows={3}
                  placeholder="Why the right answer is right, in a sentence or two."
                  disabled={readOnly}
                />
              </Field>
            </Card>
          </section>

          {stray.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 rounded-xl bg-danger-tint px-4 py-3 text-callout text-danger-text">
              {stray.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Card className="flex flex-col gap-5">
            <Field label="Difficulty" hint="Your estimate. Athena also measures it from candidates’ answers.">
              <SegmentedControl<Difficulty>
                aria-label="Difficulty"
                block
                value={draft.difficulty}
                onValueChange={(difficulty) => !readOnly && change((d) => ({ ...d, difficulty }))}
                options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d], disabled: readOnly }))}
              />
            </Field>
            <CategoryField value={draft.categoryId} onChange={(categoryId) => change((d) => ({ ...d, categoryId }))} error={errors.categoryId} disabled={readOnly} />
            <Field label="Tags" error={errors.tags} hint="Press Enter or comma after each.">
              <ChipsInput
                value={draft.tags}
                onChange={(t) => change((d) => ({ ...d, tags: t }))}
                normalize={(s) => s.trim().toLowerCase().replace(/^#/, '')}
                suggestions={(tags.data ?? []).map((t) => t.tag)}
                placeholder="recursion, trees"
                max={20}
                disabled={readOnly}
              />
            </Field>
            <Field label="Default marks" error={errors.defaultMarks} hint="Used when the question is added to an exam. Each exam can change it.">
              <NumberStepper value={draft.defaultMarks} onCommit={(defaultMarks) => change((d) => ({ ...d, defaultMarks }))} min={0.5} max={1000} step={0.5} decimals={2} disabled={readOnly} aria-label="Default marks" />
            </Field>
          </Card>

          {question && <QuestionFacts question={question} />}
        </aside>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pl-[264px]">
        <div className="material pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl px-4 py-2.5 shadow-lg ring-1 ring-separator">
          <p className="min-w-0 flex-1 truncate text-footnote text-label-secondary" aria-live="polite">
            {readOnly
              ? archived
                ? 'Archived questions are read-only.'
                : 'You can view this question but not change it.'
              : !question
                ? 'Not saved yet.'
                : dirty
                  ? question.usage.total
                    ? `Unsaved changes. Saving creates v${question.currentVersion + 1}; ${plural(question.usage.total, 'exam')} keep v${question.currentVersion} until updated.`
                    : 'Unsaved changes.'
                  : `v${question.currentVersion} saved ${formatWhen(question.versionCreatedAt)}`}
          </p>
          {!readOnly && (
            <>
              {dirty && question && (
                <Button
                  variant="plain"
                  size="sm"
                  onClick={async () => {
                    if (await confirm({ title: 'Discard your changes?', description: 'The question goes back to the last saved version.', confirmLabel: 'Discard', destructive: true })) {
                      setDraft(draftFromQuestion(question));
                      setErrors({});
                    }
                  }}
                >
                  Discard
                </Button>
              )}
              <Button variant="filled" size="sm" onClick={save} loading={saving} disabled={!!question && !dirty}>
                {question ? 'Save' : 'Save question'}
                <Shortcut keys={['mod', 'S']} size="sm" className="ml-1 hidden opacity-70 sm:inline-flex [&_kbd]:border-transparent [&_kbd]:bg-white/20 [&_kbd]:text-current [&_kbd]:shadow-none" />
              </Button>
            </>
          )}
        </div>
      </div>

      <CandidatePreviewDialog draft={draft} open={previewOpen} onOpenChange={setPreviewOpen} />
      {question && <VersionHistorySheet questionId={question.id} type={question.type} open={historyOpen} onOpenChange={setHistoryOpen} onLoad={loadVersion} />}
    </div>
  );
}

function QuestionFacts({ question }: { question: QuestionDetail }) {
  const { usage } = question;
  return (
    <>
      <section className="flex flex-col gap-2" aria-labelledby="usage-title">
        <h2 id="usage-title" className="text-headline text-label">
          Used in
        </h2>
        {usage.total === 0 ? (
          <p className="text-footnote text-label-secondary">Not in any exam yet. Add it from an exam’s Questions tab.</p>
        ) : (
          <ul className="flex flex-col rounded-xl bg-surface shadow-xs">
            {usage.exams.map((e, i) => (
              <li key={e.examId} className={cn('flex items-center gap-2 px-4 py-2.5', i > 0 && 'border-t border-separator')}>
                <Link href={`/exams/${e.examId}/questions`} className="min-w-0 flex-1 truncate text-callout text-label hover:underline">
                  <ViewTransition name={`exam-title-${e.examId}`} share="morph" default="none">
                    <span>{e.title}</span>
                  </ViewTransition>
                </Link>
                <span className={cn('shrink-0 text-caption tabular-nums', e.pinnedVersion < question.currentVersion ? 'text-info-text' : 'text-label-tertiary')}>v{e.pinnedVersion}</span>
                <PhaseBadge phase={e.phase} size="sm" />
              </li>
            ))}
            {usage.hidden > 0 && (
              <li className={cn('px-4 py-2.5 text-footnote text-label-secondary', usage.exams.length > 0 && 'border-t border-separator')}>
                {usage.exams.length > 0 ? 'Also in' : 'In'} {plural(usage.hidden, 'exam')} you don’t have access to
              </li>
            )}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="stats-title">
        <h2 id="stats-title" className="text-headline text-label">
          Performance
        </h2>
        <dl className="flex flex-col gap-3 rounded-xl bg-surface p-4 text-footnote shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label-secondary">Observed difficulty</dt>
            <dd>
              <ObservedBar p={question.observedP} n={question.observedN} difficulty={question.difficulty} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label-secondary">Shown to candidates</dt>
            <dd className="tabular-nums text-label">{question.exposureCount ? plural(question.exposureCount, 'time') : 'Never'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label-secondary">Default marks</dt>
            <dd className="tabular-nums text-label">{formatMarks(question.defaultMarks)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-label-secondary">Created</dt>
            <dd className="text-right text-label">
              {formatWhen(question.createdAt)}
              {question.createdBy?.name ? ` by ${question.createdBy.name}` : ''}
            </dd>
          </div>
          {question.leakedAt && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-danger-text">Leaked</dt>
              <dd className="text-danger-text">{formatWhen(question.leakedAt)}</dd>
            </div>
          )}
        </dl>
      </section>
    </>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Loading question">
      <Skeleton className="h-10 w-80 max-w-full" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

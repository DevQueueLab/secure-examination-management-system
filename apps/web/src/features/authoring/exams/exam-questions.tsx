'use client';

import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Dices,
  FolderInput,
  Library,
  ListChecks,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { QUESTION_TYPE_META } from '@athena/shared';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useExam, useExamStructure } from '../api';
import { LoadError } from '../components/load-error';
import { NumberStepper } from '../components/number-stepper';
import { DifficultyPill, TypePill } from '../components/pills';
import { formatMarks, plural, stemExcerpt } from '../lib/format';
import { fixLabel, useApplyFix } from '../lib/use-apply-fix';
import type { ExamDetail, ExamQuestionRow, ExamSectionView, ReviewIssue } from '../types';
import { AddFromBankDialog } from './add-from-bank';

export function ExamQuestions({ examId }: { examId: string }) {
  const query = useExam(examId);
  if (query.isError) return <LoadError error={query.error} what="exam" onRetry={() => void query.refetch()} backHref="/exams" backLabel="All exams" />;
  if (!query.data) return <QuestionsSkeleton />;
  return <Structure exam={query.data} />;
}

/** Why the paper can't be edited right now, or null when it can. */
function readOnlyReason(exam: ExamDetail): string | null {
  if (exam.status === 'archived') return 'This exam is archived. Duplicate it to change the paper.';
  if (exam.locks.locked) return exam.locks.reason;
  if (!exam.can.edit) return 'Only the exam’s owner and co-examiners can change the paper.';
  return null;
}

function Structure({ exam }: { exam: ExamDetail }) {
  const structure = useExamStructure(exam.id);
  const applyFix = useApplyFix(exam.id);
  const [adding, setAdding] = useState<string | null>(null);
  const locked = readOnlyReason(exam);
  const paper = exam.review.paper;
  const mismatch = paper.computedTotal !== paper.declaredTotal;
  const totalFix = exam.review.errors.find((e) => e.fix?.kind === 'set_total');
  const published = exam.status === 'published';

  const addSection = () => {
    const letter = String.fromCharCode(65 + exam.sections.length);
    structure.createSection.mutate(
      { title: `Section ${letter}` },
      { onSuccess: () => toast.success(`Section ${letter} added`), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {locked && (
        <div className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 text-callout text-label-secondary shadow-xs">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
          <p>{locked}</p>
        </div>
      )}
      {!locked && published && (
        <div className="flex items-start gap-3 rounded-xl bg-info-tint px-4 py-3 text-callout text-info-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>This exam is published, so every change must keep it publishable (marks adding up, pools full). To make several changes at once, unpublish it first from the overview.</p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl bg-surface px-5 py-4 shadow-xs sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {mismatch ? <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning-text" /> : <CircleCheck aria-hidden className="size-5 shrink-0 text-success-text" />}
          <div className="flex min-w-0 flex-col">
            <p className="text-headline tabular-nums text-label">
              {formatMarks(paper.computedTotal)} of {formatMarks(paper.declaredTotal)} marks
            </p>
            <p className="text-footnote text-label-secondary">
              {mismatch
                ? `Each paper is worth ${formatMarks(paper.computedTotal)}, but the exam declares ${formatMarks(paper.declaredTotal)}. Change question marks, or update the total.`
                : `Each candidate answers ${plural(paper.deliveredCount, 'question')}${paper.workingMarks ? `, including ${formatMarks(paper.workingMarks)} marks for working` : ''}.`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {mismatch && !locked && (totalFix?.fix || paper.computedTotal > 0) && (
            <Button variant="tinted" size="sm" loading={applyFix.isPending} onClick={() => applyFix.mutate(totalFix?.fix ?? { kind: 'set_total', value: paper.computedTotal })}>
              {fixLabel(totalFix?.fix ?? { kind: 'set_total', value: paper.computedTotal })}
            </Button>
          )}
          <Button asChild variant="plain" size="sm">
            <Link href={`/exams/${exam.id}/grading?tab=rubrics`}>
              Rubrics
            </Link>
          </Button>
        </div>
      </div>

      {exam.sections.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No sections yet"
          description="Sections group questions on the paper. A section can also be a pool that draws a few questions at random for each candidate."
          action={
            !locked && (
              <Button variant="filled" onClick={addSection} loading={structure.createSection.isPending}>
                <Plus aria-hidden /> Add a section
              </Button>
            )
          }
        />
      ) : (
        exam.sections.map((section, index) => (
          <SectionBlock
            key={section.id}
            exam={exam}
            section={section}
            index={index}
            locked={!!locked}
            onAdd={() => setAdding(section.id)}
          />
        ))
      )}

      {!locked && exam.sections.length > 0 && (
        <div>
          <Button variant="gray" onClick={addSection} loading={structure.createSection.isPending}>
            <Plus aria-hidden /> Add section
          </Button>
        </div>
      )}

      {adding && <AddFromBankDialog exam={exam} sectionId={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function SectionBlock({ exam, section, index, locked, onAdd }: { exam: ExamDetail; section: ExamSectionView; index: number; locked: boolean; onAdd: () => void }) {
  const structure = useExamStructure(exam.id);
  const applyFix = useApplyFix(exam.id);
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(section.title);
  const n = section.questions.length;
  const isPool = section.drawCount !== null;
  const issues = [...exam.review.errors, ...exam.review.warnings].filter((i) => i.sectionId === section.id && !i.examQuestionId);
  const sectionTotal = section.paper?.total ?? section.questions.reduce((s, q) => s + q.marks, 0);

  const saveTitle = () => {
    setRenaming(false);
    const next = title.trim();
    if (!next || next === section.title) {
      setTitle(section.title);
      return;
    }
    structure.updateSection.mutate({ sectionId: section.id, title: next }, { onError: (e) => (toast.error(errorMessage(e)), setTitle(section.title)) });
  };

  const setDraw = (drawCount: number | null) =>
    structure.updateSection.mutate({ sectionId: section.id, drawCount }, { onError: (e) => toast.error(errorMessage(e)) });

  const move = (dir: -1 | 1) => {
    const order = exam.sections.map((s) => s.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + dir, 0, moved!);
    structure.reorderSections.mutate(order, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${section.title}?`,
      description: n ? `Its ${plural(n, 'question')} are removed from this exam (they stay in the bank).` : 'The section is empty.',
      confirmLabel: 'Delete section',
      destructive: true,
    });
    if (ok) structure.deleteSection.mutate(section.id, { onSuccess: () => toast.success('Section deleted'), onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <section className="flex flex-col gap-2" aria-label={section.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        {renaming ? (
          <Input
            autoFocus
            size="sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') {
                setTitle(section.title);
                setRenaming(false);
              }
            }}
            maxLength={120}
            aria-label="Section title"
            containerClassName="w-64"
          />
        ) : (
          <h2 className="text-title-3 text-label">{section.title}</h2>
        )}
        <span className="flex gap-3 text-footnote tabular-nums text-label-secondary">
          <span>{isPool ? `Draws ${section.drawCount} of ${n}` : plural(n, 'question')}</span>
          <span>{formatMarks(sectionTotal)} marks</span>
        </span>
        {!locked && (
          <div className="ml-auto flex items-center gap-2">
            {n > 1 && (
              <div className="flex items-center gap-2 rounded-lg bg-fill-secondary py-0.5 pl-2.5 pr-0.5">
                <Dices aria-hidden className="size-3.5 text-label-tertiary" />
                {isPool ? (
                  <>
                    <span className="text-footnote text-label-secondary">Draw</span>
                    <NumberStepper size="sm" value={section.drawCount} min={1} max={n} onCommit={(v) => setDraw(v)} aria-label="Questions drawn per candidate" className="bg-surface" />
                    <span className="text-footnote text-label-secondary">of {n}</span>
                    <Button variant="ghost" size="sm" onClick={() => setDraw(null)}>
                      Use all
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setDraw(Math.max(1, n - 1))}>
                    Draw at random
                  </Button>
                )}
              </div>
            )}
            <Button variant="tinted" size="sm" onClick={onAdd}>
              <Library aria-hidden /> Add from bank
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${section.title} actions`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem icon={<ChevronUp />} disabled={index === 0} onSelect={() => move(-1)}>
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem icon={<ChevronDown />} disabled={index === exam.sections.length - 1} onSelect={() => move(1)}>
                  Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 />} destructive onSelect={remove}>
                  Delete section
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {issues.map((issue, i) => (
        <SectionIssue key={`${issue.code}-${i}`} issue={issue} locked={locked} onFix={() => issue.fix && applyFix.mutate(issue.fix)} pending={applyFix.isPending} />
      ))}

      {n === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-separator-strong px-6 py-8 text-center">
          <p className="text-callout text-label-secondary">No questions in this section yet.</p>
          {!locked && (
            <Button variant="tinted" size="sm" onClick={onAdd}>
              <Library aria-hidden /> Add from bank
            </Button>
          )}
        </div>
      ) : (
        <ol className="flex flex-col rounded-xl bg-surface shadow-xs">
          {section.questions.map((q, i) => (
            <QuestionRow key={q.id} exam={exam} section={section} q={q} index={i} locked={locked} />
          ))}
        </ol>
      )}
    </section>
  );
}

function SectionIssue({ issue, locked, onFix, pending }: { issue: ReviewIssue; locked: boolean; onFix: () => void; pending: boolean }) {
  const error = issue.severity === 'error';
  return (
    <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-footnote', error ? 'bg-danger-tint text-danger-text' : 'bg-warning-tint text-warning-text')}>
      {error ? <CircleAlert aria-hidden className="size-4 shrink-0" /> : <TriangleAlert aria-hidden className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">{issue.message}</span>
      {issue.fix && !locked && (
        <Button variant="gray" size="sm" loading={pending} onClick={onFix}>
          {fixLabel(issue.fix)}
        </Button>
      )}
    </div>
  );
}

function QuestionRow({ exam, section, q, index, locked }: { exam: ExamDetail; section: ExamSectionView; q: ExamQuestionRow; index: number; locked: boolean }) {
  const structure = useExamStructure(exam.id);
  const confirm = useConfirm();
  const written = !QUESTION_TYPE_META[q.type].autoGraded || q.workingMarks > 0;
  const behind = q.latestVersion > q.pinnedVersion;
  const err = (e: unknown) => toast.error(errorMessage(e));
  const others = exam.sections.filter((s) => s.id !== section.id);

  const remove = async () => {
    const ok = await confirm({
      title: `Remove “${q.title}”?`,
      description: 'It leaves this exam only. The question stays in the bank.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) structure.removeQuestion.mutate(q.id, { onError: err });
  };

  return (
    <li className={cn('flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center', index > 0 && 'border-t border-separator')}>
      <span className="hidden w-6 shrink-0 text-right text-footnote tabular-nums text-label-tertiary sm:block">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href={`/questions/${q.questionId}`} className="truncate text-callout font-medium text-label hover:underline">
            {q.title}
          </Link>
          <TypePill type={q.type} />
          <DifficultyPill difficulty={q.difficulty} />
          {q.bankStatus === 'archived' && (
            <Badge size="sm" tone="warning">
              Archived in bank
            </Badge>
          )}
          {q.leaked && (
            <Badge size="sm" tone="danger">
              Leaked
            </Badge>
          )}
        </div>
        <p className="truncate text-footnote text-label-secondary">{stemExcerpt(q.stem, 180)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
          <span>v{q.pinnedVersion}</span>
          {behind && <span className="text-info-text">v{q.latestVersion} available</span>}
          {written && (
            <Link href={`/exams/${exam.id}/grading?tab=rubrics`} className={cn('hover:underline', q.rubricCount ? 'text-label-tertiary' : 'text-warning-text')}>
              {q.rubricCount ? `Rubric: ${plural(q.rubricCount, 'criterion', 'criteria')}` : 'No rubric yet'}
            </Link>
          )}
          {q.observedP !== null && <span title="Share of marks real candidates earned">{Math.round(q.observedP * 100)}% earned</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        {behind && !locked && (
          <Tooltip content={`Pin v${q.latestVersion}, the bank’s latest`}>
            <Button variant="ghost" size="sm" loading={structure.updateQuestion.isPending && structure.updateQuestion.variables?.examQuestionId === q.id && !!structure.updateQuestion.variables?.repin} onClick={() => structure.updateQuestion.mutate({ examQuestionId: q.id, repin: true }, { onSuccess: () => toast.success(`Now using v${q.latestVersion}`), onError: err })}>
              <RefreshCw aria-hidden /> Update
            </Button>
          </Tooltip>
        )}
        <div className="flex items-center gap-1.5">
          <NumberStepper
            size="sm"
            value={q.marks}
            min={0.5}
            max={1000}
            step={0.5}
            decimals={2}
            disabled={locked}
            onCommit={(marks) => structure.updateQuestion.mutate({ examQuestionId: q.id, marks }, { onError: err })}
            aria-label={`Marks for ${q.title}`}
          />
          <span className="w-16 text-caption text-label-tertiary">{q.workingMarks ? `+${formatMarks(q.workingMarks)} working` : 'marks'}</span>
        </div>
        {!locked && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${q.title}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<ChevronUp />} disabled={index === 0} onSelect={() => structure.updateQuestion.mutate({ examQuestionId: q.id, position: index - 1 }, { onError: err })}>
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<ChevronDown />}
                disabled={index === section.questions.length - 1}
                onSelect={() => structure.updateQuestion.mutate({ examQuestionId: q.id, position: index + 1 }, { onError: err })}
              >
                Move down
              </DropdownMenuItem>
              {others.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  {others.map((s) => (
                    <DropdownMenuItem key={s.id} icon={<FolderInput />} onSelect={() => structure.updateQuestion.mutate({ examQuestionId: q.id, sectionId: s.id }, { onError: err })}>
                      {s.title}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} destructive onSelect={remove}>
                Remove from exam
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function QuestionsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Loading questions">
      <Skeleton className="h-20 rounded-xl" />
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

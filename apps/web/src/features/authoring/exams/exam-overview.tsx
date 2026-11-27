'use client';

import {
  Archive,
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  Lock,
  MoreHorizontal,
  Send,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MarksRule } from '@/components/ui/marks-rule';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useExam, useExamLifecycle, useSandboxAttempt } from '../api';
import { LoadError } from '../components/load-error';
import { formatMinutes, formatWhen, relativeTo } from '../lib/datetime';
import { formatMarks, plural } from '../lib/format';
import { fixLabel, useApplyFix } from '../lib/use-apply-fix';
import type { ChecklistItem, ExamDetail, NextActionKey } from '../types';
import { nextActionHref } from './exam-list';
import { PublishDialog } from './publish-dialog';
import { StaffPanel } from './staff-panel';

const NEXT_COPY: Record<NextActionKey, string> = {
  add_questions: 'The paper is empty. Pick questions from the bank, or write new ones there first.',
  fix_issues: 'The review found problems that would stop this exam from publishing.',
  review_publish: 'Everything checks out. Review the paper once more and publish to schedule it.',
  enroll: 'No one is enrolled yet. Add candidates individually, by cohort, or from a spreadsheet.',
  preview: 'Take the paper yourself as a candidate would. Previews never count in results or statistics.',
  monitor: 'The window is open. Watch attempts and integrity signals as they happen.',
  grade: 'Written answers are waiting for a grader.',
  publish_results: 'Grading is complete. Publish results when you’re ready for candidates to see them.',
  analytics: 'See how each question performed and how fair the papers were.',
};

export function ExamOverview({ examId }: { examId: string }) {
  const query = useExam(examId);
  if (query.isError) return <LoadError error={query.error} what="exam" onRetry={() => void query.refetch()} backHref="/exams" backLabel="All exams" />;
  if (!query.data) return <OverviewSkeleton />;
  return <Overview exam={query.data} />;
}

function Overview({ exam }: { exam: ExamDetail }) {
  const router = useRouter();
  const confirm = useConfirm();
  const lifecycle = useExamLifecycle(exam.id);
  const sandbox = useSandboxAttempt();
  const [publishOpen, setPublishOpen] = useState(false);
  const draft = exam.status === 'draft';
  const archived = exam.status === 'archived';
  const errors = exam.review.errors;
  const active = exam.counts.attempts.inProgress + exam.counts.attempts.awaitingSync;

  const preview = () => {
    // Open the tab inside the click so popup blockers allow it, then point it at the attempt.
    const tab = window.open('about:blank', '_blank');
    sandbox.mutate(exam.id, {
      onSuccess: (attempt) => {
        if (tab) tab.location.href = `/attempt/${attempt.id}`;
        else router.push(`/attempt/${attempt.id}`);
      },
      onError: (e) => {
        tab?.close();
        toast.error(errorMessage(e, 'Couldn’t start a preview.'));
      },
    });
  };

  const unpublish = async () => {
    const ok = await confirm({
      title: 'Unpublish this exam?',
      description: 'It goes back to draft and disappears from candidates’ dashboards until you publish it again. Enrollments are kept.',
      confirmLabel: 'Unpublish',
    });
    if (ok) lifecycle.mutate('unpublish', { onSuccess: () => toast.success('Back to draft'), onError: (e) => toast.error(errorMessage(e)) });
  };

  const archive = async () => {
    const ok = await confirm({
      title: 'Archive this exam?',
      description: 'It becomes read-only and moves to the Archived filter. Attempts, grades and results are kept and stay viewable.',
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (ok) lifecycle.mutate('archive', { onSuccess: () => toast.success('Exam archived'), onError: (e) => toast.error(errorMessage(e)) });
  };

  const duplicate = () =>
    lifecycle.mutate('duplicate', {
      onSuccess: (copy) => {
        toast.success('Copy created as a draft');
        router.push(`/exams/${copy.id}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const next = exam.nextAction;
  const nextButton = (() => {
    if (!next) return null;
    if (next.key === 'review_publish' || next.key === 'fix_issues') {
      if (!exam.can.publish && next.key === 'review_publish') return null;
      return (
        <Button variant="filled" onClick={() => setPublishOpen(true)}>
          {next.label}
        </Button>
      );
    }
    if (next.key === 'preview')
      return (
        <Button variant="filled" onClick={preview} loading={sandbox.isPending}>
          <Eye aria-hidden /> {next.label}
        </Button>
      );
    if (next.key === 'add_questions' && !exam.can.edit) return null;
    if (next.key === 'enroll' && !exam.can.manageCandidates) return null;
    return (
      <Button asChild variant="filled">
        <Link href={nextActionHref(exam.id, next.key)}>
          {next.label}
        </Link>
      </Button>
    );
  })();

  return (
    <div className="flex flex-col gap-8">
      {(exam.locks.locked || archived) && (
        <div className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 text-callout text-label-secondary shadow-xs">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
          <p>{archived ? 'This exam is archived and read-only. Duplicate it to run it again.' : exam.locks.reason}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-xs sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-headline text-label">{next ? next.label : archived ? 'Archived' : 'Nothing needs you right now'}</p>
          <p className="text-callout text-label-secondary">{next ? NEXT_COPY[next.key] : 'Everything for this exam is done.'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {next?.key !== 'preview' && !archived && (
            <Button variant="gray" onClick={preview} loading={sandbox.isPending}>
              <Eye aria-hidden /> Preview as candidate
            </Button>
          )}
          {draft && exam.can.publish && next?.key !== 'review_publish' && next?.key !== 'fix_issues' && (
            <Button variant="gray" onClick={() => setPublishOpen(true)}>
              <Send aria-hidden /> Review and publish
            </Button>
          )}
          {nextButton}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="gray" size="icon" aria-label="More actions">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!draft && !archived && exam.can.publish && (
                <DropdownMenuItem icon={<Undo2 />} disabled={exam.locks.realAttempts > 0} onSelect={unpublish}>
                  {exam.locks.realAttempts > 0 ? 'Unpublish (candidates have started)' : 'Unpublish'}
                </DropdownMenuItem>
              )}
              {exam.can.duplicate && (
                <DropdownMenuItem icon={<Copy />} onSelect={duplicate}>
                  Duplicate as draft
                </DropdownMenuItem>
              )}
              {exam.can.archive && !archived && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Archive />} destructive disabled={active > 0} onSelect={archive}>
                    {active > 0 ? `Archive (${plural(active, 'attempt')} running)` : 'Archive'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <Facts exam={exam} />
          <Readiness exam={exam} onOpenReview={() => setPublishOpen(true)} />
          <Paper exam={exam} />
        </div>
        <aside className="flex flex-col gap-8">
          <StaffPanel exam={exam} />
          {exam.description && (
            <section className="flex flex-col gap-2">
              <h2 className="text-headline text-label">About</h2>
              <p className="whitespace-pre-line text-callout text-label-secondary">{exam.description}</p>
            </section>
          )}
        </aside>
      </div>

      {publishOpen && <PublishDialog exam={exam} open={publishOpen} onOpenChange={setPublishOpen} />}
    </div>
  );
}

function Facts({ exam }: { exam: ExamDetail }) {
  const paper = exam.review.paper;
  const mismatch = paper.computedTotal !== exam.totalMarks;
  const base = `/exams/${exam.id}`;
  const a = exam.counts.attempts;
  // Rendered only on the client (the exam loads through a query), so reading the clock here is safe.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const opens = new Date(exam.windowOpensAt).getTime();
  const closes = new Date(exam.windowClosesAt).getTime();
  const status = now < opens ? `Opens ${relativeTo(exam.windowOpensAt)}` : now < closes ? `Closes ${relativeTo(exam.windowClosesAt)}` : `Closed ${relativeTo(exam.windowClosesAt)}`;
  const facts: { label: string; value: string | number; hint: ReactNode; href?: string }[] = [
    {
      label: 'Questions',
      value: paper.deliveredCount,
      hint: paper.questionCount !== paper.deliveredCount ? `drawn from ${paper.questionCount} in ${plural(exam.counts.sections, 'section')}` : plural(exam.counts.sections, 'section'),
      href: `${base}/questions`,
    },
    {
      label: 'Marks',
      value: formatMarks(paper.computedTotal),
      hint: mismatch ? <span className="text-warning-text">declared {formatMarks(exam.totalMarks)}</span> : paper.workingMarks ? `incl. ${formatMarks(paper.workingMarks)} for working` : 'matches the declared total',
      href: `${base}/questions`,
    },
    { label: 'Enrolled', value: exam.counts.enrolled, hint: exam.counts.enrolled ? 'candidates' : 'no one yet', href: exam.can.manageCandidates ? `${base}/candidates` : undefined },
    {
      label: exam.phase === 'ongoing' ? 'Writing now' : 'Submitted',
      value: exam.phase === 'ongoing' ? a.inProgress : a.submitted,
      hint: exam.phase === 'ongoing' ? `${a.submitted} submitted` : a.total ? `${exam.counts.pendingGrading} awaiting grading` : 'no attempts yet',
    },
  ];
  return (
    <section className="flex flex-col gap-6" aria-label="Key facts">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-callout text-label-secondary">
          <span>
            Opens <time dateTime={exam.windowOpensAt} className="text-label">{formatWhen(exam.windowOpensAt)}</time>
          </span>
          <span className={cn('font-medium', exam.phase === 'ongoing' ? 'text-accent-text' : 'text-label')}>{status}</span>
          <span>
            Closes <time dateTime={exam.windowClosesAt} className="text-label">{formatWhen(exam.windowClosesAt)}</time>
          </span>
        </div>
        <MarksRule value={now} min={opens} max={closes} label="Exam window" valueText={status} tone={exam.phase === 'ongoing' ? 'accent' : 'neutral'} />
        <p className="text-footnote text-label-secondary">
          <span className="text-label">{formatMinutes(exam.durationMinutes)}</span> per candidate, any time inside the window
        </p>
      </div>
      <dl className="grid grid-cols-2 border-y border-separator sm:grid-cols-4 sm:divide-x sm:divide-separator">
        {facts.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-0.5 py-3 sm:px-4 sm:first:pl-0">
            <dt className="text-footnote text-label-secondary">
              {f.href ? (
                <Link href={f.href} className="hover:text-label hover:underline">
                  {f.label}
                </Link>
              ) : (
                f.label
              )}
            </dt>
            <dd className="numeral text-title-1 text-label">{f.value}</dd>
            <dd className="truncate text-caption text-label-tertiary">{f.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const CHECK_ICON = {
  ok: <CircleCheck aria-hidden className="size-4 text-success-text" />,
  warning: <TriangleAlert aria-hidden className="size-4 text-warning-text" />,
  error: <CircleAlert aria-hidden className="size-4 text-danger-text" />,
};

function checkHref(examId: string, item: ChecklistItem): string {
  const base = `/exams/${examId}`;
  switch (item.key) {
    case 'questions':
    case 'marks':
    case 'pools':
      return `${base}/questions`;
    case 'rubrics':
      return `${base}/grading?tab=rubrics`;
    case 'candidates':
      return `${base}/candidates`;
    default:
      return `${base}/settings`;
  }
}

function Readiness({ exam, onOpenReview }: { exam: ExamDetail; onOpenReview: () => void }) {
  const applyFix = useApplyFix(exam.id);
  const { checklist, errors } = exam.review;
  const fixable = errors.filter((e) => e.fix);
  const failing = checklist.filter((c) => c.status === 'error').length;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="readiness-title">
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="readiness-title" className="text-headline text-label">
            Readiness
          </h2>
          <p className="text-footnote text-label-secondary">
            {exam.status === 'draft'
              ? failing
                ? `${plural(failing, 'check')} must pass before you can publish.`
                : 'All blocking checks pass.'
              : 'Checked again on every change, so a published exam can’t drift into a broken state.'}
          </p>
        </div>
        {exam.status === 'draft' && exam.can.publish && (
          <Button variant="plain" size="sm" onClick={onOpenReview}>
            Full review
          </Button>
        )}
      </div>
      <ul className="flex flex-col rounded-xl bg-surface shadow-xs">
        {checklist.map((item, i) => (
          <li key={item.key} className={cn('flex items-start gap-3 px-4 py-3', i > 0 && 'border-t border-separator')}>
            <span className="mt-0.5 shrink-0">{CHECK_ICON[item.status]}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-callout font-medium text-label">
                {item.label}
                <span className="sr-only">: {item.status === 'ok' ? 'passing' : item.status === 'error' ? 'blocking' : 'warning'}</span>
              </span>
              <span className="text-footnote text-label-secondary">{item.detail}</span>
            </span>
            {item.status !== 'ok' && (
              <Button asChild variant="plain" size="sm" className="shrink-0">
                <Link href={checkHref(exam.id, item)}>
                  {item.key === 'rubrics' ? 'Rubrics' : 'Open'}
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {fixable.length > 0 && exam.can.edit && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-footnote text-label-secondary">Quick fixes:</span>
          {fixable.map((issue, i) => (
            <Tooltip key={`${issue.code}-${i}`} content={issue.message}>
              <Button variant="tinted" size="sm" loading={applyFix.isPending && applyFix.variables === issue.fix} onClick={() => applyFix.mutate(issue.fix!)}>
                {fixLabel(issue.fix!)}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </section>
  );
}

function Paper({ exam }: { exam: ExamDetail }) {
  const sections = exam.review.paper.sections;
  if (!sections.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="paper-title">
      <div className="flex items-end justify-between gap-2">
        <h2 id="paper-title" className="text-headline text-label">
          Paper
        </h2>
        <Button asChild variant="plain" size="sm">
          <Link href={`/exams/${exam.id}/questions`}>
            {exam.can.edit && !exam.locks.locked ? 'Edit questions' : 'View questions'}
          </Link>
        </Button>
      </div>
      <ul className="flex flex-col rounded-xl bg-surface shadow-xs">
        {sections.map((s, i) => (
          <li key={s.id} className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-separator')}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-callout font-medium text-label">{s.title}</span>
              <span className="text-footnote text-label-secondary">
                {s.isPool ? `Draws ${s.drawCount} of ${s.poolSize} at random` : plural(s.poolSize, 'question')}
                {s.workingMarks ? `, ${formatMarks(s.workingMarks)} for working` : ''}
              </span>
            </span>
            <span className="shrink-0 text-callout tabular-nums text-label">
              {formatMarks(s.total)} <span className="text-label-tertiary">marks</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy aria-label="Loading exam">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}

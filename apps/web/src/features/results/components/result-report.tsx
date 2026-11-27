'use client';

import { Check, Copy, FileText, Hourglass, MessageSquareWarning, ShieldCheck, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumbs } from '@/components/ui/page-header';
import { ShellTitle } from '@/components/shell/shell-title';
import { ScoreHistory } from '@/features/disputes/score-history';
import { ProgressRing } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useQueryClient } from '@tanstack/react-query';
import { Meter } from '../../analytics/components/charts';
import { fmtDate, fmtDateTime, fmtMarks, fmtPercent, fmtSigned, ordinal } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import { Prose } from '../../grading/components/prose';
import { downloadPdf, resultsKeys, useIssueReport, useMyResult } from '../api';
import type { ItemOutcome, MyResultDetail, ResultItem, Verification } from '../types';

const OUTCOME: Record<ItemOutcome, { tone: Tone; label: string; mark: string }> = {
  correct: { tone: 'success', label: 'Correct', mark: '✓' },
  partial: { tone: 'info', label: 'Part marks', mark: '½' },
  incorrect: { tone: 'danger', label: 'Incorrect', mark: '✕' },
  unanswered: { tone: 'neutral', label: 'Not answered', mark: '–' },
  pending: { tone: 'neutral', label: 'Being graded', mark: '…' },
  voided: { tone: 'neutral', label: 'Dropped for everyone', mark: '∅' },
};

const CHIP: Record<Tone, string> = {
  success: 'bg-success-tint text-success-text',
  info: 'bg-info-tint text-info-text',
  danger: 'bg-danger-tint text-danger-text',
  neutral: 'bg-fill text-label-secondary',
  warning: 'bg-warning-tint text-warning-text',
  accent: 'bg-accent-tint text-accent-text',
};

function VerificationCard({ attemptId, verification }: { attemptId: string; verification: Verification | null }) {
  const issue = useIssueReport(attemptId);
  const [copied, setCopied] = useState(false);
  const v = verification ?? (issue.data ? { code: issue.data.code, url: issue.data.url, issuedAt: issue.data.issuedAt, qrDataUrl: issue.data.qrDataUrl } : null);
  if (!v) {
    return (
      <Card>
        <CardHeader title="Verification" description="A signed code lets an employer or another institution confirm this result without seeing anything else." />
        <Button variant="tinted" loading={issue.isPending} onClick={() => issue.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
          <ShieldCheck /> Get a verification code
        </Button>
      </Card>
    );
  }
  const verifyPath = `/verify/${v.code}`;
  return (
    <Card>
      <CardHeader title="Verification" description={`Signed ${fmtDate(v.issuedAt)}. Anyone with the code can check it.`} />
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered QR data URL */}
        <img src={v.qrDataUrl} alt={`QR code for verification code ${v.code}`} className="size-28 shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-separator" />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-mono text-callout font-semibold tracking-wide text-label">{v.code}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="gray"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(v.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  toast.error('Copy failed. Select the code and copy it instead.');
                }
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" variant="plain" asChild>
              <Link href={verifyPath} target="_blank">
                Open check page
              </Link>
            </Button>
          </div>
          <p className="text-footnote text-label-secondary">The check page shows only your initials, the exam, the score and the issue date.</p>
        </div>
      </div>
    </Card>
  );
}

function QuestionCard({ item, attemptId, disputes }: { item: ResultItem; attemptId: string; disputes: { allowed: boolean } }) {
  const o = OUTCOME[item.outcome];
  const r = item.response;
  return (
    <article id={`q-${item.itemId}`} className="scroll-mt-28 p-5" aria-labelledby={`q-${item.itemId}-title`}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 id={`q-${item.itemId}-title`} className="flex gap-2.5 text-headline text-label">
            <span className="tabular-nums">Q{item.number}</span>
            <span>{item.title}</span>
          </h3>
          <p className="text-footnote text-label-secondary">
            <Meta items={[item.typeLabel, item.category]} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={o.tone} size="sm">
            {o.label}
          </Badge>
          {item.outcome !== 'voided' && (
            <span className="text-callout font-semibold tabular-nums text-label">
              {item.score === null ? '–' : fmtMarks(item.score)}
              <span className="font-normal text-label-secondary"> / {fmtMarks(item.max)}</span>
            </span>
          )}
        </div>
      </header>

      {item.voidReason && <p className="mt-3 rounded-lg bg-fill-secondary px-3 py-2 text-subheadline text-label-secondary">Removed from scoring for everyone: {item.voidReason}</p>}

      {item.stem && (
        <div className="mt-4 text-label-secondary">
          <Prose className="text-callout">{item.stem}</Prose>
        </div>
      )}

      <dl className="mt-4 flex flex-col gap-3">
        <div>
          <dt className="text-footnote font-medium text-label-secondary">Your answer</dt>
          <dd className="mt-1">
            {!item.answered || !r.text ? (
              <span className="text-callout text-label-tertiary">No answer</span>
            ) : r.format === 'code' ? (
              <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-[13px] leading-relaxed text-label">{r.text}</pre>
            ) : (
              <p className="whitespace-pre-wrap break-words text-callout text-label">{r.text}</p>
            )}
          </dd>
        </div>
        {/* A right objective answer repeated back adds nothing, unless there is an explanation to go with it. */}
        {item.correctAnswer && (item.type === 'long_text' || item.type === 'code' || item.outcome !== 'correct' || item.explanation) && (
          <div className="rounded-lg bg-success-tint px-3 py-2.5">
            <dt className="text-footnote font-medium text-success-text">{item.type === 'long_text' || item.type === 'code' ? 'Model answer' : 'Correct answer'}</dt>
            <dd className={cn('mt-1 whitespace-pre-wrap break-words text-callout text-label', item.type === 'code' && 'font-mono text-[13px]')}>{item.correctAnswer}</dd>
            {item.explanation && <dd className="mt-1.5 text-subheadline text-label-secondary">{item.explanation}</dd>}
          </div>
        )}
        {item.rubric.length > 0 && (
          <div>
            <dt className="text-footnote font-medium text-label-secondary">Marked for</dt>
            <dd className="mt-1">
              <ul className="flex flex-col gap-1">
                {item.rubric.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-callout">
                    <span className={cn('w-10 shrink-0 font-semibold tabular-nums', c.points < 0 ? 'text-danger-text' : 'text-label')}>{fmtSigned(c.points)}</span>
                    <span className="text-label">
                      {c.label}
                      {c.target === 'working' && <span className="text-label-secondary"> (working)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {item.feedback && (
          <div>
            <dt className="text-footnote font-medium text-label-secondary">Feedback from your grader</dt>
            <dd className="mt-1 whitespace-pre-wrap text-callout text-label">{item.feedback}</dd>
          </div>
        )}
      </dl>

      {disputes.allowed && item.outcome !== 'voided' && (
        <div className="mt-4">
          <Link
            href={`/my-disputes?attemptId=${attemptId}&itemId=${item.itemId}`}
            className="inline-flex items-center gap-1.5 rounded-sm text-subheadline font-medium text-accent-text outline-none hover:underline focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus"
          >
            <MessageSquareWarning aria-hidden className="size-4" /> Raise a dispute about this question
          </Link>
        </div>
      )}
    </article>
  );
}

/**
 * The result page's own heading: the one place the display face appears in the app's pages.
 * Athens at 44px, normal weight, no caps and no tracking; numbers elsewhere stay in the sans with tabular figures.
 */
function ResultHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-6 pt-2 sm:pt-4">
      <Breadcrumbs items={[{ label: 'Results', href: '/results' }, { label: title }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[2.75rem] font-normal normal-case leading-[1.1] tracking-normal text-label">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-body text-label-secondary">{subtitle}</p>}
          <ShellTitle title={title} />
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

function Awaiting({ data }: { data: Extract<MyResultDetail, { published: false }> }) {
  return (
    <>
      <ResultHeader title={data.exam.title} subtitle={data.exam.code ?? undefined} />
      <EmptyState
        icon={<Hourglass />}
        title="Awaiting publication"
        description={
          data.status === 'submitted'
            ? `You submitted ${data.submittedAt ? `on ${fmtDateTime(data.submittedAt)}` : ''}, answering a paper of ${data.itemCount} questions. Your examiner publishes results after grading, and you’ll get a notification.`
            : 'This attempt hasn’t been submitted yet.'
        }
        action={
          <Button variant="gray" asChild>
            <Link href="/results">All results</Link>
          </Button>
        }
      />
    </>
  );
}

export function ResultReport({ attemptId }: { attemptId: string }) {
  const { data, isPending, error } = useMyResult(attemptId);
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  if (isPending) {
    return (
      <div className="flex flex-col gap-5 pt-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    const missing = isApiError(error) && (error.isNotFound || error.isForbidden);
    return (
      <EmptyState
        className="mt-6"
        icon={<Trophy />}
        title={missing ? 'Result not found' : 'Couldn’t load this result'}
        description={missing ? 'It may belong to another account, or the link is wrong.' : errorMessage(error)}
        action={
          <Button variant="gray" asChild>
            <Link href="/results">All results</Link>
          </Button>
        }
      />
    );
  }
  if (!data.published) return <Awaiting data={data} />;

  const card = data.result;
  const passMark = card.exam.passPercent;
  const download = async () => {
    setDownloading(true);
    try {
      await downloadPdf(`/reports/attempts/${attemptId}/pdf`, 'result-report.pdf');
      void qc.invalidateQueries({ queryKey: resultsKeys.mineDetail(attemptId) });
    } catch (e) {
      toast.error(errorMessage(e, 'The report could not be generated.'));
    } finally {
      setDownloading(false);
    }
  };
  const answered = card.items.filter((i) => i.outcome !== 'voided');

  return (
    <>
      <ResultHeader
        title={card.exam.title}
        subtitle={<Meta items={[card.organization.name, card.exam.code, data.publishedAt ? `Published ${fmtDate(data.publishedAt)}` : null]} />}
        actions={
          <Button variant="filled" loading={downloading} onClick={() => void download()}>
            <FileText /> Download PDF report
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card padding="lg" className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <ProgressRing value={card.percent} size={132} thickness={11} label={`Score ${fmtPercent(card.percent, 1)}`}>
              <span className="font-sans text-[1.75rem] font-bold leading-none tabular-nums text-label">{fmtPercent(card.percent, card.percent % 1 ? 1 : 0)}</span>
            </ProgressRing>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-sans text-title-1 tabular-nums text-label">
                {fmtMarks(card.score)} <span className="text-title-3 font-normal text-label-secondary">of {fmtMarks(card.maxScore)} marks</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {card.pass !== null && (
                  <Badge tone={card.pass ? 'success' : 'danger'}>{card.pass ? 'Passed' : 'Below the pass mark'}</Badge>
                )}
                {passMark !== null && <span className="text-subheadline tabular-nums text-label-secondary">Pass mark {fmtPercent(passMark)}</span>}
                {card.gradingStatus !== 'complete' && <Badge tone="warning">Some answers still being graded</Badge>}
              </div>
              <p className="text-subheadline tabular-nums text-label-secondary">
                <Meta
                  items={[
                    card.cohort.percentile !== null ? `Higher than ${card.cohort.percentile}% of candidates` : null,
                    card.cohort.rank !== null ? `${ordinal(card.cohort.rank)} of ${card.cohort.size}` : null,
                    card.cohort.meanPercent !== null ? `Average ${fmtPercent(card.cohort.meanPercent)}` : null,
                  ]}
                />
              </p>
            </div>
          </Card>
          <VerificationCard attemptId={attemptId} verification={data.verification} />
        </div>

        {(card.strengths.length > 0 || card.weaknesses.length > 0 || card.topics.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {card.topics.length > 0 && (
              <Card>
                <CardHeader
                  title="By topic"
                  description={
                    card.strengths.length || card.weaknesses.length
                      ? [card.strengths.length ? `Strongest: ${card.strengths.join(', ')}` : null, card.weaknesses.length ? `Work on: ${card.weaknesses.join(', ')}` : null].filter(Boolean).join('. ')
                      : 'Share of marks earned in each topic'
                  }
                />
                <ul className="flex flex-col gap-3">
                  {card.topics.map((t) => (
                    <li key={t.category} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3">
                      <span className="truncate text-callout text-label">{t.category}</span>
                      <Meter value={t.percent / 100} label={`${t.category}: ${fmtPercent(t.percent)}`} className="h-2" />
                      <span className="text-right text-callout tabular-nums text-label">
                        {fmtMarks(t.score)}/{fmtMarks(t.max)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {card.sections.length > 1 && (
              <Card>
                <CardHeader title="By section" />
                <ul className="flex flex-col gap-3">
                  {card.sections.map((s) => (
                    <li key={s.id} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3">
                      <span className="truncate text-callout text-label">{s.title}</span>
                      <Meter value={s.percent / 100} label={`${s.title}: ${fmtPercent(s.percent)}`} className="h-2" />
                      <span className="text-right text-callout tabular-nums text-label">
                        {fmtMarks(s.score)}/{fmtMarks(s.max)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="questions-heading" className="text-title-3 text-label">
              Question by question
            </h2>
            {!data.showCorrectAnswers && <p className="text-footnote text-label-secondary">Your examiner chose not to show correct answers for this exam.</p>}
          </div>
          <nav aria-label="Jump to a question">
            <ul className="flex flex-wrap gap-1.5">
              {card.items.map((i) => {
                const o = OUTCOME[i.outcome];
                return (
                  <li key={i.itemId}>
                    <a
                      href={`#q-${i.itemId}`}
                      title={`Q${i.number}: ${o.label}`}
                      className={cn(
                        'inline-flex h-8 min-w-12 items-center justify-center gap-1 rounded-lg px-2 text-footnote font-semibold tabular-nums outline-none transition-opacity hover:opacity-80',
                        'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus',
                        CHIP[o.tone],
                      )}
                    >
                      Q{i.number}
                      <span aria-hidden>{o.mark}</span>
                      <span className="sr-only">{o.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <p className="text-footnote tabular-nums text-label-secondary">
            <Meta
              items={[
                `${answered.filter((i) => i.outcome === 'correct').length} correct`,
                `${answered.filter((i) => i.outcome === 'partial').length} with part marks`,
                `${answered.filter((i) => i.outcome === 'incorrect').length} incorrect`,
                `${answered.filter((i) => i.outcome === 'unanswered').length} not answered`,
              ]}
            />
          </p>
          <div className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
            {card.items.map((i) => (
              <QuestionCard key={i.itemId} item={i} attemptId={attemptId} disputes={data.disputes} />
            ))}
          </div>
          {data.disputes.allowed && data.disputes.closesAt && <p className="text-footnote text-label-secondary">You can raise disputes until {fmtDateTime(data.disputes.closesAt)}.</p>}
        </section>

        <ScoreHistory attemptId={attemptId} />
      </div>
    </>
  );
}

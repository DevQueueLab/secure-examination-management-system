'use client';

import { Check, Copy, FileText, Hourglass, MessageSquareWarning, ShieldCheck, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumbs } from '@/components/ui/page-header';
import { ShellTitle } from '@/components/shell/shell-title';
import { ScoreRule } from '@/components/ui/marks-rule';
import { ScoreHistory } from '@/features/disputes/score-history';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useQueryClient } from '@tanstack/react-query';
import { Meter } from '../../analytics/components/charts';
import { decodeFrame, settle, useMoment } from '../../analytics/components/moment';
import { fmtDate, fmtDateTime, fmtMarks, fmtPercent, fmtSigned, ordinal } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import { Prose } from '../../grading/components/prose';
import { downloadPdf, resultsKeys, useIssueReport, useMyResult } from '../api';
import type { ItemOutcome, MyResultDetail, ResultCard, ResultItem, Verification } from '../types';
import { Seal } from './seal';

/** A right answer is the calm default; only the exceptions carry a word, and only "Incorrect" carries colour. */
const OUTCOME: Record<ItemOutcome, { label: string; glyph: string; shown: boolean; text: string }> = {
  correct: { label: 'Correct', glyph: '', shown: false, text: 'text-label-secondary' },
  partial: { label: 'Part marks', glyph: '½', shown: true, text: 'text-label-secondary' },
  incorrect: { label: 'Incorrect', glyph: '✕', shown: true, text: 'text-danger-text' },
  unanswered: { label: 'Not answered', glyph: '–', shown: true, text: 'text-label-secondary' },
  pending: { label: 'Being graded', glyph: '…', shown: true, text: 'text-label-secondary' },
  voided: { label: 'Dropped for everyone', glyph: '∅', shown: true, text: 'text-label-secondary' },
};

/** The signed code, decoded once the first time it appears in this tab. Screen readers get the code itself. */
function DecodedCode({ code }: { code: string }) {
  const t = useMoment(`code:${code}`, 750);
  return (
    <p className="font-mono text-title-3 font-medium tracking-wide text-label">
      <span className="sr-only">{code}</span>
      <span aria-hidden>{decodeFrame(code, t)}</span>
    </p>
  );
}

function VerificationPanel({ attemptId, verification }: { attemptId: string; verification: Verification | null }) {
  const issue = useIssueReport(attemptId);
  const [copied, setCopied] = useState(false);
  const v = verification ?? (issue.data ? { code: issue.data.code, url: issue.data.url, issuedAt: issue.data.issuedAt, qrDataUrl: issue.data.qrDataUrl } : null);
  if (!v) {
    return (
      <aside aria-labelledby="verification-heading" className="flex flex-col items-start gap-3 lg:pt-3">
        <Seal tone="graphite" glyph="none" size={48} />
        <h2 id="verification-heading" className="text-headline text-label">
          Verification
        </h2>
        <p className="text-subheadline text-label-secondary">A signed code lets an employer or another institution confirm this result without seeing anything else.</p>
        <Button className="mt-1" variant="tinted" loading={issue.isPending} onClick={() => issue.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
          <ShieldCheck /> Get a verification code
        </Button>
      </aside>
    );
  }
  const verifyPath = `/verify/${v.code}`;
  return (
    <aside aria-labelledby="verification-heading" className="flex flex-col gap-4 lg:pt-3">
      <div className="flex items-center gap-3">
        <Seal tone="gold" size={48} />
        <div className="min-w-0">
          <h2 id="verification-heading" className="text-headline text-label">
            Signed result
          </h2>
          <p className="text-footnote text-label-secondary">Signed {fmtDate(v.issuedAt)}. Anyone with the code can check it.</p>
        </div>
      </div>
      <DecodedCode code={v.code} />
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered QR data URL */}
        <img src={v.qrDataUrl} alt={`QR code for verification code ${v.code}`} className="size-28 shrink-0 rounded-xl bg-white p-1.5 ring-1 ring-separator" />
        <div className="flex min-w-0 flex-col items-start gap-2">
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
      </div>
      <p className="text-footnote text-label-secondary">The check page shows only your initials, the exam, the score and the issue date.</p>
    </aside>
  );
}

function QuestionCard({ item, attemptId, disputes }: { item: ResultItem; attemptId: string; disputes: { allowed: boolean } }) {
  const o = OUTCOME[item.outcome];
  const r = item.response;
  return (
    <article id={`q-${item.itemId}`} className="scroll-mt-28 py-6" aria-labelledby={`q-${item.itemId}-title`}>
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
        <div className="flex items-baseline gap-3">
          <span className={cn('text-subheadline', o.text, !o.shown && 'sr-only')}>{o.label}</span>
          {item.outcome !== 'voided' && (
            <span className="numeral text-title-2 text-label">
              {item.score === null ? '–' : fmtMarks(item.score)}
              <span className="text-callout text-label-tertiary"> / {fmtMarks(item.max)}</span>
            </span>
          )}
        </div>
      </header>

      {item.voidReason && <p className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-subheadline text-label-secondary">Removed from scoring for everyone: {item.voidReason}</p>}

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
          <div className="rounded-xl bg-surface-sunken px-3.5 py-3">
            <dt className="text-footnote font-medium text-label-secondary">{item.type === 'long_text' || item.type === 'code' ? 'Model answer' : 'Correct answer'}</dt>
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

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-footnote text-label-secondary">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="numeral text-title-1 text-label">{value}</span>
        {note && <span className="truncate text-subheadline text-label-secondary">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * The score on the Marks rule: big light numerals that count up once while the needle settles on the rule,
 * with the pass mark as the gold tick. The verdict comes only from the server.
 */
function ScoreSheet({ attemptId, card }: { attemptId: string; card: ResultCard }) {
  const t = settle(useMoment(`score:${attemptId}`, 1100));
  const passMark = card.exam.passPercent;
  const whole = Number.isInteger(card.score);
  const counting = t >= 1 ? fmtMarks(card.score) : fmtMarks(whole ? Math.round(card.score * t) : Math.round(card.score * t * 10) / 10);
  const percentText = fmtPercent(card.percent, card.percent % 1 ? 1 : 0);
  return (
    <section aria-labelledby="score-heading" className="rounded-[1.25rem] bg-surface p-6 sm:p-8">
      <h2 id="score-heading" className="sr-only">
        Your score
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <p className="flex min-w-0 items-baseline gap-3 text-label">
          <span className="sr-only">
            {fmtMarks(card.score)} of {fmtMarks(card.maxScore)} marks, {percentText}
          </span>
          <span aria-hidden className="numeral inline-grid text-[5.5rem] leading-[0.85] sm:text-[7.5rem]">
            <span className="invisible col-start-1 row-start-1">{fmtMarks(card.score)}</span>
            <span className="col-start-1 row-start-1 text-right">{counting}</span>
          </span>
          <span aria-hidden className="text-title-3 font-normal text-label-secondary">
            of {fmtMarks(card.maxScore)} marks
          </span>
        </p>
        {card.pass !== null && (
          <div className="flex items-center gap-3.5">
            <Seal tone={card.pass ? 'gold' : 'graphite'} glyph={card.pass ? 'check' : 'none'} size={64} />
            <div>
              <p className={cn('text-title-3', card.pass ? 'text-gold-text' : 'text-label')}>{card.pass ? 'Passed' : 'Below the pass mark'}</p>
              {passMark !== null && <p className="text-subheadline tabular-nums text-label-secondary">Pass mark {fmtPercent(passMark)}</p>}
            </div>
          </div>
        )}
      </div>
      {card.gradingStatus !== 'complete' && (
        <div className="mt-4">
          <Badge tone="warning">Some answers still being graded</Badge>
        </div>
      )}
      {/* The needle arrives from zero the one time the numerals count up; after that it simply sits at the score. */}
      <ScoreRule
        className="mt-8"
        score={card.score}
        max={card.maxScore}
        pass={passMark === null ? undefined : (passMark / 100) * card.maxScore}
        size="lg"
        settle={t < 1}
        label="Your score"
      />
      <dl className="hairline-t mt-8 grid grid-cols-2 gap-x-6 gap-y-5 pt-6 sm:grid-cols-4">
        <Figure label="Score" value={percentText} />
        {card.cohort.rank !== null && <Figure label="Rank" value={ordinal(card.cohort.rank)} note={`of ${card.cohort.size}`} />}
        {card.cohort.percentile !== null && <Figure label="Higher than" value={`${card.cohort.percentile}%`} note="of candidates" />}
        {card.cohort.meanPercent !== null && <Figure label="Average" value={fmtPercent(card.cohort.meanPercent)} />}
      </dl>
    </section>
  );
}

/**
 * The result page's own heading: the one place the display face appears in the app's pages.
 * Athens at 40px (56px from small screens up), normal weight, no caps and no tracking; numbers elsewhere stay in the sans with tabular figures.
 */
function ResultHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-6 pt-2 sm:pt-4">
      <Breadcrumbs items={[{ label: 'Results', href: '/results' }, { label: title }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[2.5rem] font-normal normal-case leading-[1.05] tracking-normal text-label sm:text-[3.5rem]">{title}</h1>
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
        art="owl"
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
        <Skeleton className="h-14 w-80" />
        <Skeleton className="h-80 rounded-[1.25rem]" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    const missing = isApiError(error) && (error.isNotFound || error.isForbidden);
    return (
      <EmptyState
        className="mt-6"
        icon={<Trophy />}
        art={missing ? 'column' : undefined}
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

      <div className="flex flex-col gap-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
          <ScoreSheet attemptId={attemptId} card={card} />
          <VerificationPanel attemptId={attemptId} verification={data.verification} />
        </div>

        {(card.topics.length > 0 || card.sections.length > 1) && (
          <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
            {card.topics.length > 0 && (
              <section aria-labelledby="topics-heading">
                <h2 id="topics-heading" className="text-title-3 text-label">
                  By topic
                </h2>
                <p className="mt-1 text-subheadline text-label-secondary">
                  {card.strengths.length || card.weaknesses.length
                    ? [card.strengths.length ? `Strongest: ${card.strengths.join(', ')}` : null, card.weaknesses.length ? `Work on: ${card.weaknesses.join(', ')}` : null].filter(Boolean).join('. ')
                    : 'Share of marks earned in each topic'}
                </p>
                <ul className="mt-4 divide-y divide-separator border-y border-separator">
                  {card.topics.map((t) => (
                    <li key={t.category} className="grid grid-cols-[minmax(0,8rem)_1fr_4rem] items-center gap-4 py-3">
                      <span className="truncate text-callout text-label">{t.category}</span>
                      <Meter value={t.percent / 100} label={`${t.category}: ${fmtPercent(t.percent)}`} />
                      <span className="text-right text-callout tabular-nums text-label">
                        {fmtMarks(t.score)}
                        <span className="text-label-tertiary">/{fmtMarks(t.max)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {card.sections.length > 1 && (
              <section aria-labelledby="sections-heading">
                <h2 id="sections-heading" className="text-title-3 text-label">
                  By section
                </h2>
                <p className="mt-1 text-subheadline text-label-secondary">Share of marks earned in each section</p>
                <ul className="mt-4 divide-y divide-separator border-y border-separator">
                  {card.sections.map((sec) => (
                    <li key={sec.id} className="grid grid-cols-[minmax(0,8rem)_1fr_4rem] items-center gap-4 py-3">
                      <span className="truncate text-callout text-label">{sec.title}</span>
                      <Meter value={sec.percent / 100} label={`${sec.title}: ${fmtPercent(sec.percent)}`} />
                      <span className="text-right text-callout tabular-nums text-label">
                        {fmtMarks(sec.score)}
                        <span className="text-label-tertiary">/{fmtMarks(sec.max)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
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
            <ul className="-mx-1.5 flex flex-wrap gap-0.5">
              {card.items.map((i) => {
                const o = OUTCOME[i.outcome];
                const share = i.score === null || i.max <= 0 ? 0 : Math.max(0, Math.min(1, i.score / i.max));
                return (
                  <li key={i.itemId}>
                    <a
                      href={`#q-${i.itemId}`}
                      title={`Q${i.number}: ${o.label}`}
                      className={cn(
                        'flex h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-lg px-1.5 outline-none transition-colors hover:bg-fill active:bg-fill-strong',
                        'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus',
                      )}
                    >
                      <span className="text-footnote font-medium tabular-nums text-label">
                        Q{i.number}
                        {o.glyph && (
                          <span aria-hidden className="ml-0.5 text-label-tertiary">
                            {o.glyph}
                          </span>
                        )}
                      </span>
                      <span aria-hidden className={cn('relative h-[3px] w-7 overflow-hidden rounded-full', i.outcome === 'voided' ? 'bg-transparent' : 'bg-fill-strong')}>
                        {i.outcome !== 'voided' && <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${share * 100}%` }} />}
                      </span>
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
          <div className="divide-y divide-separator border-y border-separator">
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

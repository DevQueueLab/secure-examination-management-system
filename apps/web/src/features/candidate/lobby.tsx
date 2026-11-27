'use client';

import type { ExamLobby } from '@athena/shared';
import { CalendarClock, FileCheck2, KeyRound, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MarksRule } from '@/components/ui/marks-rule';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Markdown } from '@/features/workspace/components/markdown';
import { useExamLobby, useServerNow, useStartAttempt } from './api';
import { extraMinutes } from './exam-status';
import { formatCountdown, formatMinutes, formatWhen, plural } from './format';
import { IntegrityCharter } from './integrity-charter';
import { Seal } from './seal';
import { SystemCheck } from './system-check';
import { Duration, TimeRule } from './time-rule';
import { Meta } from '@/features/workspace/components/meta';

export function Lobby({ examId }: { examId: string }) {
  const lobby = useExamLobby(examId);

  if (lobby.isPending) return <LobbySkeleton />;
  if (lobby.isError || !lobby.data) {
    const notFound = isApiError(lobby.error) && (lobby.error.isNotFound || lobby.error.isForbidden);
    return (
      <>
        <PageHeader title="Exam lobby" breadcrumbs={[{ label: 'My exams', href: '/dashboard' }, { label: 'Lobby' }]} />
        <EmptyState
          icon={notFound ? <FileCheck2 /> : <WifiOff />}
          title={notFound ? 'This exam isn’t assigned to you' : 'The lobby didn’t load'}
          description={notFound ? 'Check the link, or open the exam from My exams.' : errorMessage(lobby.error)}
          action={
            notFound ? (
              <Button asChild variant="filled">
                <Link href="/dashboard">Go to My exams</Link>
              </Button>
            ) : (
              <Button variant="filled" onClick={() => void lobby.refetch()} loading={lobby.isFetching}>
                Try again
              </Button>
            )
          }
        />
      </>
    );
  }
  return <LobbyView lobby={lobby.data} />;
}

function LobbyView({ lobby }: { lobby: ExamLobby }) {
  const router = useRouter();
  const now = useServerNow(1_000);
  const start = useStartAttempt();
  const [pledge, setPledge] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const attempt = lobby.attempt;
  const opensIn = Date.parse(lobby.windowOpensAt) - now;
  const closesIn = Date.parse(lobby.windowClosesAt) - now;
  const extra = extraMinutes(lobby);
  const limitMs = lobby.timeLimitMinutes * 60_000;
  const capped = lobby.phase === 'ongoing' && closesIn > 0 && closesIn < limitMs;
  const totalQuestions = lobby.sections.reduce((n, s) => n + s.questionCount, 0) || lobby.questionCount;
  const honorCode = lobby.honorCode?.trim() || 'I will complete this examination on my own and will not share its contents.';

  const disabledReason = (() => {
    if (attempt) return null;
    if (!lobby.canStart) {
      if (lobby.phase === 'scheduled' && opensIn > 0) return `Opens in ${formatCountdown(opensIn)} (${formatWhen(lobby.windowOpensAt, now)})`;
      return lobby.blockedReason ?? 'This exam can’t be started right now.';
    }
    if (lobby.requiresAccessCode && !accessCode.trim()) return 'Enter the access code your invigilator gives you.';
    if (!pledge) return 'Accept the honor code to begin.';
    return null;
  })();

  async function onStart() {
    if (disabledReason || start.isPending) return;
    setStartError(null);
    setCodeError(null);
    // Must run inside the click: browsers only allow full screen from a user gesture.
    if (lobby.integrity.requireFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    try {
      const view = await start.mutateAsync({
        examId: lobby.examId,
        ...(accessCode.trim() ? { accessCode: accessCode.trim() } : {}),
        pledgeAccepted: true,
        clientInfo: {
          userAgent: navigator.userAgent.slice(0, 400),
          platform: (navigator.platform || '').slice(0, 100) || undefined,
          screen: `${window.screen.width}x${window.screen.height}`.slice(0, 40),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 60),
        },
      });
      router.push(`/attempt/${view.id}`);
    } catch (error) {
      if (isApiError(error) && error.fields.accessCode) setCodeError(error.fields.accessCode);
      else if (isApiError(error) && error.fields.pledgeAccepted) setStartError(error.fields.pledgeAccepted);
      else setStartError(errorMessage(error, 'The exam could not start. Press Start exam again in a moment.'));
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
  }

  return (
    <>
      <PageHeader
        title={lobby.title}
        subtitle={<Meta items={[lobby.code, lobby.organizationName]} />}
        breadcrumbs={[{ label: 'My exams', href: '/dashboard' }, { label: lobby.title }]}
        meta={lobby.phase === 'ongoing' ? undefined : <PhaseBadge phase={lobby.phase} />}
      />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section title="Instructions">
            {lobby.instructions.trim() ? (
              <Markdown className="max-w-[68ch] text-body leading-relaxed text-label">{lobby.instructions}</Markdown>
            ) : (
              <p className="max-w-[68ch] text-body text-label-secondary">Your examiner hasn’t added instructions. Answer every question; your work saves as you go.</p>
            )}
          </Section>

          <Section title="The paper" description={`${plural(totalQuestions, 'question')}, ${plural(lobby.totalMarks, 'mark')}`}>
            <PaperOutline lobby={lobby} />
            <p className="mt-2 max-w-[68ch] text-subheadline text-label-secondary">
              {[
                lobby.allowCalculator && lobby.allowScratchpad ? 'The calculator and scratchpad are in the toolbar.' : lobby.allowCalculator ? 'The calculator is in the toolbar.' : lobby.allowScratchpad ? 'The scratchpad is in the toolbar.' : null,
                lobby.navigation === 'linear'
                  ? 'Questions come one at a time. Once you move on, you can’t return to an earlier question.'
                  : 'Move between questions freely and flag any you want to review before you submit.',
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          </Section>

          <Section title="Integrity charter" description="What this exam records, what it never records, and how that information is used.">
            <IntegrityCharter lobby={lobby} />
          </Section>
        </div>

        <aside aria-label="Before you begin" className="lg:sticky lg:top-20">
          <div className="flex flex-col gap-6 rounded-2xl bg-surface-raised p-5 shadow-[0_1px_2px_rgb(20_24_31/0.05),0_18px_40px_-22px_rgb(20_24_31/0.28)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.09)] sm:p-7">
            <div>
              <p className="numeral whitespace-nowrap text-[3.25rem] leading-none text-label">
                <Duration minutes={lobby.timeLimitMinutes} />
              </p>
              <p className="mt-2.5 text-callout text-label-secondary">
                {attempt
                  ? 'The timer is already running on the server.'
                  : 'to answer, from the moment you press Start. The server keeps the time, so it keeps running if you close the tab.'}
              </p>
              {extra > 0 && (
                <p className="mt-2 text-callout text-label">
                  Includes {formatMinutes(extra)} extra time
                  {lobby.accommodation?.note ? <span className="block text-label-secondary">{lobby.accommodation.note}</span> : null}
                </p>
              )}
            </div>

            <div className="pt-5 hairline-t">
              {lobby.phase === 'scheduled' ? (
                <p className="flex items-center gap-1.5 text-subheadline text-label-secondary" data-numeric>
                  <CalendarClock aria-hidden className="size-3.5 shrink-0" />
                  {`Opens ${formatWhen(lobby.windowOpensAt, now)}, closes ${formatWhen(lobby.windowClosesAt, now)}`}
                </p>
              ) : (
                <TimeRule card={lobby} now={now} compact />
              )}
              {capped && !attempt && (
                <p className="mt-3 rounded-lg bg-warning-tint px-3 py-2 text-subheadline text-warning-text">
                  The window closes before your full time is up. If you start now you’ll have about {formatCountdown(closesIn)}.
                </p>
              )}
            </div>

            <div className="pt-5 hairline-t">
              <SystemCheck requireFullscreen={lobby.integrity.requireFullscreen} />
            </div>

            {attempt ? (
              <div className="flex flex-col gap-3 pt-5 hairline-t">
                {attempt.status === 'submitted' ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 self-start text-callout font-medium text-gold-text">
                      <Seal className="size-[1.125rem]" />
                      Submitted
                    </span>
                    <p className="text-callout text-label-secondary">
                      You submitted this exam {attempt.submittedAt ? formatWhen(attempt.submittedAt, now) : ''}. Your receipt proves exactly what you sent.
                    </p>
                    <Button asChild variant="gray" size="lg" block>
                      <Link href={`/attempt/${attempt.id}`}>View receipt</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-callout text-label-secondary">
                      You started this exam {formatWhen(attempt.startedAt, now)}. Everything you answered is saved.
                    </p>
                    <Button asChild variant="filled" size="lg" block>
                      <Link href={`/attempt/${attempt.id}`}>
                        Resume exam
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <form
                className="flex flex-col gap-5 pt-5 hairline-t"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onStart();
                }}
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex min-h-6 items-center justify-between gap-3">
                    <h3 className="text-headline text-label">Honor code</h3>
                    {pledge && (
                      <span className="inline-flex items-center gap-1.5 text-footnote font-medium text-accent-text">
                        <Seal className="size-4" />
                        Signed
                      </span>
                    )}
                  </div>
                  <Checkbox
                    checked={pledge}
                    onCheckedChange={(v) => setPledge(v === true)}
                    label={<span className="text-callout leading-snug">{honorCode}</span>}
                    disabled={!lobby.canStart}
                  />
                </div>
                {lobby.requiresAccessCode && (
                  <Field label="Access code" hint="Your invigilator shares it at the start of the exam." error={codeError ?? undefined}>
                    <Input
                      size="lg"
                      value={accessCode}
                      onChange={(e) => {
                        setAccessCode(e.target.value.toUpperCase());
                        setCodeError(null);
                      }}
                      maxLength={32}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      leading={<KeyRound aria-hidden />}
                      className="font-mono tracking-[0.12em]"
                      disabled={!lobby.canStart}
                    />
                  </Field>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="submit"
                    variant={disabledReason ? 'gray' : 'filled'}
                    size="lg"
                    block
                    loading={start.isPending}
                    aria-disabled={!!disabledReason || undefined}
                    aria-describedby="start-reason"
                    className={disabledReason ? 'pointer-events-auto cursor-not-allowed text-label-secondary' : undefined}
                  >
                    Start exam
                  </Button>
                  <p id="start-reason" aria-live="polite" className="min-h-4 text-center text-footnote text-label-secondary">
                    {startError ? <span className="font-medium text-danger-text">{startError}</span> : (disabledReason ?? 'The timer starts as soon as you press Start.')}
                  </p>
                </div>
              </form>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

/** The paper's outline: each section takes its share of the marks along one Marks rule. */
function PaperOutline({ lobby }: { lobby: ExamLobby }) {
  const sections = lobby.sections;
  const total = sections.reduce((n, s) => n + s.marks, 0) || lobby.totalMarks || 1;
  const bounds: number[] = [];
  sections.slice(0, -1).reduce((acc, s) => {
    bounds.push((acc + s.marks) / total);
    return acc + s.marks;
  }, 0);
  const spoken = sections.map((s) => `${s.title}, ${plural(s.marks, 'mark')}`).join('; ');
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col">
      {/* Wide screens: the sections stand on the rule at their share of the marks. */}
      <ol className="flex max-xl:hidden">
        {sections.map((s, i) => (
          <li key={`${s.title}-${i}`} className="relative min-w-0" style={{ flex: `${Math.max(s.marks, 0.5)} 1 0%` }}>
            {i > 0 && <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-separator-strong" />}
            <div className={cn('flex flex-col gap-1 pb-3 pr-3', i > 0 && 'pl-3')}>
              <span className="numeral whitespace-nowrap text-[2rem] leading-none text-label">
                {s.marks}
                <span className="ml-1 text-[0.42em] font-normal tracking-normal text-label-secondary">{s.marks === 1 ? 'mark' : 'marks'}</span>
              </span>
              <span className="mt-1 line-clamp-2 text-subheadline font-medium text-label">{s.title}</span>
              <span className="text-footnote text-label-secondary">{plural(s.questionCount, 'question')}</span>
            </div>
          </li>
        ))}
      </ol>
      {/* Narrower columns: the same sections as hairline rows. */}
      <ol className="hairline-t xl:hidden">
        {sections.map((s, i) => (
          <li key={`${s.title}-${i}`} className="flex min-h-12 items-baseline justify-between gap-4 py-3 hairline-b">
            <span className="min-w-0 text-callout font-medium text-label">{s.title}</span>
            <span className="shrink-0 text-footnote text-label-secondary tabular-nums">
              {plural(s.questionCount, 'question')}, {plural(s.marks, 'mark')}
            </span>
          </li>
        ))}
      </ol>
      <div className="relative max-xl:mt-4">
        <MarksRule value={0} max={total} marker="fill" tone="neutral" labels="major" label="Marks by section" valueText={`${plural(total, 'mark')}: ${spoken}`} />
        {bounds.map((f, i) => (
          <span key={i} aria-hidden className="absolute top-0 h-[22px] w-px bg-label-secondary" style={{ left: `${(f * 100).toFixed(3)}%` }} />
        ))}
      </div>
    </div>
  );
}

function LobbySkeleton() {
  return (
    <div role="status" aria-label="Loading the exam lobby" className="flex flex-col gap-6 pt-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="rounded-xl bg-surface p-6">
          <SkeletonText lines={6} />
        </div>
        <div className="rounded-xl bg-surface p-6">
          <Skeleton className="h-8 w-24" />
          <SkeletonText lines={4} className="mt-4" />
          <Skeleton className="mt-6 h-11 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

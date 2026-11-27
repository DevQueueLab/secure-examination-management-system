'use client';

import type { ExamLobby } from '@athena/shared';
import { CalendarClock, FileCheck2, KeyRound, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { GroupedList, GroupedListItem } from '@/components/ui/grouped-list';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { Markdown } from '@/features/workspace/components/markdown';
import { useExamLobby, useServerNow, useStartAttempt } from './api';
import { extraMinutes } from './exam-status';
import { formatCountdown, formatMinutes, formatWhen, plural } from './format';
import { IntegrityCharter } from './integrity-charter';
import { SystemCheck } from './system-check';
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
        meta={<PhaseBadge phase={lobby.phase} />}
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
            <GroupedList footer={lobby.navigation === 'linear' ? 'Questions come one at a time. Once you move on, you can’t return to an earlier question.' : 'Move between questions freely and flag any you want to review before you submit.'}>
              {lobby.sections.map((s, i) => (
                <GroupedListItem
                  key={`${s.title}-${i}`}
                  title={s.title}
                  value={
                    <span data-numeric>
                      {plural(s.questionCount, 'question')}, {plural(s.marks, 'mark')}
                    </span>
                  }
                />
              ))}
              {(lobby.allowCalculator || lobby.allowScratchpad) && (
                <GroupedListItem
                  title="Tools"
                  value={lobby.allowCalculator && lobby.allowScratchpad ? 'Calculator and scratchpad' : lobby.allowCalculator ? 'Calculator' : 'Scratchpad'}
                />
              )}
            </GroupedList>
          </Section>

          <Section title="Integrity charter" description="What this exam records, what it never records, and how that information is used.">
            <IntegrityCharter lobby={lobby} />
          </Section>
        </div>

        <aside aria-label="Before you begin" className="lg:sticky lg:top-20">
          <Card padding="lg" className="flex flex-col gap-6">
            <div>
              <p className="text-title-1 text-label" data-numeric>
                {formatMinutes(lobby.timeLimitMinutes)}
              </p>
              <p className="mt-1 text-callout text-label-secondary">
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
              <p className="mt-3 flex items-center gap-1.5 text-subheadline text-label-secondary" data-numeric>
                <CalendarClock aria-hidden className="size-3.5 shrink-0" />
                {lobby.phase === 'scheduled'
                  ? `Opens ${formatWhen(lobby.windowOpensAt, now)}, closes ${formatWhen(lobby.windowClosesAt, now)}`
                  : `Window closes ${formatWhen(lobby.windowClosesAt, now)}${closesIn > 0 ? ` (in ${formatCountdown(closesIn)})` : ''}`}
              </p>
              {capped && !attempt && (
                <p className="mt-2 rounded-lg bg-warning-tint px-3 py-2 text-subheadline text-warning-text">
                  The window closes before your full time is up. If you start now you’ll have about {formatCountdown(closesIn)}.
                </p>
              )}
            </div>

            <div className="border-t pt-5">
              <SystemCheck requireFullscreen={lobby.integrity.requireFullscreen} />
            </div>

            {attempt ? (
              <div className="flex flex-col gap-3 border-t pt-5">
                {attempt.status === 'submitted' ? (
                  <>
                    <Badge tone="success" className="self-start">
                      Submitted
                    </Badge>
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
                className="flex flex-col gap-5 border-t pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onStart();
                }}
              >
                <div className="flex flex-col gap-2">
                  <h3 className="text-headline text-label">Honor code</h3>
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
                    variant="filled"
                    size="lg"
                    block
                    loading={start.isPending}
                    aria-disabled={!!disabledReason || undefined}
                    aria-describedby="start-reason"
                    className={disabledReason ? 'pointer-events-auto opacity-50' : undefined}
                  >
                    Start exam
                  </Button>
                  <p id="start-reason" aria-live="polite" className="min-h-4 text-center text-footnote text-label-secondary">
                    {startError ? <span className="font-medium text-danger-text">{startError}</span> : (disabledReason ?? 'The timer starts as soon as you press Start.')}
                  </p>
                </div>
              </form>
            )}
          </Card>
        </aside>
      </div>
    </>
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

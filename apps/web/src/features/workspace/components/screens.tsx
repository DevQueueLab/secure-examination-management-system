'use client';

import { WrittenText } from '@/components/ui/written-text';
import type { SubmissionReceipt } from '@athena/shared';
import { CircleCheck, Copy, Laptop, Lock, MonitorSmartphone, ShieldCheck, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AthenaMark } from '@/components/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { formatClock, formatDateTime } from '@/features/candidate/format';
import { Seal } from '@/features/candidate/seal';
import { useEngine, useEngineSelector } from '../lib/use-engine';

/** A calm, centred state for everything that isn't the paper itself. */
function StateFrame({ icon, title, children, actions, tone = 'neutral' }: { icon: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; tone?: 'neutral' | 'accent' | 'warning' | 'success' }) {
  const toneClass = {
    neutral: 'bg-fill text-label-secondary',
    accent: 'bg-accent-tint text-accent-text',
    warning: 'bg-warning-tint text-warning-text',
    success: 'bg-success-tint text-success-text',
  }[tone];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 pt-safe sm:px-6">
        <AthenaMark size={24} />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-[12vh] sm:items-center sm:pt-0">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <span aria-hidden className={`mb-5 flex size-14 items-center justify-center rounded-2xl [&_svg]:size-7 ${toneClass}`}>
            {icon}
          </span>
          <h1 className="text-title-1 text-label">{title}</h1>
          <div className="mt-3 flex flex-col gap-3 text-body text-label-secondary">{children}</div>
          {actions && <div className="mt-8 flex w-full flex-col gap-2.5 sm:w-auto sm:min-w-64">{actions}</div>}
        </div>
      </main>
    </div>
  );
}

export function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col" role="status" aria-label="Opening your exam">
      <header className="hairline-b flex h-14 items-center gap-3 px-4 sm:px-6">
        <AthenaMark size={24} />
        <Skeleton className="h-4 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
        <SkeletonText lines={3} />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
        <p className="flex items-center gap-2 text-callout text-label-secondary">
          <Spinner size={14} label={null} /> Opening your exam…
        </p>
      </main>
    </div>
  );
}

export function ErrorScreen() {
  const engine = useEngine();
  const error = useEngineSelector((s) => s.error);
  const [busy, setBusy] = useState(false);
  return (
    <StateFrame
      icon={<WifiOff />}
      title={error?.title ?? 'Your exam didn’t open'}
      actions={
        <>
          {error?.retryable !== false && (
            <Button
              variant="filled"
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await engine.retry();
                setBusy(false);
              }}
            >
              Try again
            </Button>
          )}
          <Button asChild variant="gray" size="lg">
            <Link href="/dashboard">Back to My exams</Link>
          </Button>
        </>
      }
    >
      <p>{error?.message ?? 'Check your connection, then try again. Anything you answered is safe.'}</p>
    </StateFrame>
  );
}

export function LockScreen() {
  const engine = useEngine();
  const lock = useEngineSelector((s) => s.lock);
  const [busy, setBusy] = useState(false);
  const tab = lock === 'tab';
  return (
    <StateFrame
      tone="warning"
      icon={tab ? <MonitorSmartphone /> : <Laptop />}
      title={tab ? 'Your exam is open in another tab' : 'Your exam is open on another device'}
      actions={
        <>
          <Button
            variant="filled"
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (tab) await engine.reclaimTab();
                else await engine.claimDevice();
              } catch (error) {
                toast.error('Couldn’t move the exam here', { description: errorMessage(error) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {tab ? 'Continue in this tab' : 'Continue on this device'}
          </Button>
          <Button asChild variant="gray" size="lg">
            <Link href="/dashboard">Back to My exams</Link>
          </Button>
        </>
      }
    >
      <p>
        {tab
          ? 'Only one tab can hold the exam, so each answer is saved once. Continue here and the other tab stops.'
          : 'The exam moved to another device, so this one paused to keep a single copy of your answers. Continue here and the other device stops saving.'}
      </p>
      <p className="text-callout">Nothing is lost: answers saved on either side are kept, and the timer is the same everywhere.</p>
    </StateFrame>
  );
}

/** Time is up: sealed on this device while offline, or finishing the hand-in online. */
export function ClosingScreen() {
  const phase = useEngineSelector((s) => s.phase);
  const step = useEngineSelector((s) => s.closingStep);
  const online = useEngineSelector((s) => s.sync.online && s.sync.state !== 'offline');
  const waiting = useEngineSelector((s) => s.sync.dirtyAnswers);
  const durable = useEngineSelector((s) => s.durable);
  const sealedAt = useEngineSelector((s) => s.sealedAt);
  const sealed = phase === 'sealed';

  const status = sealed
    ? online
      ? step === 'uploading'
        ? 'Sending your sealed answers…'
        : 'Back online and sending your sealed answers…'
      : 'Waiting for a connection. Keep this page open, or come back to it later on this device.'
    : step === 'uploading'
      ? 'Sending your last answers…'
      : step === 'receipt'
        ? 'Getting your receipt…'
        : 'Submitting your answers…';

  return (
    <StateFrame
      tone={sealed ? 'warning' : 'accent'}
      icon={sealed ? <Lock /> : <ShieldCheck />}
      title="Time is up"
    >
      {sealed ? (
        <p>
          Your answers are sealed on this device and will be sent when you reconnect. Answers that arrive after the deadline are reviewed by your
          examiner before they count.
        </p>
      ) : (
        <p>Your exam is being handed in. You don’t need to do anything.</p>
      )}
      <p className="mt-2 flex items-center justify-center gap-2 text-callout text-label" role="status" aria-live="polite">
        {sealed && !online ? <WifiOff aria-hidden className="size-4 text-warning-text" /> : <Spinner size={14} label={null} />}
        {status}
      </p>
      {sealed && (
        <p className="text-footnote text-label-tertiary" data-numeric>
          {waiting > 0
            ? `${waiting} ${waiting === 1 ? 'answer' : 'answers'} sealed ${durable ? 'on this device' : 'in this tab'}${sealedAt ? ` at ${formatClock(sealedAt)}` : ''}.`
            : `Everything was saved before time ran out${sealedAt ? `, sealed at ${formatClock(sealedAt)}` : ''}.`}
        </p>
      )}
    </StateFrame>
  );
}

const REASON: Record<string, string> = {
  candidate: 'You submitted this exam.',
  timeout: 'Submitted automatically when time ran out.',
  proctor: 'Submitted by your proctor.',
  offline_sync: 'Submitted from the answers sealed on your device.',
};

/** Characters a receipt code can hold, so the scramble keeps the code's own texture. */
const CODE_GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const decodedOnce = new Set<string>();

function scramble(code: string, revealed: number): string {
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    out += i < revealed || ch === '-' ? ch : CODE_GLYPHS[Math.floor(Math.random() * CODE_GLYPHS.length)];
  }
  return out;
}

function shouldDecode(code: string): boolean {
  if (typeof window === 'undefined' || decodedOnce.has(code)) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return window.sessionStorage.getItem(`athena:decoded:${code}`) === null;
  } catch {
    return true;
  }
}

/**
 * The receipt code decodes once, left to right, the first time it is shown (about 0.7 s), then stays put.
 * The final code sizes the box from the start, so nothing shifts; screen readers only ever get the code.
 */
function DecodedCode({ code, className }: { code: string; className?: string }) {
  const [shown, setShown] = useState<string | null>(() => (shouldDecode(code) ? scramble(code, 0) : null));
  useEffect(() => {
    if (shown === null) return;
    decodedOnce.add(code);
    try {
      window.sessionStorage.setItem(`athena:decoded:${code}`, '1');
    } catch {
      /* private mode: once per page load is enough */
    }
    const frames = 18;
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      if (frame >= frames) {
        window.clearInterval(id);
        setShown(null);
        return;
      }
      setShown(scramble(code, Math.floor((frame / frames) * code.length)));
    }, 40);
    return () => window.clearInterval(id);
    // Runs once per code; later engine updates must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  return (
    <span className={cn('relative inline-block whitespace-nowrap', className)}>
      <span className={shown === null ? undefined : 'invisible'}>{code}</span>
      {shown !== null && (
        <span aria-hidden className="absolute inset-0 select-none">
          {shown}
        </span>
      )}
    </span>
  );
}

export function ReceiptScreen() {
  const receipt = useEngineSelector((s) => s.receipt);
  const view = useEngineSelector((s) => s.view);
  const offline = useEngineSelector((s) => s.offlineUpload);
  const reason = useEngineSelector((s) => s.submitReason);
  return <Receipt receipt={receipt} examTitle={view?.examTitle ?? null} isSandbox={view?.isSandbox ?? false} offline={offline} reason={reason} />;
}

function Receipt({
  receipt,
  examTitle,
  isSandbox,
  offline,
  reason,
}: {
  receipt: SubmissionReceipt | null;
  examTitle: string | null;
  isSandbox: boolean;
  offline: { count: number; accepted: boolean; message?: string } | null;
  reason: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const reduced = useReducedMotion();
  const submittedAt = receipt?.submittedAt ?? null;
  const why = REASON[receipt?.submitReason ?? reason ?? 'candidate'] ?? REASON.candidate;

  async function copy() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.receiptCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error('The code couldn’t be copied automatically. Select it and copy it instead.');
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 pt-safe sm:px-6">
        <AthenaMark size={24} />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-[8vh]">
        <div className="flex w-full max-w-lg flex-col">
          {receipt ? (
            // The seal stamps down as the receipt arrives: in large, a slight squash on contact, then still.
            <motion.div
              className="mb-6 self-start"
              initial={reduced ? false : { scaleX: 1.25, scaleY: 1.25, opacity: 0 }}
              animate={{ scaleX: [1.25, 1.07, 1], scaleY: [1.25, 0.9, 1], opacity: [0, 1, 1] }}
              transition={{ duration: 0.38, times: [0, 0.62, 1], ease: [0.2, 0.9, 0.3, 1] }}
            >
              <Seal variant="seal" title="Sealed and received" className="size-[4.5rem] text-gold-text" />
            </motion.div>
          ) : (
            <span aria-hidden className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-success-tint text-success-text">
              <CircleCheck className="size-7" />
            </span>
          )}
          {/* The one display-face moment in the workspace. */}
          <h1 className="font-display text-[3.5rem] font-normal normal-case leading-[1.02] tracking-normal text-label sm:text-[4.5rem]"><WrittenText text="Submitted" /></h1>
          <p className="mt-3 font-sans text-body text-label-secondary">
            {examTitle ? <span className="text-label">{examTitle}. </span> : null}
            {why}
            {submittedAt ? (
              <>
                {' '}
                <time dateTime={submittedAt} data-numeric>
                  {formatDateTime(submittedAt)}
                </time>
                .
              </>
            ) : null}
          </p>

          {receipt ? (
            <div className="mt-9 flex flex-col gap-6 rounded-2xl bg-surface-raised p-5 font-sans shadow-[0_1px_2px_rgb(20_24_31/0.05),0_18px_40px_-22px_rgb(20_24_31/0.28)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.09)] sm:p-7">
              <div>
                <p className="text-footnote text-label-secondary">Receipt code</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <code className="min-w-0 font-sans text-[1.5rem] font-normal leading-tight tracking-[0.01em] text-label tabular-nums sm:text-[1.875rem]">
                    <DecodedCode code={receipt.receiptCode} />
                  </code>
                  <Button variant="gray" size="sm" onClick={() => void copy()} aria-label="Copy the receipt code" className="max-sm:h-11">
                    <Copy aria-hidden />
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="mt-2.5 text-footnote text-label-secondary">It proves exactly what you submitted. Keep it until results are out.</p>
              </div>
              <dl className="grid grid-cols-3 divide-x divide-separator pt-5 hairline-t">
                <div className="flex flex-col gap-1.5">
                  <dt className="order-2 text-footnote text-label-secondary">Answered</dt>
                  <dd className="numeral order-1 text-[2rem] leading-none text-label">
                    {receipt.answeredCount}
                    <span className="text-[0.5em] text-label-tertiary"> / {receipt.itemCount}</span>
                  </dd>
                </div>
                <div className="flex flex-col gap-1.5 pl-4 sm:pl-6">
                  <dt className="order-2 text-footnote text-label-secondary">Unanswered</dt>
                  <dd className="numeral order-1 text-[2rem] leading-none text-label">{Math.max(0, receipt.itemCount - receipt.answeredCount)}</dd>
                </div>
                <div className="flex flex-col gap-1.5 pl-4 sm:pl-6">
                  <dt className="order-2 text-footnote text-label-secondary">Flagged</dt>
                  <dd className="numeral order-1 text-[2rem] leading-none text-label">{receipt.flaggedCount}</dd>
                </div>
              </dl>
              {isSandbox && receipt.sandboxScore && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-fill-secondary px-4 py-3">
                  <div>
                    <p className="flex items-center gap-2 text-callout font-medium text-label">
                      Sandbox score <Badge tone="warning">Sandbox</Badge>
                    </p>
                    <p className="text-footnote text-label-secondary">
                      Counts auto-graded questions only
                      {receipt.sandboxScore.pendingManual > 0
                        ? `; ${receipt.sandboxScore.pendingManual} ${receipt.sandboxScore.pendingManual === 1 ? 'answer needs' : 'answers need'} manual grading`
                        : ''}
                      .
                    </p>
                  </div>
                  <p className="text-title-2 tabular-nums text-label">
                    {receipt.sandboxScore.score}
                    <span className="text-callout text-label-tertiary"> / {receipt.sandboxScore.maxScore}</span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-8 rounded-xl bg-fill-secondary px-4 py-3 font-sans text-callout text-label-secondary">
              Your exam is submitted. The receipt couldn’t load right now; it’s waiting for you in My exams.
            </p>
          )}

          {offline && offline.count > 0 && (
            <p className="mt-4 rounded-xl bg-warning-tint px-4 py-3 font-sans text-callout text-warning-text" data-numeric>
              {offline.accepted
                ? `${offline.count} ${offline.count === 1 ? 'answer' : 'answers'} reached Athena after the deadline. Your examiner reviews them before they count.`
                : (offline.message ?? 'Some answers saved offline after the deadline could not be accepted.')}
            </p>
          )}

          <p className="mt-6 font-sans text-callout text-label-secondary">Your examiner will publish results. You’ll find them in My exams.</p>
          <div className="mt-6">
            <Button asChild variant="filled" size="lg">
              <Link href="/dashboard">
                Back to My exams
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

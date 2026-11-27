'use client';

import { Activity, Maximize, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { Skeleton } from '@/components/ui/skeleton';
import { WrittenText } from '@/components/ui/written-text';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { useAnnouncements } from '../api';
import { useServerNow } from '../clock';
import { CountingNumber } from '../components/count';
import { LiveIndicator } from '../components/live-bits';
import { clockTime, countdown, dayTime } from '../format';
import type { LiveMonitor, StaffAnnouncement } from '../types';
import { useLiveMonitor } from '../use-live-monitor';

const IDLE_MS = 3000;

const noSubscribe = () => () => undefined;
/** True in the browser after hydration, without an effect: the display is portalled to <body>, above the shell. */
const useIsClient = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** True once the pointer and keyboard have been still for `ms`; any movement wakes it. */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [ms]);
  return idle;
}

/** One block of the mount choreography: it rises 12 px into place, in order, all within about half a second. */
function Rise({ order, className, children }: { order: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      // Starts about 120 ms in, after the shell's own page entrance has begun.
      transition={{ ...spring.smooth, delay: 0.12 + order * 0.06, opacity: { duration: 0.2, delay: 0.12 + order * 0.06 } }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The hall display: the exam room's projector. The paper's name, a giant countdown to the close of the window, the
 * window on the Marks rule with its needle at now, how many are writing, have submitted and have not started, and the
 * latest announcement to everyone. No candidate is ever named here. It reads the monitor's own data and socket, so
 * it needs the same access as the monitor.
 */
export function HallDisplay({ examId }: { examId: string }) {
  const live = useLiveMonitor(examId);
  const announcements = useAnnouncements(examId);
  const router = useRouter();
  const idle = useIdle(IDLE_MS);
  const isClient = useIsClient();
  const [fullscreen, setFullscreen] = useState(false);
  const back = `/exams/${examId}/monitor`;

  // Esc leaves the display, in or out of full screen (see onChange).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      router.push(back);
    };
    // In full screen the browser takes the first Esc to leave full screen, so leaving full screen leaves the display:
    // one press is always enough.
    let was = false;
    const onChange = () => {
      const on = !!document.fullscreenElement;
      setFullscreen(on);
      if (was && !on) router.push(back);
      was = on;
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      // Leaving the display never strands the monitor in full screen.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [router, back]);

  const enterFullscreen = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) return;
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const data = live.data;
  let body: ReactNode;
  if (live.isPending) {
    body = (
      <div className="flex flex-1 flex-col justify-center gap-8 px-6 sm:px-12">
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  } else if (!data) {
    const notFound = isApiError(live.error) && (live.error.isNotFound || live.error.isForbidden);
    body = (
      <div className="flex flex-1 items-center justify-center px-6">
        <EmptyState
          icon={<Activity />}
          title={notFound ? 'You can’t monitor this exam' : 'Couldn’t load the live monitor'}
          description={notFound ? 'Live monitoring is open to the exam’s staff: its examiners and assigned proctors.' : errorMessage(live.error)}
        />
      </div>
    );
  } else {
    const latest = (announcements.data ?? [])
      .filter((a) => !a.target)
      .reduce<StaffAnnouncement | null>((best, a) => (!best || a.createdAt > best.createdAt ? a : best), null);
    body = <Hall data={data} latest={latest} connection={<LiveIndicator connected={live.connected} updatedAt={live.dataUpdatedAt} unreachable={live.isRefetchError} />} />;
  }

  if (!isClient) return null;
  return createPortal(
    <div
      role="region"
      aria-label="Hall display"
      onClick={enterFullscreen}
      className={cn('fixed inset-0 z-[60] flex flex-col overflow-y-auto overflow-x-hidden bg-bg text-label', idle && 'cursor-none')}
    >
      {/* The controls step back with the cursor, so the projector shows only the room's information. */}
      <div
        className={cn(
          'flex items-center justify-end gap-2 px-4 pt-4 transition-opacity duration-200 sm:px-8 sm:pt-6',
          idle ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        {!fullscreen && (
          <span className="hidden items-center gap-2 text-footnote text-label-secondary sm:inline-flex">
            <Maximize aria-hidden className="size-4" />
            Click anywhere for full screen
          </span>
        )}
        <Link
          href={back}
          className="focus-visible:focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-subheadline font-medium text-label hover:bg-fill-secondary active:bg-fill"
        >
          <X aria-hidden className="size-4" />
          Leave hall display
        </Link>
      </div>
      {body}
    </div>,
    document.body,
  );
}

function Hall({ data, latest, connection }: { data: LiveMonitor; latest: StaffAnnouncement | null; connection: ReactNode }) {
  const now = useServerNow();
  const reduced = useReducedMotion();
  const { exam } = data;
  const opens = Date.parse(exam.windowOpensAt);
  const closes = Date.parse(exam.windowClosesAt);
  const span = Math.max(1, closes - opens);
  const elapsed = Math.min(Math.max(now - opens, 0), span);
  const phase = now < opens ? 'before' : now < closes ? 'open' : 'closed';
  const reading = phase === 'before' ? countdown(opens - now) : phase === 'open' ? countdown(closes - now) : '0:00';
  // "at 3:19 PM" today, "on Mon, Nov 30, 3:19 PM" on another day.
  const at = (ms: number) => `${new Date(ms).toDateString() === new Date(now).toDateString() ? 'at' : 'on'} ${dayTime(ms, now)}`;
  const caption =
    phase === 'before' ? `Until the window opens ${at(opens)}` : phase === 'open' ? `Until the window closes ${at(closes)}` : `The window closed ${at(closes)}`;

  const writing = data.attempts.filter((a) => a.status === 'in_progress' || a.status === 'awaiting_sync').length;
  const submitted = data.attempts.filter((a) => a.status === 'submitted').length;
  const notStarted = data.notStarted.length;

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col justify-between gap-10 px-4 pb-8 pt-6 sm:px-12 sm:pb-12 lg:gap-14">
      <Rise order={0} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <WrittenText
            as="h1"
            text={exam.title}
            once={`hall:${exam.id}`}
            duration={900}
            className="block font-display text-[clamp(2rem,5vw,4.5rem)] leading-[1.05] tracking-tight text-label"
          />
          {exam.code && <p className="mt-2 text-title-3 tabular-nums text-label-secondary">{exam.code}</p>}
        </div>
        <div className="shrink-0">{connection}</div>
      </Rise>

      <Rise order={1} className="flex flex-col gap-5">
        <p className="text-title-3 text-label-secondary">{caption}</p>
        <time
          role="timer"
          aria-live="off"
          aria-label={`${reading} ${phase === 'before' ? 'until the window opens' : phase === 'open' ? 'left in the window' : 'left'}`}
          className={cn(
            'numeral block text-[clamp(5.5rem,20vw,19rem)] leading-[0.85] tabular-nums',
            phase === 'open' && closes - now <= 5 * 60_000 ? 'text-warning-text' : 'text-label',
            phase === 'closed' && 'text-label-secondary',
          )}
        >
          {reading}
        </time>
        <MarksRule
          className="w-full"
          size="lg"
          marker="both"
          value={elapsed}
          max={span}
          labels="ends"
          format={(v) => dayTime(opens + v, now)}
          tone={phase === 'closed' ? 'neutral' : 'accent'}
          label="Exam window"
          valueText={`${clockTime(now)}, between ${dayTime(opens, now)} and ${dayTime(closes, now)}`}
          settle
        />
      </Rise>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end lg:gap-16">
        <Rise order={2} className="grid grid-cols-3 divide-x divide-separator border-y border-separator">
          <Reading value={writing} label="Writing" />
          <Reading value={submitted} label="Submitted" />
          <Reading value={notStarted} label="Not started" />
        </Rise>
        <Rise order={3} className="min-w-0">
          {latest ? (
            // A new announcement lands: it rises into place, and the one before leaves at once.
            <motion.div
              key={latest.id}
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.sheet, opacity: { duration: 0.2 } }}
              className="flex flex-col gap-2"
            >
              <p className="flex gap-3 text-subheadline font-medium">
                <span className={latest.priority === 'urgent' ? 'text-warning-text' : 'text-label-secondary'}>
                  {latest.priority === 'urgent' ? 'Urgent announcement' : 'Announcement'}
                </span>
                <span className="tabular-nums text-label-secondary">{clockTime(latest.createdAt)}</span>
              </p>
              <p className="line-clamp-4 text-[clamp(1.5rem,2.6vw,2.6rem)] leading-tight text-label">{latest.body}</p>
            </motion.div>
          ) : (
            <p className="text-title-3 text-label-tertiary">Announcements to the room appear here.</p>
          )}
        </Rise>
      </div>
    </div>
  );
}

function Reading({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-5 first:pl-0 sm:px-6 sm:py-7">
      <CountingNumber value={value} className="numeral text-[clamp(2.75rem,7vw,6.5rem)] leading-none text-label" />
      <span className="text-subheadline font-medium text-label-secondary sm:text-title-3">{label}</span>
    </div>
  );
}

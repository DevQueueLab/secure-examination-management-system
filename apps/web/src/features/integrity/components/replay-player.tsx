'use client';

import { Pause, Play, RotateCcw, SkipForward, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { useProvenance } from '../api';
import { count, provenanceLine } from '../format';
import styles from '../integrity.module.css';
import { buildReplay, clock, type Replay, type ReplayFrame, type WaveBar } from '../replay';
import type { ProvenanceView } from '../types';
import { CompositionBar } from './composition-bar';

const SPEEDS = ['1', '2', '4', '8', '16'] as const;
type Speed = (typeof SPEEDS)[number];

/** Pick the speed that plays the whole log in roughly half a minute. */
function defaultSpeed(totalMs: number): Speed {
  const wanted = totalMs / 30_000;
  return SPEEDS.find((s) => Number(s) >= wanted) ?? '16';
}

export function ReplayPlayer({ answerId, className }: { answerId: string; className?: string }) {
  const query = useProvenance(answerId);
  if (query.isPending) return <ReplaySkeleton className={className} />;
  if (query.isError) {
    return (
      <div className={cn('flex flex-col items-start gap-3 rounded-xl bg-surface p-5', className)}>
        <p className="text-callout text-label">{errorMessage(query.error, 'This replay could not be loaded.')}</p>
        <Button size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <LoadedReplay key={answerId} view={query.data} className={className} />;
}

function ReplaySkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading replay" className={cn('flex flex-col gap-4 rounded-xl bg-surface p-5', className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-5 w-72" />
      <div className="rounded-lg bg-bg p-4">
        <SkeletonText lines={6} />
      </div>
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function LoadedReplay({ view, className }: { view: ProvenanceView; className?: string }) {
  const replay = useMemo(() => (view.provenance && view.provenance.ops.length > 0 ? buildReplay(view.provenance) : null), [view.provenance]);
  const isCode = view.item.type === 'code';

  return (
    <section
      aria-label={`Authorship replay: ${view.item.label}`}
      className={cn(styles.tokens, 'flex min-w-0 flex-col rounded-xl bg-surface', className)}
    >
      <header className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-footnote text-label-secondary">
            <Avatar name={view.candidate.name} size="xs" />
            <span className="truncate">{view.candidate.name}</span>
            {view.candidate.rollNumber && <span className="shrink-0 tabular-nums text-label-tertiary">{view.candidate.rollNumber}</span>}
          </div>
          <h3 className="mt-1.5 text-headline text-label">{view.item.label}</h3>
          {view.summary && (
            <p className="mt-1 text-subheadline text-label-secondary" data-numeric>
              {provenanceLine(view.summary, view.composition)}
            </p>
          )}
        </div>
        {view.composition && <CompositionBar composition={view.composition} className="w-full shrink-0 sm:w-56" />}
      </header>

      {replay ? (
        <Player replay={replay} view={view} isCode={isCode} />
      ) : (
        <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
          <p className="text-callout text-label-secondary">
            No authorship log was recorded for this answer, so there is nothing to replay. The saved text is below.
          </p>
          <FinalText text={view.finalText} isCode={isCode} />
        </div>
      )}
    </section>
  );
}

function FinalText({ text, isCode }: { text: string; isCode: boolean }) {
  return (
    <div
      className={cn(
        'max-h-[26rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-4 text-label',
        isCode ? 'font-mono text-callout' : 'text-body leading-relaxed',
      )}
    >
      {text || <span className="text-label-tertiary">Empty</span>}
    </div>
  );
}

function Player({ replay, view, isCode }: { replay: Replay; view: ProvenanceView; isCode: boolean }) {
  const reduced = useReducedMotion();
  const n = replay.ops.length;
  // Open on the finished answer: the highlights are visible at once, the replay is one press away.
  const [position, setPosition] = useState(n);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(() => defaultSpeed(replay.total));
  const positionRef = useRef(position);
  const resumeAfterScrub = useRef(false);
  const textRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);

  const frame = useMemo(() => replay.frameAt(position), [replay, position]);

  const seek = (next: number) => {
    positionRef.current = next;
    setPosition(next);
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const next = replay.positionAt(replay.timeOf(positionRef.current) + dt * Number(speed));
      positionRef.current = next;
      setPosition(next);
      if (next >= n) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay, n]);

  // Keep the caret in view while the answer grows, without scrolling the page.
  useEffect(() => {
    const box = textRef.current;
    const caret = caretRef.current;
    if (!box || !caret || !playing) return;
    const top = caret.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 48) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  }, [frame, playing]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (positionRef.current >= n) seek(0);
    setPlaying(true);
  };

  const nextMark = replay.bars.find((b) => (b.kind === 'p' || b.kind === 'b') && b.index >= Math.floor(position) + (position % 1 > 0 ? 1 : 0) && b.index !== frame.opIndex);
  const jumpToNext = () => {
    if (!nextMark) return;
    seek(nextMark.index + 0.5);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      toggle();
    }
  };

  const atEnd = position >= n;
  const realNow = atEnd ? (view.provenance?.spanMs ?? frame.t) : frame.t;

  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <div className="px-5 pt-4">
        <div
          ref={textRef}
          aria-live="off"
          className={cn(
            'relative max-h-[26rem] min-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-4 text-label',
            isCode ? 'font-mono text-callout leading-relaxed' : 'text-body leading-[1.7]',
          )}
        >
          <ReplayText frame={frame} caretRef={caretRef} showCaret={!atEnd || playing} reduced={reduced} />
        </div>
        {view.provenance?.truncated && (
          <p className="mt-2 flex items-center gap-1.5 text-footnote text-label-secondary">
            <TriangleAlert aria-hidden className="size-3.5 text-warning" />
            The log reached its cap of {count(n, 'edit')}; the counts above stay exact and the saved text may continue past the replay.
          </p>
        )}
        {!view.provenance?.truncated && !view.replayMatchesFinal && atEnd && (
          <p className="mt-2 flex items-center gap-1.5 text-footnote text-label-secondary">
            <TriangleAlert aria-hidden className="size-3.5 text-warning" />
            The saved answer differs slightly from the end of the log (an edit arrived without its log entry).
          </p>
        )}
      </div>

      <Waveform replay={replay} position={position} onSeek={seek} onScrubStart={() => {
        resumeAfterScrub.current = playing;
        setPlaying(false);
      }} onScrubEnd={() => {
        if (resumeAfterScrub.current && positionRef.current < n) setPlaying(true);
        resumeAfterScrub.current = false;
      }} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-5 pb-5 pt-3">
        <Button
          variant="filled"
          size="icon-lg"
          className="rounded-full"
          onClick={toggle}
          aria-label={playing ? 'Pause replay' : atEnd ? 'Replay from the start' : 'Play replay'}
        >
          {playing ? <Pause /> : <Play className="translate-x-px" />}
        </Button>
        <Tooltip content="Back to the first edit">
          <Button variant="ghost" size="icon" aria-label="Back to the first edit" onClick={() => seek(0)}>
            <RotateCcw />
          </Button>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={jumpToNext} disabled={!nextMark}>
          <SkipForward />
          Next paste or burst
        </Button>
        <span className="text-callout tabular-nums text-label-secondary" aria-live="off">
          <span className="text-label">{clock(realNow)}</span> / {clock(view.provenance?.spanMs ?? 0)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-footnote text-label-secondary">Speed</span>
          <SegmentedControl
            size="sm"
            aria-label="Playback speed"
            value={speed}
            onValueChange={setSpeed}
            options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          />
        </div>
      </div>
      <Legend />
    </div>
  );
}

function ReplayText({
  frame,
  caretRef,
  showCaret,
  reduced,
}: {
  frame: ReplayFrame;
  caretRef: React.RefObject<HTMLSpanElement | null>;
  showCaret: boolean;
  reduced: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  let offset = 0;
  let caretPlaced = false;
  const caret = <span key="caret" ref={caretRef} aria-hidden className={styles.caret} />;
  frame.segments.forEach((segment, i) => {
    const start = offset;
    const end = offset + [...segment.text].length;
    offset = end;
    const className = cn(
      segment.origin === 'pasted' && styles.pasted,
      segment.origin === 'burst' && styles.burst,
      segment.fresh && !reduced && styles.arrived,
      segment.fresh && !reduced && (segment.origin === 'burst' ? styles.arrivedBurst : styles.arrivedPaste),
    );
    const label = segment.origin === 'typed' ? undefined : segment.origin === 'pasted' ? 'Pasted text' : 'Inserted in one burst';
    if (showCaret && !caretPlaced && frame.caret >= start && frame.caret < end) {
      const chars = [...segment.text];
      const cut = frame.caret - start;
      nodes.push(
        <span key={`${i}a`} className={className} title={label}>
          {chars.slice(0, cut).join('')}
        </span>,
        caret,
        <span key={`${i}b`} className={className} title={label}>
          {chars.slice(cut).join('')}
        </span>,
      );
      caretPlaced = true;
    } else {
      nodes.push(
        <span key={i} className={className} title={label}>
          {segment.text}
        </span>,
      );
    }
  });
  if (showCaret && !caretPlaced) nodes.push(caret);
  if (frame.length === 0 && !showCaret) nodes.push(<span key="empty" className="text-label-tertiary">Nothing written yet</span>);
  return <>{nodes}</>;
}

/**
 * The scrubber is the edit log itself: one bar per edit, inserts rising from the baseline and deletions
 * hanging below it. Pastes and bursts carry their size and time. A native range input sits on top, so
 * pointer, touch and keyboard scrubbing all behave like any slider.
 */
function Waveform({
  replay,
  position,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  replay: Replay;
  position: number;
  onSeek: (position: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const n = replay.ops.length;
  const maxInsert = Math.max(1, ...replay.bars.filter((b) => b.kind !== 'd').map((b) => b.size));
  const maxDelete = Math.max(1, ...replay.bars.filter((b) => b.kind === 'd').map((b) => b.size));
  const height = (b: WaveBar) =>
    b.kind === 'd' ? 3 + 11 * (Math.log1p(b.size) / Math.log1p(maxDelete)) : 6 + 30 * (Math.log1p(b.size) / Math.log1p(maxInsert));

  // Label the largest pastes and bursts, skipping any that would collide with a label already placed.
  const marks = replay.bars.filter((b) => b.kind === 'p' || b.kind === 'b');
  const labelled: WaveBar[] = [];
  for (const mark of [...marks].sort((a, b) => b.size - a.size)) {
    if (labelled.length >= 4) break;
    if (labelled.every((l) => Math.abs(l.index - mark.index) / n > 0.16)) labelled.push(mark);
  }
  const played = (index: number) => index < position;

  return (
    <div className="px-5 pt-4">
      <div className="relative h-[4.75rem] select-none">
        {labelled.map((m) => (
          <span
            key={`label-${m.index}`}
            className={cn(
              'absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-caption font-medium tabular-nums',
              m.kind === 'p' ? 'bg-[var(--paste-tint)] text-[var(--paste-ink)]' : 'bg-[var(--burst-tint)] text-[var(--burst-ink)]',
            )}
            style={{ left: `clamp(2.5rem, ${((m.index + 0.5) / n) * 100}%, calc(100% - 2.5rem))` }}
          >
            <span className="inline-flex gap-1.5">
              <span>
                {m.kind === 'p' ? 'Paste' : 'Burst'} {m.size.toLocaleString()}
              </span>
              <span className="opacity-75">{clock(m.t)}</span>
            </span>
          </span>
        ))}
        <div aria-hidden className="absolute inset-x-0 bottom-0 top-6">
          <span className="absolute inset-x-0 top-[36px] h-px bg-separator" />
          {replay.bars.map((b) => {
            const h = height(b);
            const left = (b.index / n) * 100;
            const width = `max(1px, calc(${100 / n}% - 1px))`;
            const tone =
              b.kind === 'p' ? 'var(--paste)' : b.kind === 'b' ? 'var(--burst)' : b.kind === 'd' ? 'var(--label-quaternary)' : 'var(--label-tertiary)';
            return (
              <span
                key={b.index}
                className="absolute rounded-[1px] transition-opacity duration-150"
                style={{
                  left: `${left}%`,
                  width,
                  height: h,
                  top: b.kind === 'd' ? 37 : 36 - h,
                  background: tone,
                  opacity: played(b.index) ? 1 : 0.32,
                }}
              />
            );
          })}
          <span
            className="absolute -top-1 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--surface)]"
            style={{ left: `${(position / n) * 100}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={n}
          step="any"
          value={position}
          aria-label="Replay position"
          aria-valuetext={`Edit ${Math.min(n, Math.floor(position) + 1)} of ${n}`}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              onSeek(Math.max(0, Math.min(n, Math.round(position) + (e.key === 'ArrowRight' ? 1 : -1))));
            }
          }}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-x-0 bottom-0 top-6 h-[calc(100%-1.5rem)] w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3 text-footnote text-label-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-4 rounded-[3px] bg-[var(--typed)]" /> Typed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn(styles.pasted, 'px-1 text-label')}>Aa</span> Pasted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn(styles.burst, 'px-1 text-label')}>Aa</span> Inserted in one burst (autofill, dictation, a tool)
      </span>
      <Badge tone="neutral" size="sm" className="ml-auto">
        Context for review, not evidence
      </Badge>
    </div>
  );
}

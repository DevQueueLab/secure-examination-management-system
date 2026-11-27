'use client';

import type { AttemptItemView, AttemptView } from '@athena/shared';
import { Flag, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { completion, type Completion } from '../lib/answers';
import type { AnswerRecord } from '../sync/journal';
import { useEngine, useEngineSelector } from '../lib/use-engine';
import { Meta } from './meta';

export interface ItemState {
  index: number;
  item: AttemptItemView;
  completion: Completion;
  flagged: boolean;
}

export interface PaperGroup {
  id: string;
  title: string | null;
  instructions: string | null;
  entries: ItemState[];
}

/** Items grouped by section, in paper order, with their answer state. */
export function groupPaper(view: AttemptView, items: AttemptItemView[], answers: Readonly<Record<string, AnswerRecord>>): PaperGroup[] {
  const sections = new Map(view.sections.map((s) => [s.id, s]));
  const groups: PaperGroup[] = [];
  items.forEach((item, index) => {
    const rec = answers[item.id];
    const entry: ItemState = { index, item, completion: completion(item, rec?.response ?? null), flagged: rec?.flagged ?? false };
    const key = item.sectionId ?? '__none';
    const last = groups[groups.length - 1];
    if (last && last.id === key) last.entries.push(entry);
    else {
      const section = item.sectionId ? sections.get(item.sectionId) : undefined;
      groups.push({ id: key, title: section?.title ?? null, instructions: section?.instructions ?? null, entries: [entry] });
    }
  });
  return groups;
}

export function usePaper() {
  const view = useEngineSelector((s) => s.view);
  const items = useEngineSelector((s) => s.items);
  const answers = useEngineSelector((s) => s.answers);
  return useMemo(() => {
    const groups = view ? groupPaper(view, items, answers) : [];
    const all = groups.flatMap((g) => g.entries);
    return {
      groups,
      all,
      answered: all.filter((e) => e.completion === 'complete').length,
      partial: all.filter((e) => e.completion === 'partial').length,
      flagged: all.filter((e) => e.flagged).length,
      total: all.length,
    };
  }, [view, items, answers]);
}

function stateWords(e: ItemState, current: boolean, locked: boolean): string {
  const parts = [e.completion === 'complete' ? 'answered' : e.completion === 'partial' ? 'partly answered' : 'not answered'];
  if (e.flagged) parts.push('flagged');
  if (current) parts.push('current question');
  if (locked) parts.push('locked');
  return parts.join(', ');
}

function Cell({
  e,
  current,
  locked,
  unreachable,
  onSelect,
  markerId,
  reduced,
}: {
  e: ItemState;
  current: boolean;
  locked: boolean;
  unreachable: boolean;
  onSelect: () => void;
  markerId: string;
  reduced: boolean;
}) {
  const complete = e.completion === 'complete';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked || unreachable}
      aria-current={current ? 'step' : undefined}
      aria-label={`Question ${e.index + 1}, ${stateWords(e, current, locked)}`}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-[10px] text-subheadline font-semibold tabular-nums max-md:size-11',
        'transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-95',
        'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus',
        complete && 'text-on-accent',
        e.completion === 'partial' && 'bg-accent-tint text-accent-text shadow-[inset_0_0_0_1.5px_var(--accent)]',
        e.completion === 'none' && 'bg-fill text-label-secondary hover:bg-fill-strong',
        (locked || unreachable) && 'cursor-default opacity-45 active:scale-100',
      )}
    >
      {/* The answered fill springs in from the centre when a question is completed. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-[10px] bg-accent"
        initial={false}
        animate={complete ? { scale: 1, opacity: 1 } : { scale: 0.45, opacity: 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', bounce: 0.3, visualDuration: 0.26 }}
      />
      {/* One marker per map, gliding from cell to cell (4px outside, so its corners stay concentric). */}
      {current && (
        <motion.span
          aria-hidden
          layoutId={markerId}
          className="pointer-events-none absolute -inset-1 rounded-[14px] shadow-[inset_0_0_0_2px_var(--label)]"
          transition={reduced ? { duration: 0 } : spring.snappy}
        />
      )}
      <span className="relative">{e.index + 1}</span>
      {e.flagged && (
        <motion.span
          aria-hidden
          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-warning text-white shadow-xs"
          initial={reduced ? false : { y: -7, scale: 0.4, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.4, visualDuration: 0.28 }}
        >
          <Flag className="size-2.5" strokeWidth={3} fill="currentColor" />
        </motion.span>
      )}
    </button>
  );
}

function Legend({ className }: { className?: string }) {
  const chip = (cls: string, label: string, extra?: ReactNode) => (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={cn('relative size-3.5 rounded-[4px]', cls)}>
        {extra}
      </span>
      {label}
    </li>
  );
  return (
    <ul className={cn('flex flex-wrap gap-x-3.5 gap-y-1.5 text-footnote text-label-secondary', className)} aria-label="Legend">
      {chip('bg-accent', 'Answered')}
      {chip('bg-accent-tint shadow-[inset_0_0_0_1.5px_var(--accent)]', 'Partly')}
      {chip('bg-fill', 'Not answered')}
      {chip('bg-fill', 'Flagged', <span className="absolute -right-1 -top-1 size-2 rounded-full bg-warning" />)}
      {chip('bg-fill ring-2 ring-label ring-offset-1 ring-offset-[var(--nav-bg,var(--surface))]', 'Current')}
    </ul>
  );
}

/**
 * The question map: answered, partly answered, unanswered, flagged and current at a glance.
 * `layout` 'rail' sits beside the paper, 'strip' runs along the bottom, 'sheet' fills the mobile sheet.
 */
export function Navigator({ layout, onNavigate }: { layout: 'rail' | 'strip' | 'sheet'; onNavigate?: (index: number) => void }) {
  const engine = useEngine();
  const paper = usePaper();
  const current = useEngineSelector((s) => s.current);
  const max = useEngineSelector((s) => s.max);
  const linear = useEngineSelector((s) => s.view?.settings.navigation === 'linear');
  const markerId = `nav-current-${useId()}`;
  const reduced = useReducedMotion();
  const select = (index: number) => {
    if (onNavigate) onNavigate(index);
    else engine.goTo(index);
  };

  const counts = (
    <p className="text-subheadline text-label" data-numeric>
      <Meta
        items={[
          <>
            <span className="font-semibold">{paper.answered}</span>
            <span className="text-label-secondary"> of {paper.total} answered</span>
          </>,
          paper.partial > 0 && <span className="text-label-secondary">{paper.partial} partly</span>,
          paper.flagged > 0 && <span className="text-label-secondary">{paper.flagged} flagged</span>,
        ]}
      />
    </p>
  );

  const linearNote = linear ? (
    <p className="flex items-start gap-2 text-footnote text-label-secondary">
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      This exam moves forward only. Questions you’ve left are locked.
    </p>
  ) : null;

  if (layout === 'strip') {
    return (
      <nav aria-label="Questions" className="flex items-center gap-4 px-4 py-2.5 sm:px-6">
        <div className="hidden shrink-0 lg:block">{counts}</div>
        <ol className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-1.5">
          {paper.groups.map((g, gi) => (
            <li key={g.id} className="flex items-center gap-1.5">
              {gi > 0 && <span aria-hidden className="mx-1.5 h-6 w-px shrink-0 bg-separator-strong" />}
              {g.title && <span className="sr-only">{g.title}</span>}
              <ol className="flex items-center gap-1.5">
                {g.entries.map((e) => (
                  <li key={e.item.id}>
                    <Cell
                      e={e}
                      current={e.index === current}
                      locked={linear && e.index < max}
                      unreachable={linear && e.index > max + 1}
                      onSelect={() => select(e.index)}
                      markerId={markerId}
                      reduced={reduced}
                    />
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="Questions" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">{counts}</div>
      <div className="flex flex-col gap-4">
        {paper.groups.map((g) => (
          <section key={g.id} aria-label={g.title ?? 'Questions'} className="flex flex-col gap-2">
            {g.title && (
              <h3 className="flex items-baseline justify-between gap-3 text-footnote font-semibold text-label-secondary">
                <span className="min-w-0">{g.title}</span>
                <span className="shrink-0 font-normal text-label-tertiary" data-numeric>
                  <span className="sr-only">, </span>
                  {g.entries.filter((e) => e.completion === 'complete').length} of {g.entries.length}
                </span>
              </h3>
            )}
            <ol className={cn('grid gap-2', layout === 'sheet' ? 'grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]' : 'grid-cols-5')}>
              {g.entries.map((e) => (
                <li key={e.item.id} className="flex justify-center">
                  <Cell
                    e={e}
                    current={e.index === current}
                    locked={linear && e.index < max}
                    unreachable={linear && e.index > max + 1}
                    onSelect={() => select(e.index)}
                    markerId={markerId}
                    reduced={reduced}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <Legend />
      {linearNote}
    </nav>
  );
}

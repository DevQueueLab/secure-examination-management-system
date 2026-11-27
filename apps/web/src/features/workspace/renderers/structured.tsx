'use client';

import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Reorder, useDragControls } from 'motion/react';
import { Fragment, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { useSpring } from '@/lib/motion';
import { ANSWER_LIMITS } from '../lib/answers';
import { Markdown } from '../components/markdown';
import styles from '../workspace.module.css';
import { str, type RendererProps } from './shared';

const BLANK = /\[\[([^\]]+?)\]\]/g;

export function FillBlanks({ content, response, disabled, idBase, onChange }: RendererProps<'fill_blanks'>) {
  const values = (response?.blanks && typeof response.blanks === 'object' ? response.blanks : {}) as Record<string, unknown>;
  const blanks = content.blanks ?? [];
  const template = content.template ?? '';
  const parts = useMemo(() => template.split(BLANK), [template]);
  const inTemplate = useMemo(() => new Set(parts.filter((_, i) => i % 2 === 1)), [parts]);
  const extra = blanks.filter((b) => !inTemplate.has(b.id));
  const numberOf = (id: string) => blanks.findIndex((b) => b.id === id) + 1;

  const set = (id: string, text: string) => {
    const next: Record<string, string> = {};
    for (const b of blanks) {
      const v = b.id === id ? text : str(values[b.id]);
      if (v) next[b.id] = v;
    }
    onChange({ blanks: next });
  };

  const field = (id: string) => {
    const blank = blanks.find((b) => b.id === id);
    const n = numberOf(id);
    const value = str(values[id]);
    return (
      <input
        key={id}
        id={`${idBase}-blank-${id}`}
        value={value}
        disabled={disabled}
        maxLength={ANSWER_LIMITS.blank}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => set(id, e.target.value)}
        aria-label={blank?.label ? `Blank ${n}: ${blank.label}` : `Blank ${n}`}
        placeholder={blank?.label ?? String(n)}
        className={cn(
          'mx-0.5 inline-block h-[1.9em] min-w-[6ch] max-w-full rounded-t-md border-b-2 border-separator-strong bg-fill-secondary px-2 align-baseline',
          'text-label outline-none transition-[border-color,background-color] [field-sizing:content] placeholder:text-placeholder/70',
          'focus:border-accent focus:bg-accent-tint/40 disabled:opacity-60',
          value && 'border-accent/60',
        )}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className={cn('whitespace-pre-wrap', styles.reading)}>
        {parts.map((part, i) => (i % 2 === 1 ? field(part) : <Fragment key={`t${i}`}>{part}</Fragment>))}
      </p>
      {extra.length > 0 && (
        <div className="flex flex-col gap-3">
          {extra.map((b) => (
            <label key={b.id} className="flex flex-col gap-1.5 text-subheadline font-medium text-label">
              {b.label ?? `Blank ${numberOf(b.id)}`}
              {field(b.id)}
            </label>
          ))}
        </div>
      )}
      <p className="text-footnote text-label-secondary" data-numeric>
        {blanks.filter((b) => str(values[b.id]).trim()).length} of {blanks.length} blanks filled
      </p>
    </div>
  );
}

const NONE = '__none__';

export function Matching({ content, response, disabled, idBase, onChange }: RendererProps<'matching'>) {
  const pairs = (response?.pairs && typeof response.pairs === 'object' ? response.pairs : {}) as Record<string, unknown>;
  const prompts = content.prompts ?? [];
  const answers = content.answers ?? [];

  const set = (promptId: string, answerId: string | null) => {
    const next: Record<string, string | null> = {};
    for (const p of prompts) {
      const v = p.id === promptId ? answerId : typeof pairs[p.id] === 'string' ? (pairs[p.id] as string) : null;
      if (v) next[p.id] = v;
    }
    onChange({ pairs: next });
  };

  const usedBy = new Map<string, number>();
  for (const p of prompts) {
    const v = pairs[p.id];
    if (typeof v === 'string') usedBy.set(v, (usedBy.get(v) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-subheadline text-label-secondary">Choose a match for each item.</p>
      <ol className="flex flex-col gap-2.5">
        {prompts.map((prompt, index) => {
          const value = typeof pairs[prompt.id] === 'string' ? (pairs[prompt.id] as string) : NONE;
          const labelId = `${idBase}-match-${prompt.id}`;
          return (
            <li
              key={prompt.id}
              className="grid items-center gap-x-4 gap-y-2 rounded-xl bg-surface px-4 py-3 shadow-xs ring-1 ring-separator sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)]"
            >
              <div id={labelId} className={cn('flex min-w-0 gap-2.5', styles.readingSm)}>
                <span className="shrink-0 font-semibold text-label-tertiary" data-numeric>
                  {index + 1}.
                </span>
                <Markdown inline>{prompt.text}</Markdown>
              </div>
              <SelectRoot value={value} onValueChange={(v) => set(prompt.id, v === NONE ? null : v)} disabled={disabled}>
                <SelectTrigger size="lg" aria-labelledby={labelId} className={cn('w-full', value === NONE && 'text-placeholder')}>
                  <SelectValue placeholder="Choose a match" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not answered</SelectItem>
                  {answers.map((a) => (
                    <SelectItem key={a.id} value={a.id} description={value !== a.id && usedBy.has(a.id) ? 'Already used' : undefined}>
                      <Markdown inline>{a.text}</Markdown>
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Ordering({ content, response, disabled, idBase, onChange }: RendererProps<'ordering'>) {
  const items = content.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const stored = Array.isArray(response?.order) ? (response.order as string[]).filter((id) => byId.has(id)) : null;
  // Items missing from a stored order (an edited question) go to the end rather than vanish.
  const order = stored ? [...stored, ...items.map((i) => i.id).filter((id) => !stored.includes(id))] : items.map((i) => i.id);
  const [announcement, setAnnouncement] = useState('');

  const move = (id: string, delta: number) => {
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onChange({ order: next });
    setAnnouncement(`Moved to position ${to + 1} of ${order.length}.`);
    // Keep focus on the moved item: on the same arrow, or the other one once it reaches an end.
    requestAnimationFrame(() => {
      const same = document.getElementById(`${idBase}-order-${id}-${delta < 0 ? 'up' : 'down'}`) as HTMLButtonElement | null;
      const other = document.getElementById(`${idBase}-order-${id}-${delta < 0 ? 'down' : 'up'}`);
      (same && !same.disabled ? same : other)?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-subheadline text-label-secondary">Drag the handles, or use the up and down buttons, to put these in order. The first item goes at the top.</p>
      <Reorder.Group
        axis="y"
        values={order}
        onReorder={(next: string[]) => !disabled && onChange({ order: next })}
        as="ol"
        className="flex flex-col gap-2"
        aria-label="Items to order"
      >
        {order.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <OrderRow
              key={id}
              id={id}
              idBase={idBase}
              index={index}
              count={order.length}
              text={item.text}
              disabled={disabled}
              onMove={move}
            />
          );
        })}
      </Reorder.Group>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-footnote text-label-secondary">{stored ? 'Your order is saved.' : 'Not answered yet. Move an item, or keep this order.'}</p>
        {!stored && !disabled && (
          <Button variant="tinted" size="sm" className="max-md:h-11" onClick={() => onChange({ order })}>
            Keep this order
          </Button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function OrderRow({
  id,
  idBase,
  index,
  count,
  text,
  disabled,
  onMove,
}: {
  id: string;
  idBase: string;
  index: number;
  count: number;
  text: string;
  disabled: boolean;
  onMove: (id: string, delta: number) => void;
}) {
  const controls = useDragControls();
  const transition = useSpring('gentle');
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={transition}
      whileDrag={{ scale: 1.015, boxShadow: 'var(--sh-lg)' }}
      className="relative flex items-center gap-2 rounded-xl bg-surface py-1.5 pl-1.5 pr-2 shadow-xs ring-1 ring-separator"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          controls.start(e);
        }}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-label-tertiary hover:bg-fill-secondary hover:text-label-secondary active:cursor-grabbing disabled:cursor-default"
      >
        <GripVertical className="size-[18px]" />
      </button>
      <span className="w-6 shrink-0 text-center text-subheadline font-semibold text-label-tertiary" data-numeric>
        {index + 1}
      </span>
      <span className={cn('min-w-0 flex-1 py-2', styles.readingSm)}>
        <Markdown inline>{text}</Markdown>
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          id={`${idBase}-order-${id}-up`}
          variant="ghost"
          size="icon"
          className="max-md:size-11"
          disabled={disabled || index === 0}
          onClick={() => onMove(id, -1)}
          aria-label={`Move up from position ${index + 1} of ${count}`}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          id={`${idBase}-order-${id}-down`}
          variant="ghost"
          size="icon"
          className="max-md:size-11"
          disabled={disabled || index === count - 1}
          onClick={() => onMove(id, 1)}
          aria-label={`Move down from position ${index + 1} of ${count}`}
        >
          <ChevronDown aria-hidden />
        </Button>
      </div>
    </Reorder.Item>
  );
}

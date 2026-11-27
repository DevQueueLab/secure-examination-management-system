'use client';

import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/**
 * A list of short values as removable chips. Enter, comma or Tab adds what's typed; Backspace on an empty
 * input removes the last chip; pasting "a, b, c" adds three. Used for tags and accepted answers.
 */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  normalize = (s) => s.trim(),
  separators = [',', 'Enter', 'Tab'],
  max = 50,
  mono = false,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  normalize?: (s: string) => string;
  separators?: string[];
  max?: number;
  mono?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const field = useFieldControl({ id, disabled });
  const [draft, setDraft] = useState('');
  const listId = useId();

  const addMany = (raw: string[]) => {
    const next = [...value];
    for (const r of raw) {
      const v = normalize(r);
      if (v && !next.includes(v) && next.length < max) next.push(v);
    }
    if (next.length !== value.length) onChange(next);
  };

  const commit = () => {
    if (!draft.trim()) return;
    addMany([draft]);
    setDraft('');
  };

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg bg-fill-secondary px-2 py-1.5 ring-1 ring-inset ring-transparent focus-within:ring-accent',
        field['aria-invalid'] && 'ring-danger',
        field.disabled && 'opacity-60',
      )}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
    >
      {value.map((v) => (
        <span key={v} className={cn('inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-surface px-2 text-footnote text-label shadow-xs', mono && 'font-mono')}>
          <span className="truncate">{v}</span>
          {!field.disabled && (
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== v));
              }}
              className="-mr-1 inline-flex size-4 items-center justify-center rounded text-label-tertiary hover:bg-fill hover:text-label"
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        {...field}
        aria-label={ariaLabel}
        list={suggestions.length ? listId : undefined}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          const splitter = separators.includes(',') ? /[,\n]/ : /\n/;
          if (splitter.test(text)) {
            e.preventDefault();
            addMany(text.split(splitter));
          }
        }}
        onKeyDown={(e) => {
          if (separators.includes(e.key) && draft.trim()) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        className={cn('h-6 min-w-24 flex-1 bg-transparent text-callout text-label outline-none placeholder:text-label-tertiary', mono && 'font-mono')}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .slice(0, 30)
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}

'use client';

import { Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Markdown } from '../components/markdown';
import styles from '../workspace.module.css';
import { optionLetter, type RendererProps } from './shared';

const optionCard = [
  'group relative flex min-h-12 cursor-pointer items-start gap-3.5 rounded-xl bg-surface px-4 py-3 text-label',
  'shadow-xs ring-1 ring-separator transition-[box-shadow,background-color,transform] duration-150 ease-out',
  'hover:ring-separator-strong active:scale-[0.995]',
  'has-[:checked]:bg-accent-tint/50 has-[:checked]:ring-2 has-[:checked]:ring-accent',
  'has-[:focus-visible]:outline-[length:var(--focus-width)] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
  'has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:disabled]:active:scale-100',
].join(' ');

/** The option's letter doubles as its selection mark: outlined when free, filled when chosen. */
function LetterMark({ letter, checked, shape }: { letter: string; checked: boolean; shape: 'round' | 'square' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-px flex size-7 shrink-0 items-center justify-center text-subheadline font-semibold transition-[background-color,color,box-shadow] duration-150',
        shape === 'round' ? 'rounded-full' : 'rounded-[7px]',
        checked ? 'bg-accent text-on-accent' : 'bg-surface text-label-secondary ring-1 ring-separator-strong group-hover:ring-label-tertiary',
      )}
    >
      {checked && shape === 'square' ? <Check className="size-4" strokeWidth={3} /> : letter}
    </span>
  );
}

export function SingleChoice({ content, response, disabled, idBase, onChange, registerDigits }: RendererProps<'single_choice'>) {
  const selected = typeof response?.optionId === 'string' ? response.optionId : null;
  const options = content.options ?? [];

  useEffect(() => {
    if (!registerDigits) return;
    registerDigits((digit) => {
      const option = options[digit - 1];
      if (option && !disabled) onChange({ optionId: option.id });
    });
    return () => registerDigits(null);
  }, [registerDigits, options, disabled, onChange]);

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="sr-only">Choose one answer</legend>
      {options.map((option, index) => {
        const checked = selected === option.id;
        return (
          <label key={option.id} className={optionCard}>
            <input
              type="radio"
              name={`${idBase}-choice`}
              value={option.id}
              checked={checked}
              onChange={() => onChange({ optionId: option.id })}
              className="sr-only"
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
            />
            <LetterMark letter={optionLetter(index)} checked={checked} shape="round" />
            <span className={cn('min-w-0 flex-1 pt-0.5', styles.readingSm)}>
              <span className="sr-only">{optionLetter(index)}. </span>
              <Markdown inline>{option.text}</Markdown>
            </span>
          </label>
        );
      })}
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-footnote text-label-tertiary max-md:hidden">
          {options.length > 1 ? `Press 1–${Math.min(9, options.length)} to choose` : null}
        </p>
        {selected && !disabled && (
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => onChange({ optionId: null })}>
            Clear answer
          </Button>
        )}
      </div>
    </fieldset>
  );
}

export function MultipleChoice({ content, response, disabled, idBase, onChange, registerDigits }: RendererProps<'multiple_choice'>) {
  const selected = Array.isArray(response?.optionIds) ? (response.optionIds as string[]) : [];
  const options = content.options ?? [];

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    // Keep the authored order so the stored answer reads naturally.
    const ordered = options.map((o) => o.id).filter((x) => next.includes(x));
    onChange({ optionIds: ordered });
  };

  useEffect(() => {
    if (!registerDigits) return;
    registerDigits((digit) => {
      const option = options[digit - 1];
      if (option && !disabled) toggle(option.id);
    });
    return () => registerDigits(null);
  });

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled} aria-describedby={`${idBase}-multi-hint`}>
      <legend className="sr-only">Choose every answer that applies</legend>
      <p id={`${idBase}-multi-hint`} className="flex flex-wrap gap-x-4 text-subheadline text-label-secondary" data-numeric>
        <span>Select all that apply.</span>
        {selected.length > 0 && <span className="text-label-tertiary">{selected.length} selected</span>}
      </p>
      {options.map((option, index) => {
        const checked = selected.includes(option.id);
        return (
          <label key={option.id} className={optionCard}>
            <input
              type="checkbox"
              value={option.id}
              checked={checked}
              onChange={() => toggle(option.id)}
              className="sr-only"
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
            />
            <LetterMark letter={optionLetter(index)} checked={checked} shape="square" />
            <span className={cn('min-w-0 flex-1 pt-0.5', styles.readingSm)}>
              <span className="sr-only">{optionLetter(index)}. </span>
              <Markdown inline>{option.text}</Markdown>
            </span>
          </label>
        );
      })}
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-footnote text-label-tertiary max-md:hidden">Press 1–{Math.min(9, options.length)} to select or clear</p>
        {selected.length > 0 && !disabled && (
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => onChange({ optionIds: [] })}>
            Clear all
          </Button>
        )}
      </div>
    </fieldset>
  );
}

const segment = [
  'relative flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] text-body font-semibold text-label-secondary',
  'transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]',
  'hover:text-label has-[:checked]:bg-surface has-[:checked]:text-label has-[:checked]:shadow-sm',
  'has-[:focus-visible]:outline-[length:var(--focus-width)] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
  'has-[:disabled]:cursor-default has-[:disabled]:opacity-60',
].join(' ');

export function TrueFalse({ response, disabled, idBase, onChange, registerDigits }: RendererProps<'true_false'>) {
  const value = typeof response?.value === 'boolean' ? response.value : null;

  useEffect(() => {
    if (!registerDigits) return;
    registerDigits((digit) => {
      if (disabled) return;
      if (digit === 1) onChange({ value: true });
      if (digit === 2) onChange({ value: false });
    });
    return () => registerDigits(null);
  }, [registerDigits, disabled, onChange]);

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">True or false</legend>
      <div className="flex gap-1 rounded-[14px] bg-fill p-1 sm:max-w-md">
        {[
          { v: true, label: 'True', icon: <Check aria-hidden className="size-[18px]" strokeWidth={2.5} />, key: '1' },
          { v: false, label: 'False', icon: <X aria-hidden className="size-[18px]" strokeWidth={2.5} />, key: '2' },
        ].map((opt) => (
          <label key={opt.label} className={segment}>
            <input
              type="radio"
              name={`${idBase}-tf`}
              checked={value === opt.v}
              onChange={() => onChange({ value: opt.v })}
              className="sr-only"
              aria-keyshortcuts={opt.key}
            />
            <span className={cn('transition-colors', value === opt.v ? (opt.v ? 'text-success' : 'text-danger') : 'text-label-tertiary')}>{opt.icon}</span>
            {opt.label}
          </label>
        ))}
      </div>
      <div className="flex min-h-9 items-center justify-between gap-3 sm:max-w-md">
        <p className="text-footnote text-label-tertiary max-md:hidden">Press 1 for true, 2 for false</p>
        {value !== null && !disabled && (
          <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => onChange({ value: null })}>
            Clear answer
          </Button>
        )}
      </div>
    </fieldset>
  );
}

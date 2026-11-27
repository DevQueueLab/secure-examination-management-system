'use client';

import { useMemo, useRef, type KeyboardEvent } from 'react';
import { Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ANSWER_LIMITS, countWords } from '../lib/answers';
import { usePreferences } from '../lib/preferences';
import styles from '../workspace.module.css';
import { str, usePasteTracker, type RendererProps } from './shared';

const NUMBER_LIKE = /^\s*[-+−]?(\d[\d\s,]*([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?\s*$/i;

export function NumericAnswer({ content, response, disabled, idBase, onChange }: RendererProps<'numeric'>) {
  const value = str(response?.value);
  const looksOff = value.trim() !== '' && !NUMBER_LIKE.test(value);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${idBase}-numeric`} className="text-subheadline font-medium text-label">
        Your answer{content.unit ? <span className="font-normal text-label-secondary"> in {content.unit}</span> : null}
      </label>
      <div className="flex items-center gap-3">
        <Input
          id={`${idBase}-numeric`}
          size="lg"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          maxLength={ANSWER_LIMITS.numeric}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-describedby={`${idBase}-numeric-hint`}
          aria-invalid={looksOff || undefined}
          containerClassName="w-full max-w-64"
          className={cn('max-w-64 font-mono tabular-nums', styles.answerField)}
          trailing={content.unit ? <span className="pr-3 text-callout text-label-secondary">{content.unit}</span> : undefined}
        />
      </div>
      <p id={`${idBase}-numeric-hint`} className={cn('text-footnote', looksOff ? 'text-warning-text' : 'text-label-secondary')}>
        {looksOff
          ? 'This doesn’t look like a number. It’s saved exactly as you typed it.'
          : 'A number such as 12.5, −3 or 6.02e23. Use a full stop for decimals.'}
      </p>
    </div>
  );
}

export function ShortTextAnswer({ content, response, disabled, idBase, onChange }: RendererProps<'short_text'>) {
  const text = str(response?.text);
  const max = Math.min(content.maxLength ?? 200, ANSWER_LIMITS.shortText);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${idBase}-short`} className="text-subheadline font-medium text-label">
        Your answer
      </label>
      <Input
        id={`${idBase}-short`}
        size="lg"
        autoComplete="off"
        maxLength={max}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange({ text: e.target.value })}
        aria-describedby={`${idBase}-short-count`}
        containerClassName="w-full max-w-xl"
        className={cn('max-w-xl', styles.answerField)}
      />
      <p id={`${idBase}-short-count`} className="text-footnote text-label-tertiary" data-numeric>
        {text.length} / {max} characters
      </p>
    </div>
  );
}

function wordGuidance(words: number, min?: number, max?: number): { text: string; tone: 'neutral' | 'warning' } {
  const count = `${words} ${words === 1 ? 'word' : 'words'}`;
  if (max && words > max) return { text: `${count}, ${words - max} over the ${max}-word limit`, tone: 'warning' };
  if (min && words < min) return { text: `${count}, ${min - words} more to reach ${min}`, tone: 'neutral' };
  if (min && max) return { text: `${count}, within the ${min}–${max} range`, tone: 'neutral' };
  if (max) return { text: `${count} of up to ${max}`, tone: 'neutral' };
  if (min) return { text: `${count}, past the ${min}-word minimum`, tone: 'neutral' };
  return { text: count, tone: 'neutral' };
}

export function LongTextAnswer({ content, response, disabled, idBase, onChange }: RendererProps<'long_text'>) {
  const { prefs } = usePreferences();
  const paste = usePasteTracker();
  const text = str(response?.text);
  const words = useMemo(() => countWords(text), [text]);
  const guide = wordGuidance(words, content.minWords, content.maxWords);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${idBase}-long`} className="text-subheadline font-medium text-label">
        Your answer
      </label>
      <Textarea
        id={`${idBase}-long`}
        value={text}
        disabled={disabled}
        rows={10}
        maxLength={ANSWER_LIMITS.longText}
        spellCheck
        onPaste={paste.onPaste}
        onChange={(e) => {
          const next = e.target.value;
          onChange({ text: next }, { field: 'response', prev: text, next, pasted: paste.take() });
        }}
        aria-describedby={prefs.showWordCount ? `${idBase}-long-count` : undefined}
        className={cn('min-h-64 max-h-none px-4 py-3', styles.answerField)}
      />
      {prefs.showWordCount && (
        <p id={`${idBase}-long-count`} className={cn('text-footnote', guide.tone === 'warning' ? 'text-warning-text' : 'text-label-secondary')} data-numeric>
          {guide.text}
        </p>
      )}
    </div>
  );
}

const LANGUAGE_LABEL: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  sql: 'SQL',
  other: 'Code',
};

const INDENT = '    ';

/** Inserts text at the selection so the browser's own undo history keeps working. */
function insertText(el: HTMLTextAreaElement, text: string) {
  el.focus();
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!ok) {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function CodeAnswer({ content, response, disabled, idBase, onChange }: RendererProps<'code'>) {
  const paste = usePasteTracker();
  const escaped = useRef(false);
  const code = typeof response?.code === 'string' ? response.code : (content.starterCode ?? '');
  const lines = code.split('\n').length;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === 'Escape') {
      // Esc, then Tab, leaves the editor: Tab alone indents.
      escaped.current = true;
      return;
    }
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) {
      escaped.current = false;
      return;
    }
    if (escaped.current) {
      escaped.current = false;
      return;
    }
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    if (e.shiftKey) {
      const block = value.slice(lineStart, end);
      const outdented = block.replace(/^( {1,4}|\t)/gm, '');
      if (outdented === block) return;
      el.setSelectionRange(lineStart, end);
      insertText(el, outdented);
      return;
    }
    if (start !== end && value.slice(start, end).includes('\n')) {
      const block = value.slice(lineStart, end);
      el.setSelectionRange(lineStart, end);
      insertText(el, block.replace(/^/gm, INDENT));
      return;
    }
    insertText(el, INDENT);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`${idBase}-code`} className="text-subheadline font-medium text-label">
          Your code
        </label>
        <span className="text-footnote text-label-secondary">{LANGUAGE_LABEL[content.language ?? 'other'] ?? 'Code'}</span>
      </div>
      <div className="overflow-hidden rounded-xl bg-surface-sunken ring-1 ring-separator focus-within:ring-2 focus-within:ring-accent">
        <textarea
          id={`${idBase}-code`}
          value={code}
          disabled={disabled}
          rows={Math.min(28, Math.max(12, lines + 2))}
          maxLength={ANSWER_LIMITS.code}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onPaste={paste.onPaste}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ code: next }, { field: 'response', prev: code, next, pasted: paste.take() });
          }}
          aria-describedby={`${idBase}-code-hint`}
          className={cn('block w-full resize-y bg-transparent px-4 py-3 text-label outline-none disabled:opacity-60', styles.codeField)}
        />
      </div>
      <p id={`${idBase}-code-hint`} className="text-footnote text-label-secondary" data-numeric>
        {lines} {lines === 1 ? 'line' : 'lines'}. Tab indents, Shift-Tab outdents. Press Esc, then Tab, to leave the editor.
      </p>
    </div>
  );
}

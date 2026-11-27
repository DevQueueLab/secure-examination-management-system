'use client';

import type { AttemptItemView, WorkingResponse } from '@athena/shared';
import { NotebookPen, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ANSWER_LIMITS, workingEnabled } from '../lib/answers';
import { useEngineSelector } from '../lib/use-engine';
import { usePasteTracker } from '../renderers/shared';
import type { TextEdit } from '../sync/engine';
import type { AnswerRecord, ScratchpadRecord } from '../sync/journal';
import styles from '../workspace.module.css';

export const GENERAL_PAGE = 'general';
export const questionPage = (itemId: string) => `q:${itemId}`;

/** A scratchpad page has content worth attaching: at least one stroke or some notes. */
export function pageHasContent(page: ScratchpadRecord | undefined): boolean {
  if (!page) return false;
  const strokes = (page.data as { strokes?: unknown }).strokes;
  const text = (page.data as { text?: unknown }).text;
  return (Array.isArray(strokes) && strokes.length > 0) || (typeof text === 'string' && text.trim().length > 0);
}

export function usePageLabel(): (pageKey: string) => string {
  const items = useEngineSelector((s) => s.items);
  return (pageKey: string) => {
    if (pageKey === GENERAL_PAGE) return 'General page';
    if (pageKey.startsWith('q:')) {
      const index = items.findIndex((i) => i.id === pageKey.slice(2));
      return index >= 0 ? `Question ${index + 1} page` : 'Question page';
    }
    return 'Scratch page';
  };
}

/** "Show your working": method marks, a text answer for the steps, and scratch pages attached as evidence. */
export function WorkingSection({
  item,
  record,
  disabled,
  idBase,
  onChange,
  onOpenScratchpad,
}: {
  item: AttemptItemView;
  record: AnswerRecord | undefined;
  disabled: boolean;
  idBase: string;
  onChange: (working: WorkingResponse | null, edit?: TextEdit) => void;
  onOpenScratchpad?: (pageKey: string) => void;
}) {
  const config = workingEnabled(item);
  const paste = usePasteTracker();
  const scratchpads = useEngineSelector((s) => s.scratchpads);
  const pageLabel = usePageLabel();
  if (!config.enabled) return null;

  const text = record?.working?.text ?? '';
  const attached = record?.working?.scratchPages ?? [];
  const candidates = [GENERAL_PAGE, questionPage(item.id), ...Object.keys(scratchpads)]
    .filter((key, i, all) => all.indexOf(key) === i && key.length <= 64 && !key.startsWith('n:'))
    .filter((key) => !attached.includes(key) && pageHasContent(scratchpads[key]));

  const update = (next: Partial<WorkingResponse>, edit?: TextEdit) => {
    const merged: WorkingResponse = { text: next.text ?? text, scratchPages: next.scratchPages ?? attached };
    onChange(merged.text.trim() || merged.scratchPages.length ? merged : null, edit);
  };

  return (
    <section aria-labelledby={`${idBase}-working-title`} className="flex flex-col gap-3 rounded-xl bg-surface-sunken/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`${idBase}-working-title`} className="text-headline text-label">
          Show your working
        </h3>
        {config.marks > 0 && (
          <span className="text-footnote text-label-secondary" data-numeric>
            {config.marks} {config.marks === 1 ? 'mark' : 'marks'} for method
          </span>
        )}
      </div>
      {config.guidance && <p className="-mt-1 text-subheadline text-label-secondary">{config.guidance}</p>}
      <Textarea
        id={`${idBase}-working`}
        value={text}
        disabled={disabled}
        rows={4}
        maxLength={ANSWER_LIMITS.working}
        placeholder="Write the steps you took. Examiners can award method marks even when the final answer is wrong."
        onPaste={paste.onPaste}
        onChange={(e) => {
          const next = e.target.value;
          update({ text: next }, { field: 'working', prev: text, next, pasted: paste.take() });
        }}
        aria-labelledby={`${idBase}-working-title`}
        className={cn('min-h-28 bg-surface', styles.answerField)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {attached.map((key) => (
          <span key={key} className="flex h-8 items-center gap-1.5 rounded-full bg-surface pl-3 pr-1 text-subheadline text-label shadow-xs ring-1 ring-separator">
            <button
              type="button"
              className="flex items-center gap-1.5 hover:text-accent-text"
              onClick={() => onOpenScratchpad?.(key)}
              aria-label={`Open ${pageLabel(key)}`}
            >
              <NotebookPen aria-hidden className="size-3.5 text-label-secondary" />
              {pageLabel(key)}
            </button>
            {!disabled && (
              <button
                type="button"
                onClick={() => update({ scratchPages: attached.filter((k) => k !== key) })}
                className="flex size-6 items-center justify-center rounded-full text-label-tertiary hover:bg-fill hover:text-label"
                aria-label={`Detach ${pageLabel(key)}`}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {!disabled && attached.length < 10 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="plain" size="sm" className="max-md:h-11">
                <Paperclip aria-hidden />
                Attach scratch page
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {candidates.length > 0 ? (
                <>
                  <DropdownMenuLabel>Attach to this answer</DropdownMenuLabel>
                  {candidates.map((key) => (
                    <DropdownMenuItem key={key} icon={<NotebookPen />} onSelect={() => update({ scratchPages: [...attached, key] })}>
                      {pageLabel(key)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              ) : (
                <DropdownMenuLabel className="max-w-64 whitespace-normal font-normal">
                  Nothing to attach yet. Draw on the scratchpad first.
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem icon={<NotebookPen />} onSelect={() => onOpenScratchpad?.(questionPage(item.id))}>
                Open this question’s scratch page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </section>
  );
}

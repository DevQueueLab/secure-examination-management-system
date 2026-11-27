'use client';

import { QUESTION_TYPE_META, type QuestionType } from '@athena/shared';
import { Dices, GripVertical, PenLine } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { SkeletonText } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePreviewQuestion } from '../../api';
import { RichText } from '../../components/rich-text';
import { formatMarks } from '../../lib/format';
import { toInput, type Draft, type Json, type Option } from './draft';

/**
 * The question exactly as one candidate receives it, built by the API with the engine's own handler:
 * options shuffled, variables substituted, the answer key and explanation removed.
 */
export function CandidatePreviewDialog({ draft, open, onOpenChange }: { draft: Draft; open: boolean; onOpenChange: (v: boolean) => void }) {
  const preview = usePreviewQuestion();
  const run = () => {
    const input = toInput(draft);
    preview.mutate({ type: draft.type, content: input.content, key: input.key, shuffleOptions: true });
  };
  // Build a fresh variant each time the dialog opens.
  useEffect(() => {
    if (open) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fields = isApiError(preview.error) ? Object.values(preview.error.fields) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Candidate preview" description="One candidate’s variant. Each candidate gets their own shuffle and values." />
        <DialogBody>
          {preview.isPending ? (
            <SkeletonText lines={4} />
          ) : preview.isError ? (
            <div className="flex flex-col gap-2 rounded-xl bg-danger-tint px-4 py-3 text-callout text-danger-text">
              <p className="font-medium">The question isn’t complete enough to preview.</p>
              {fields.length ? (
                <ul className="list-disc pl-5">
                  {fields.slice(0, 6).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <p>{errorMessage(preview.error)}</p>
              )}
            </div>
          ) : preview.data ? (
            <div className="flex flex-col gap-4 rounded-xl bg-surface-sunken p-5">
              <div className="flex items-center justify-between text-footnote text-label-secondary">
                <span>{QUESTION_TYPE_META[draft.type].label}</span>
                <span className="tabular-nums">{formatMarks(draft.defaultMarks)} marks</span>
              </div>
              <CandidateView type={draft.type} view={preview.data.candidateView} />
              {preview.data.expectedAnswer !== undefined && (
                <p className="border-t border-separator pt-3 text-footnote text-label-secondary">
                  Expected answer for this variant: <span className="font-semibold tabular-nums text-label">{Number(preview.data.expectedAnswer.toPrecision(10))}</span>
                  {draft.content.unit ? ` ${draft.content.unit}` : ''} (only you see this)
                </p>
              )}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={run} loading={preview.isPending}>
            <Dices aria-hidden /> Another variant
          </Button>
          <Button variant="filled" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fake({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('rounded-lg bg-surface px-3 py-2 text-callout text-label-tertiary shadow-xs', className)}>{children}</div>;
}

/** Read-only rendering of a candidate view for each type. */
export function CandidateView({ type, view }: { type: QuestionType; view: Json }) {
  const options = (view.options ?? []) as Option[];
  return (
    <div className="flex flex-col gap-4">
      {type !== 'fill_blanks' && <RichText>{String(view.stem ?? '')}</RichText>}
      {type === 'fill_blanks' && (
        <>
          {view.stem && <RichText>{String(view.stem)}</RichText>}
          <p className="text-body leading-9 text-label">
            {String(view.template ?? '')
              .split(/(\[\[[A-Za-z0-9_-]{1,64}\]\])/g)
              .map((part, i) =>
                /^\[\[.+\]\]$/.test(part) ? <span key={i} className="mx-1 inline-block h-7 w-28 rounded-md bg-surface align-middle shadow-xs" /> : <span key={i}>{part}</span>,
              )}
          </p>
        </>
      )}
      {(type === 'single_choice' || type === 'multiple_choice') && (
        <ul className="flex flex-col gap-2">
          {options.map((o, i) => (
            <li key={o.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5 shadow-xs">
              <span
                className={cn(
                  'inline-flex size-5 shrink-0 items-center justify-center border border-separator-strong text-caption text-label-tertiary',
                  type === 'single_choice' ? 'rounded-full' : 'rounded',
                )}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <RichText inline className="text-callout">
                {o.text}
              </RichText>
            </li>
          ))}
        </ul>
      )}
      {type === 'true_false' && (
        <div className="grid grid-cols-2 gap-2">
          <Fake className="text-center text-label">True</Fake>
          <Fake className="text-center text-label">False</Fake>
        </div>
      )}
      {type === 'numeric' && <Fake className="w-56">Your answer{view.unit ? ` (${view.unit})` : ''}</Fake>}
      {type === 'short_text' && <Fake>Type your answer (up to {view.maxLength ?? 200} characters)</Fake>}
      {type === 'matching' && (
        <ul className="flex flex-col gap-2">
          {((view.prompts ?? []) as Option[]).map((p) => (
            <li key={p.id} className="grid grid-cols-2 items-center gap-3">
              <RichText inline className="text-callout">
                {p.text}
              </RichText>
              <Fake>Choose a match</Fake>
            </li>
          ))}
          <li className="flex flex-wrap gap-1.5 pt-1" aria-label="Answers to choose from">
            {((view.answers ?? []) as Option[]).map((a) => (
              <span key={a.id} className="rounded-md bg-surface px-2 py-1 shadow-xs">
                <RichText inline className="text-footnote">
                  {a.text}
                </RichText>
              </span>
            ))}
          </li>
        </ul>
      )}
      {type === 'ordering' && (
        <ul className="flex flex-col gap-2">
          {((view.items ?? []) as Option[]).map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 shadow-xs">
              <GripVertical aria-hidden className="size-4 text-label-tertiary" />
              <RichText inline className="text-callout">
                {it.text}
              </RichText>
            </li>
          ))}
        </ul>
      )}
      {type === 'long_text' && (
        <Fake className="h-28">
          Write your answer
          {view.minWords || view.maxWords ? ` (${[view.minWords && `at least ${view.minWords}`, view.maxWords && `at most ${view.maxWords}`].filter(Boolean).join(', ')} words)` : ''}
        </Fake>
      )}
      {type === 'code' && (
        <pre className="min-h-28 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-footnote text-label shadow-xs">{String(view.starterCode ?? '') || `// ${String(view.language ?? 'code')}`}</pre>
      )}
      {view.working?.enabled && (
        <div className="flex flex-col gap-1.5 border-t border-separator pt-3">
          <p className="flex items-center gap-1.5 text-footnote font-medium text-label">
            <PenLine aria-hidden className="size-3.5" /> Show your working ({formatMarks(view.working.marks)} marks)
          </p>
          {view.working.guidance && <p className="text-footnote text-label-secondary">{view.working.guidance}</p>}
          <Fake className="h-16">Working</Fake>
        </div>
      )}
    </div>
  );
}

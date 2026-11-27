'use client';

import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarksRule } from '@/components/ui/marks-rule';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd, Shortcut } from '@/components/ui/kbd';
import { cn } from '@/lib/cn';
import { fmtMarks, fmtSigned } from '../../analytics/format';
import { evaluatePart, itemsFor, type Draft, type PartDraft } from '../draft';
import type { Part, PartState, RubricItem } from '../types';

const PART_LABEL: Record<Part, string> = { answer: 'Answer', working: 'Working' };

export type ServerErrors = Partial<Record<Part | 'feedback', Record<string, string>>>;

interface PartEditorProps {
  part: Part;
  state: PartState;
  draft: PartDraft;
  items: RubricItem[];
  /** Keyboard number of the first item in this part (1-based). */
  keyOffset: number;
  errors?: Record<string, string>;
  onChange: (next: PartDraft) => void;
}

function PartEditor({ part, state, draft, items, keyOffset, errors, onChange }: PartEditorProps) {
  const outcome = evaluatePart(draft, items, state.max);
  const localError = outcome.error;
  const scoreError = errors?.score ?? (localError?.field === 'score' && draft.score.trim() ? localError.message : undefined);
  const adjustmentError = errors?.adjustment ?? (localError?.field === 'adjustment' ? localError.message : undefined);
  const rubricError = errors?.rubricItemIds ?? errors?.part;
  const toggle = (id: string) => onChange({ ...draft, ids: draft.ids.includes(id) ? draft.ids.filter((x) => x !== id) : [...draft.ids, id] });
  const step = (delta: number) => {
    const current = Number((draft.adjustment || '0').replace('−', '-')) || 0;
    const next = Math.round((current + delta) * 1000) / 1000;
    onChange({ ...draft, adjustment: next === 0 ? '' : String(next) });
  };
  const sum = draft.ids.reduce((s, id) => s + (items.find((i) => i.id === id)?.points ?? 0), 0);

  return (
    <section aria-labelledby={`part-${part}`} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`part-${part}`} className="text-headline text-label">
          {PART_LABEL[part]}
        </h3>
        <p className="text-subheadline text-label-secondary" aria-live="polite">
          <span className="text-title-3 tabular-nums text-label">{outcome.score === null ? '–' : fmtMarks(outcome.score)}</span>
          <span className="tabular-nums"> / {fmtMarks(state.max)}</span>
        </p>
      </div>

      {!draft.explicit && items.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={`${PART_LABEL[part]} rubric`}>
          {items.map((item, i) => {
            const on = draft.ids.includes(item.id);
            const key = keyOffset + i;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100',
                    'outline-none focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus',
                    on ? 'bg-accent-tint' : 'hover:bg-fill-secondary',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                      on ? 'border-accent bg-accent text-on-accent' : 'border-separator-strong bg-surface',
                    )}
                  >
                    {/* The tick draws its stroke when a criterion is chosen (stroke-dashoffset; instant under reduced motion). */}
                    <svg aria-hidden viewBox="0 0 12 12" className="size-3 overflow-visible">
                      <path
                        d="M2.25 6.4l2.4 2.35 5.1-5.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        strokeDasharray={1}
                        strokeDashoffset={on ? 0 : 1}
                        className="transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none reduced-motion:transition-none"
                      />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-callout font-medium text-label">{item.label}</span>
                    {item.description && <span className="mt-0.5 block text-footnote text-label-secondary">{item.description}</span>}
                  </span>
                  <span className={cn('shrink-0 text-callout font-semibold tabular-nums', item.points < 0 ? 'text-danger-text' : 'text-label')}>{fmtSigned(item.points)}</span>
                  {key <= 9 && (
                    <Kbd size="sm" className="mt-px shrink-0 max-lg:hidden">
                      {key}
                    </Kbd>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length === 0 && !draft.explicit && <p className="text-footnote text-label-secondary">No rubric items for this part yet.</p>}
      {rubricError && (
        <p role="alert" className="text-footnote font-medium text-danger-text">
          {rubricError}
        </p>
      )}

      {draft.explicit ? (
        <Field label="Score" error={scoreError} hint={items.length ? `Between 0 and ${fmtMarks(state.max)}. Ticked items are kept for the record.` : `Between 0 and ${fmtMarks(state.max)}. Add rubric items in the Rubrics tab to grade by criteria.`}>
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={draft.score}
            onChange={(e) => onChange({ ...draft, score: e.target.value })}
            trailing={<span className="pr-2 text-footnote tabular-nums text-label-tertiary">/ {fmtMarks(state.max)}</span>}
            aria-invalid={!!scoreError || undefined}
          />
        </Field>
      ) : (
        <Field label="Adjustment" error={adjustmentError}>
          <div className="flex items-center gap-1.5">
            <Button size="icon" variant="gray" aria-label="Lower by half a mark" onClick={() => step(-0.5)}>
              <Minus />
            </Button>
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              className="text-center tabular-nums"
              value={draft.adjustment}
              onChange={(e) => onChange({ ...draft, adjustment: e.target.value })}
              aria-invalid={!!adjustmentError || undefined}
            />
            <Button size="icon" variant="gray" aria-label="Raise by half a mark" onClick={() => step(0.5)}>
              <Plus />
            </Button>
          </div>
        </Field>
      )}
      {!draft.explicit && outcome.clamped && outcome.raw !== null && (
        <p className="text-footnote text-label-secondary">
          Rubric total {fmtMarks(sum)}
          {outcome.raw !== sum ? ` with adjustment ${fmtMarks(outcome.raw)}` : ''}; held to the 0–{fmtMarks(state.max)} range.
        </p>
      )}
      {items.length > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...draft, explicit: !draft.explicit, score: draft.explicit ? draft.score : outcome.score === null ? '' : String(outcome.score) })}
          className="self-start rounded-sm text-footnote font-medium text-accent-text outline-none hover:underline focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus"
        >
          {draft.explicit ? 'Build the score from the rubric' : 'Type a score instead'}
        </button>
      )}
    </section>
  );
}

export interface RubricPanelProps {
  parts: { answer: PartState; working: PartState | null };
  rubric: RubricItem[];
  draft: Draft;
  onChange: (next: Draft) => void;
  errors: ServerErrors;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  /** Group mode grades only the answer part. */
  groupSize?: number;
  /** Already graded: an unchanged draft just moves on. */
  graded?: boolean;
}

export function RubricPanel({ parts, rubric, draft, onChange, errors, saving, dirty, onSave, groupSize, graded = false }: RubricPanelProps) {
  const answerItems = itemsFor(rubric, 'answer');
  const workingItems = itemsFor(rubric, 'working');
  const total =
    (draft.answer ? evaluatePart(draft.answer, answerItems, parts.answer.max).score : parts.answer.score) ?? null;
  const workingScore = draft.working && parts.working ? evaluatePart(draft.working, workingItems, parts.working.max).score : null;
  const itemMax = parts.answer.max + (parts.working?.max ?? 0);
  const combined = total === null || (draft.working && workingScore === null) ? null : total + (workingScore ?? 0);
  const answerKeys = draft.answer && !draft.answer.explicit ? answerItems.length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
      {parts.answer.auto && (
        <div className="flex items-baseline justify-between rounded-lg bg-fill-secondary px-3 py-2.5">
          <span className="text-callout text-label">Answer, marked automatically</span>
          <span className="text-callout font-semibold tabular-nums text-label">
            {fmtMarks(parts.answer.score)} / {fmtMarks(parts.answer.max)}
          </span>
        </div>
      )}
      {draft.answer && (
        <PartEditor part="answer" state={parts.answer} draft={draft.answer} items={answerItems} keyOffset={1} errors={errors.answer} onChange={(answer) => onChange({ ...draft, answer })} />
      )}
      {draft.working && parts.working && (
        <PartEditor
          part="working"
          state={parts.working}
          draft={draft.working}
          items={workingItems}
          keyOffset={1 + answerKeys}
          errors={errors.working}
          onChange={(working) => onChange({ ...draft, working })}
        />
      )}
      {groupSize && parts.working && <p className="text-footnote text-label-secondary">Working differs between candidates, so it is graded one at a time.</p>}

      <Field label="Feedback" hint="The candidate sees this with their result." error={errors.feedback?.feedback}>
        <Textarea
          rows={3}
          className="min-h-20 text-callout"
          placeholder="What earned the marks, and what was missing"
          value={draft.feedback}
          onChange={(e) => onChange({ ...draft, feedback: e.target.value })}
        />
      </Field>

      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-t px-5 pb-4 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-subheadline font-medium text-label-secondary">{groupSize ? `Each of ${groupSize} answers` : 'Question total'}</span>
          <span className="text-footnote tabular-nums text-label-secondary">
            <span className="text-headline text-label">{combined === null ? '–' : fmtMarks(combined)}</span> / {fmtMarks(itemMax)}
          </span>
        </div>
        {/* The needle springs to each new total as criteria are ticked. */}
        <MarksRule
          settle={false}
          size="sm"
          marker="needle"
          labels="none"
          value={Math.max(0, Math.min(itemMax || 1, combined ?? 0))}
          max={itemMax || 1}
          label={groupSize ? 'Score for each answer on the marks rule' : 'Question total on the marks rule'}
          valueText={`${combined === null ? 'No score' : fmtMarks(combined)} of ${fmtMarks(itemMax)}`}
        />
        <Button variant="filled" size="lg" block loading={saving} onClick={onSave}>
          {groupSize ? `Grade ${groupSize} answers` : !dirty && graded ? 'Next answer' : 'Save and next'}
        </Button>
        <p className="flex items-center justify-center gap-x-2.5 whitespace-nowrap text-caption text-label-tertiary max-lg:hidden">
          <span className="inline-flex items-center gap-1">
            <Shortcut keys={['mod', '↵']} size="sm" /> save
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">1</Kbd>–<Kbd size="sm">9</Kbd> tick
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">J</Kbd>
            <Kbd size="sm">K</Kbd> move
          </span>
        </p>
      </div>
    </div>
  );
}

'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { fade, useReducedMotion } from '@/lib/motion';
import { fmtMarks } from '../analytics/format';
import type { Draft } from '../grading/draft';
import type { GradeableAnswer, RubricItem } from '../grading/types';
import { suggestionError, useAssistEnabled, useSuggestMarks, type SuggestedMarks } from './api';

interface SuggestMarksProps {
  answer: GradeableAnswer | null | undefined;
  rubric: RubricItem[];
  draft: Draft | null;
  onApply: (next: Draft) => void;
}

/** A short spring for the suggestion's arrival; a plain fade when motion is reduced. */
const arrive = { type: 'spring', bounce: 0.2, visualDuration: 0.28 } as const;

/**
 * "Suggest marks" for a written answer. The suggestion is never saved: "Use these marks" only fills the rubric
 * draft, and the grader saves exactly as before. Renders nothing unless the server has suggestions enabled.
 */
export function SuggestMarks({ answer, rubric, draft, onApply }: SuggestMarksProps) {
  const enabled = useAssistEnabled();
  const reduced = useReducedMotion();
  const suggest = useSuggestMarks();
  const [result, setResult] = useState<SuggestedMarks | null>(null);
  const [applied, setApplied] = useState(false);

  const written = !!answer && answer.answered && !answer.parts.answer.auto && (answer.response.format === 'text' || answer.response.format === 'code');
  if (!enabled || !answer || !draft?.answer || !written) return null;

  const run = () => {
    setApplied(false);
    suggest.mutate(answer.id, { onSuccess: (data) => setResult(data) });
  };

  const apply = () => {
    if (!result || !draft.answer) return;
    const known = new Set(rubric.filter((r) => r.target === 'answer').map((r) => r.id));
    const answerPart = result.criteria.length
      ? { ...draft.answer, ids: result.criteria.filter((c) => c.applies && known.has(c.rubricItemId)).map((c) => c.rubricItemId), adjustment: '', explicit: false, score: '' }
      : { ...draft.answer, explicit: true, score: String(result.score) };
    onApply({ ...draft, answer: answerPart });
    setApplied(true);
  };

  return (
    <section aria-label="Suggested marks" className="mt-8 border-t border-separator pt-5">
      {!result && (
        <div className="flex flex-wrap items-center gap-3">
          {suggest.isPending ? (
            <Button variant="tinted" size="sm" disabled aria-busy>
              <Spinner size={14} label={null} />
              Suggesting…
            </Button>
          ) : (
            <Button variant="tinted" size="sm" onClick={run}>
              Suggest marks
            </Button>
          )}
          {suggest.isError && (
            <p role="status" className="text-footnote text-label-secondary">
              {suggestionError(suggest.error)}
            </p>
          )}
        </div>
      )}

      {result && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduced ? fade : arrive}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-headline text-label">Suggested marks</h3>
            <span className="text-footnote tabular-nums text-label-secondary">
              <span className="text-headline text-label">{fmtMarks(result.score)}</span> / {fmtMarks(result.max)}
            </span>
          </div>
          <p className="text-caption text-label-tertiary">Suggested. Check before you use it.</p>

          {result.injectionSuspected && (
            <p role="alert" className="rounded-lg bg-warning-tint px-3 py-2 text-footnote text-warning-text">
              This answer contains instructions aimed at the grader. They were treated as part of the answer and not followed.
            </p>
          )}

          {result.criteria.length > 0 && (
            <ul className="flex flex-col divide-y divide-separator">
              {result.criteria.map((c) => (
                <li key={c.rubricItemId} className="flex gap-3 py-2.5">
                  <span className="w-14 shrink-0 text-callout font-semibold tabular-nums text-label">
                    {c.points < 0 ? (c.applies ? fmtMarks(c.points) : '0') : `${fmtMarks(c.marks)}/${fmtMarks(c.points)}`}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-callout text-label">{c.label}</span>
                    <span className="block text-footnote text-label-secondary">{c.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-footnote text-label-secondary">{result.note}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="tinted" size="sm" onClick={apply} disabled={applied}>
              Use these marks
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              Dismiss
            </Button>
            {applied && <span className="text-footnote text-label-secondary">Filled in on the rubric. Review it and save as usual.</span>}
          </div>
        </motion.div>
      )}
    </section>
  );
}

'use client';

import { useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { fade, useReducedMotion } from '@/lib/motion';
import { nextId, type Draft, type Option } from '../authoring/questions/editor/draft';
import { suggestionError, useAssistEnabled } from './api';

interface SuggestDistractorsProps {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  disabled?: boolean;
}

const arrive = { type: 'spring', bounce: 0.2, visualDuration: 0.28 } as const;

/**
 * "Suggest distractors" for a choice question. Three wrong options are appended as ordinary, editable option rows;
 * nothing is saved until the author saves the question. Renders nothing unless suggestions are enabled.
 */
export function SuggestDistractors({ draft, update, disabled }: SuggestDistractorsProps) {
  const enabled = useAssistEnabled();
  const reduced = useReducedMotion();
  const [added, setAdded] = useState(0);
  const suggest = useMutation({
    mutationFn: (body: { stem: string; options: string[]; correct: string[] }) => api.post<{ distractors: string[] }>('/assist/questions/distractors', body),
  });
  if (!enabled) return null;

  const options = (draft.content.options as Option[] | undefined) ?? [];
  const correctIds = Array.isArray(draft.key.correct) ? (draft.key.correct as string[]) : [String(draft.key.correct ?? '')];
  const correct = options.filter((o) => correctIds.includes(o.id)).map((o) => o.text.trim()).filter(Boolean);
  const stem = typeof draft.content.stem === 'string' ? draft.content.stem.trim() : '';
  const room = 12 - options.filter((o) => o.text.trim()).length;
  const ready = !!stem && correct.length > 0 && room >= 3;

  const run = () => {
    setAdded(0);
    suggest.mutate(
      { stem, options: options.map((o) => o.text).filter((t) => t.trim()), correct },
      {
        onSuccess: ({ distractors }) => {
          update((d) => {
            const current = (d.content.options as Option[]).filter((o) => o.text.trim() || correctIds.includes(o.id));
            const next = [...current];
            for (const text of distractors) next.push({ id: nextId('o', next), text });
            return { ...d, content: { ...d.content, options: next.slice(0, 12) } };
          });
          setAdded(distractors.length);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        {suggest.isPending ? (
          <Button type="button" variant="tinted" size="sm" disabled aria-busy>
            <Spinner size={14} label={null} />
            Suggesting…
          </Button>
        ) : (
          <Button type="button" variant="tinted" size="sm" onClick={run} disabled={disabled || !ready}>
            Suggest distractors
          </Button>
        )}
        {!ready && !suggest.isPending && <span className="text-footnote text-label-secondary">Write the question and mark the correct option first.</span>}
        {suggest.isError && <span role="status" className="text-footnote text-label-secondary">{suggestionError(suggest.error)}</span>}
      </div>
      {added > 0 && !suggest.isPending && (
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? fade : arrive}
          className="text-caption text-label-tertiary"
        >
          Added {added} wrong options as drafts. Suggested. Check before you use it.
        </motion.p>
      )}
    </div>
  );
}

'use client';

import { QUESTION_TYPE_META } from '@athena/shared';
import { Dices, PanelRight, X } from 'lucide-react';
import { motion } from 'motion/react';
import { memo, useDeferredValue, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api';
import { spring, useReducedMotion } from '@/lib/motion';
import { usePreviewQuestion } from '../../api';
import { formatMarks } from '../../lib/format';
import type { QuestionPreview } from '../../types';
import { CandidateView } from './candidate-preview';
import { toInput, type Draft } from './draft';

/**
 * Live preview: on wide screens, a panel docked beside the editor shows the candidate's view as the author types.
 * Each change is sent to the existing preview endpoint about 300 ms after typing stops. One seed is kept per
 * session so generated values hold still while typing, and the last good view stays up while a draft is incomplete.
 */
export function LivePreview({ draft }: { draft: Draft }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <Button variant={on ? 'tinted' : 'gray'} className="hidden xl:inline-flex" aria-pressed={on} onClick={() => setOn((v) => !v)}>
        <PanelRight aria-hidden /> Live preview
      </Button>
      {on && typeof document !== 'undefined' && createPortal(<Panel draft={draft} onClose={() => setOn(false)} />, document.body)}
    </>
  );
}

// The candidate view (math, code, options) re-renders only when a new preview arrives, never per keystroke.
const Candidate = memo(CandidateView);

function newSeed() {
  return Math.random().toString(36).slice(2, 10);
}

function Panel({ draft: typed, onClose }: { draft: Draft; onClose: () => void }) {
  // Typing stays urgent; the preview works from a deferred copy of the draft.
  const draft = useDeferredValue(typed);
  const preview = usePreviewQuestion();
  const reduced = useReducedMotion();
  const [seed, setSeed] = useState(newSeed);
  const [shown, setShown] = useState<{ view: QuestionPreview; n: number } | null>(null);
  const counter = useRef(0);

  const input = toInput(draft);
  const payload = JSON.stringify({ type: draft.type, content: input.content, key: input.key, seed });

  useEffect(() => {
    const timer = setTimeout(() => {
      const body = JSON.parse(payload) as { type: string; content: unknown; key: unknown; seed: string };
      preview.mutate(
        { ...body, shuffleOptions: false },
        {
          onSuccess: (view) => {
            counter.current += 1;
            setShown({ view, n: counter.current });
          },
        },
      );
    }, 300);
    return () => clearTimeout(timer);
    // `preview.mutate` is stable; the payload string carries every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const problems = preview.isError ? (isApiError(preview.error) && Object.keys(preview.error.fields).length ? Object.values(preview.error.fields) : [errorMessage(preview.error)]) : [];

  return (
    <motion.aside
      aria-label="Live preview"
      className="material fixed bottom-0 right-0 top-36 z-20 hidden w-[24rem] flex-col rounded-tl-2xl border-l border-t border-separator shadow-lg xl:flex"
      initial={reduced ? false : { x: 48, opacity: 0.3 }}
      animate={{ x: 0, opacity: 1 }}
      transition={spring.sheet}
    >
      <header className="flex items-center gap-2 border-b border-separator px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-headline text-label">Live preview</h2>
          <p className="truncate text-footnote text-label-secondary">What a candidate sees, updated as you type</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="New variant" onClick={() => setSeed(newSeed())}>
          <Dices aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close live preview" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-28 pt-4">
        {problems.length > 0 && (
          <div role="status" className="flex flex-col gap-1 rounded-xl bg-warning-tint px-3.5 py-2.5 text-footnote text-warning-text">
            <p className="font-medium">{shown ? 'Showing the last complete version.' : 'Not ready to preview yet.'}</p>
            <ul className="list-disc pl-4">
              {problems.slice(0, 4).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {shown ? (
          <motion.div
            key={shown.n}
            className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-xs"
            initial={reduced ? false : { opacity: 0.45 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="flex items-center justify-between text-footnote text-label-secondary">
              <span>{QUESTION_TYPE_META[draft.type].label}</span>
              <span className="tabular-nums">{formatMarks(draft.defaultMarks)} marks</span>
            </div>
            <Candidate type={draft.type} view={shown.view.candidateView} />
            {shown.view.expectedAnswer !== undefined && (
              <p className="border-t border-separator pt-3 text-footnote text-label-secondary">
                Expected answer: <span className="font-semibold tabular-nums text-label">{Number(shown.view.expectedAnswer.toPrecision(10))}</span>
                {draft.content.unit ? ` ${draft.content.unit}` : ''} (only you see this)
              </p>
            )}
          </motion.div>
        ) : (
          !problems.length && <p className="text-callout text-label-secondary">Building the first preview…</p>
        )}
      </div>
    </motion.aside>
  );
}

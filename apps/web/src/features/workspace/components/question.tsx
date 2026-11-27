'use client';

import { hasFingerprintTrace, QUESTION_TYPE_META, weaveFingerprint, type WorkingResponse } from '@athena/shared';
import { CircleAlert, Flag, MessageCircleQuestion } from 'lucide-react';
import { forwardRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { AnswerRenderer } from '../renderers';
import type { Response } from '../renderers/shared';
import type { TextEdit } from '../sync/engine';
import { useEngine, useEngineSelector } from '../lib/use-engine';
import styles from '../workspace.module.css';
import { Markdown } from './markdown';
import { Meta } from './meta';
import { WorkingSection } from './working';

function marksText(marks: number): string {
  return `${marks} ${marks === 1 ? 'mark' : 'marks'}`;
}

export interface QuestionViewProps {
  index: number;
  /** Digit shortcuts go to this question (paged layout, or the current one in scroll layout). */
  registerDigits?: (handler: ((digit: number) => void) | null) => void;
  onOpenScratchpad?: (pageKey: string) => void;
  onAsk?: (itemId: string) => void;
  /** Show the section heading above the question (first question of a section). */
  showSection?: boolean;
}

/** One question: where it sits, what it's worth, its text, the answer area and the working. */
export const QuestionView = forwardRef<HTMLHeadingElement, QuestionViewProps>(function QuestionView(
  { index, registerDigits, onOpenScratchpad, onAsk, showSection = false },
  headingRef,
) {
  const engine = useEngine();
  const item = useEngineSelector((s) => s.items[index]);
  const total = useEngineSelector((s) => s.items.length);
  const record = useEngineSelector((s) => (item ? s.answers[item.id] : undefined));
  const view = useEngineSelector((s) => s.view);
  const editable = useEngineSelector((s) => (item ? s.phase === 'ready' && !(s.view?.settings.navigation === 'linear' && index < s.max) : false));
  const clarifications = useEngineSelector((s) => s.clarifications);

  const onChange = useCallback(
    (response: Response, edit?: TextEdit) => {
      if (item) engine.setAnswer(item.id, { response }, edit);
    },
    [engine, item],
  );
  const onWorking = useCallback(
    (working: WorkingResponse | null, edit?: TextEdit) => {
      if (item) engine.setAnswer(item.id, { working }, edit);
    },
    [engine, item],
  );

  const fingerprint = view?.fingerprint ?? '';
  const watermark = view?.settings.integrity.watermark ?? false;
  const rawStem = typeof item?.content.stem === 'string' ? item.content.stem : '';
  // The server weaves the paper's fingerprint into each stem; weave here only if it hasn't.
  const stem = useMemo(
    () => (watermark && fingerprint && !hasFingerprintTrace(rawStem) ? weaveFingerprint(rawStem, fingerprint) : rawStem),
    [rawStem, watermark, fingerprint],
  );

  if (!item || !view) return null;
  const section = item.sectionId ? view.sections.find((s) => s.id === item.sectionId) : undefined;
  const idBase = `q${index + 1}`;
  const flagged = record?.flagged ?? false;
  const rejected = record?.rejected && record.rejected.revision === record.revision ? record.rejected : null;
  const answered = clarifications.filter((c) => c.itemId === item.id && c.answer);

  return (
    <article aria-labelledby={`${idBase}-title`} data-item-id={item.id} className="flex flex-col gap-6">
      {showSection && section && (
        <header className="flex flex-col gap-1.5 border-b pb-5">
          <h2 className="text-title-3 text-label">{section.title}</h2>
          {section.instructions && <Markdown className="text-callout text-label-secondary">{section.instructions}</Markdown>}
        </header>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`${idBase}-title`} ref={headingRef} tabIndex={-1} className="text-title-2 text-label outline-none" data-numeric>
            Question {index + 1} of {total}
          </h2>
          <p className="mt-1 text-subheadline text-label-secondary" data-numeric>
            <Meta
              items={[
                section?.title && !showSection ? section.title : null,
                item.workingMarks > 0 ? `${marksText(item.marks)}, plus ${item.workingMarks} for working` : marksText(item.marks),
                QUESTION_TYPE_META[item.type]?.label,
              ]}
            />
          </p>
        </div>
        <Button
          variant={flagged ? 'tinted' : 'ghost'}
          size="md"
          onClick={() => engine.toggleFlag(item.id)}
          disabled={!editable}
          aria-pressed={flagged}
          aria-keyshortcuts="F"
          className={cn('shrink-0 max-md:h-11', flagged && 'bg-warning-tint text-warning-text hover:bg-warning-tint')}
        >
          <Flag aria-hidden fill={flagged ? 'currentColor' : 'none'} />
          {flagged ? 'Flagged' : 'Flag'}
        </Button>
      </div>

      <div className={styles.reading}>
        <Markdown>{stem}</Markdown>
      </div>

      {answered.length > 0 && (
        <aside aria-label="Clarifications for this question" className="flex flex-col gap-2 rounded-xl bg-info-tint px-4 py-3">
          {answered.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 text-callout">
              <MessageCircleQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-info-text" />
              <p>
                <span className="font-semibold text-info-text">{c.mine ? 'Your proctor answered: ' : 'Clarification: '}</span>
                <span className="text-label">{c.answer}</span>
              </p>
            </div>
          ))}
        </aside>
      )}

      <AnswerRenderer item={item} response={record?.response ?? null} disabled={!editable} idBase={idBase} onChange={onChange} registerDigits={registerDigits} />

      {rejected && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2.5 text-callout text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            This answer couldn’t be saved: {rejected.message} Change it to try again; the rest of your work is saving normally.
          </span>
        </p>
      )}

      <WorkingSection item={item} record={record} disabled={!editable} idBase={idBase} onChange={onWorking} onOpenScratchpad={onOpenScratchpad} />

      {onAsk && editable && (
        <div>
          <Button variant="plain" size="sm" onClick={() => onAsk(item.id)} className="-ml-2.5 max-md:h-11">
            <MessageCircleQuestion aria-hidden />
            Ask the proctor about this question
          </Button>
        </div>
      )}
    </article>
  );
});

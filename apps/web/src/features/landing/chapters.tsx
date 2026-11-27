import type { ReactNode } from 'react';
import ch from './chapters.module.css';

/**
 * One stop on the exam's tape: a display line, one sentence and the product doing that one thing. Text and
 * product trade sides from stop to stop, so the tape (tape.tsx) winds down the page beneath the product. The
 * element marked `data-tape-stop` is the point the tape passes through. Only the first stop holds the slot
 * where the marble Athena comes to rest.
 */
export function Chapter({
  id,
  title,
  line,
  side,
  slot = false,
  children,
}: {
  id: string;
  title: string;
  line: string;
  side: 'left' | 'right';
  slot?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={ch.chapter} data-chapter data-side={side} data-slot={slot || undefined} aria-labelledby={`${id}-title`}>
      <div className={ch.grid}>
        <div className={ch.text} data-chapter-text>
          <h2 id={`${id}-title`} className={ch.title}>
            {title}
          </h2>
          <p className={ch.line}>{line}</p>
        </div>
        {slot && <div className={ch.slot} data-protagonist-slot aria-hidden="true" data-tape-stop />}
        <div className={ch.product} data-chapter-product data-tape-stop={slot ? undefined : ''}>
          {children}
        </div>
      </div>
    </section>
  );
}

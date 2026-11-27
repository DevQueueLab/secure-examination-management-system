/*
 * The hero's tamper-evident exam-paper tape: the carmine band that seals question papers, with its warning
 * printed along it. Drawn in the bust frame's own coordinates (800 by 1000, the bust's 4:5), overflowing the
 * frame so a band can run off the edge of the screen.
 *
 * The print is one short text per repeat rather than one long run: a single text along a diagonal band has a
 * bounding box nearly the size of the screen, and would be counted as the page's largest paint instead of the
 * bust. hero-tape-motion.tsx measures one repeat once and spaces them to meet exactly.
 */
const PHRASE = 'SEALED EXAM PAPER   DO NOT OPEN BEFORE THE EXAM   ';
/** A first guess at one repeat's length in frame units, corrected in the browser once the font is measured. */
const REPEAT = 680;
const COUNT = 5;

export function HeroTape({ id, d, className, bandClassName, edgeClassName, textClassName, scene }: {
  id: string;
  d: string;
  className?: string;
  bandClassName?: string;
  edgeClassName?: string;
  textClassName?: string;
  scene: string;
}) {
  return (
    <svg className={className} viewBox="0 0 800 1000" aria-hidden="true" focusable="false" data-scene={scene}>
      <path d={d} className={edgeClassName} data-tape-band />
      <path id={id} d={d} className={bandClassName} data-tape-band />
      <g data-tape-print>
        {Array.from({ length: COUNT }, (_, i) => (
          <text key={i} className={textClassName} dy="0.36em">
            <textPath href={`#${id}`} startOffset={i * REPEAT} data-tape-text>
              {PHRASE}
            </textPath>
          </text>
        ))}
      </g>
    </svg>
  );
}

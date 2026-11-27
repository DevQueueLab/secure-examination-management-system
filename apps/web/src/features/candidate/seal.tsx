import { cn } from '@/lib/cn';

/*
 * The gold seal: Athena's certification mark. A coin-edged rosette with a check at its centre; the large
 * variant adds a ring of ticks, the Marks rule bent into a circle. Colour comes from `currentColor`, so set
 * it with a gold text token. Pure geometry, no glow.
 */

const point = (i: number, n: number, r: number) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  // Rounded, so the server and the browser print identical numbers and hydration matches.
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [round(12 + r * Math.cos(a)), round(12 + r * Math.sin(a))] as const;
};

const ROSETTE = Array.from({ length: 48 }, (_, i) => point(i, 48, i % 2 === 0 ? 11.6 : 10.7))
  .map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`)
  .join(' ');

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const [x1, y1] = point(i, 60, major ? 7.55 : 8.05);
  const [x2, y2] = point(i, 60, 8.75);
  return { x1, y1, x2, y2, major };
});

export function Seal({ variant = 'mark', className, title }: { variant?: 'mark' | 'seal'; className?: string; title?: string }) {
  const large = variant === 'seal';
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <polygon points={ROSETTE} fill="currentColor" fillOpacity={large ? 0.1 : 0.16} stroke="currentColor" strokeWidth={large ? 0.32 : 1.3} strokeLinejoin="round" />
      {large && (
        <>
          <circle cx="12" cy="12" r="9.45" fill="none" stroke="currentColor" strokeWidth={0.18} />
          {TICKS.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="currentColor" strokeWidth={t.major ? 0.26 : 0.14} />
          ))}
          <circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" strokeWidth={0.22} />
        </>
      )}
      <path
        d={large ? 'M9.15 12.15l1.95 1.95 3.85-4.15' : 'M8.1 12.2l2.6 2.6 5.1-5.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth={large ? 0.75 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

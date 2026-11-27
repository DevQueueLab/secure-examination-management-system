import { cn } from '@/lib/cn';

const RING = Array.from({ length: 60 }, (_, i) => i);

/**
 * A ruled seal: the Marks rule bent into a ring (a graduation every 6 degrees, a long one every 30).
 * Gold certifies (a pass, a signed report); graphite marks a state that certifies nothing.
 */
export function Seal({ tone, glyph = 'check', size = 64, className }: { tone: 'gold' | 'graphite'; glyph?: 'check' | 'none'; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn('shrink-0', tone === 'gold' ? 'text-gold' : 'text-label-tertiary', className)}
    >
      <circle cx="32" cy="32" r="22.5" className={tone === 'gold' ? 'fill-gold-tint' : 'fill-fill'} />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="currentColor" strokeWidth="1" />
      {RING.map((i) => {
        const long = i % 5 === 0;
        const a = (i * 6 * Math.PI) / 180;
        const r1 = long ? 25 : 27.25;
        const r2 = 30.5;
        return (
          <line
            key={i}
            x1={32 + r1 * Math.sin(a)}
            y1={32 - r1 * Math.cos(a)}
            x2={32 + r2 * Math.sin(a)}
            y2={32 - r2 * Math.cos(a)}
            stroke="currentColor"
            strokeWidth={long ? 1.25 : 0.75}
            strokeLinecap="round"
          />
        );
      })}
      {glyph === 'check' && <path d="M23.5 32.5l5.75 5.75L41 26.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
      {glyph === 'none' && <path d="M25 32h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

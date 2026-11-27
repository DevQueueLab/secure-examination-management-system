import { cn } from '@/lib/cn';

export type TwinName = 'owl' | 'helmet' | 'athena' | 'amphora' | 'shield' | 'laurel';

/**
 * The twin art from public/brand: marble on light grounds, glass on dark ones.
 * The theme tokens `--art-marble` and `--art-glass` pick the twin, and `--art-blend` keys out the ground
 * the photograph was shot on (multiply drops the marble's white, screen drops the glass's black).
 * Lazy images that stay hidden are never fetched, so each theme downloads one file.
 */
export function TwinArt({
  name,
  size = 180,
  className,
}: {
  name: TwinName;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('relative block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative twin, sized by the parent */}
      <img
        src={`/brand/${name}-marble-960.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 size-full object-contain [display:var(--art-marble,block)] [mix-blend-mode:var(--art-blend,normal)]"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative twin, sized by the parent */}
      <img
        src={`/brand/${name}-glass-960.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 size-full object-contain [display:var(--art-glass,none)] [mix-blend-mode:var(--art-blend,normal)]"
      />
    </span>
  );
}

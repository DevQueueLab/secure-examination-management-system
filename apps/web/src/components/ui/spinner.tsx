import { cn } from '@/lib/cn';

const SPOKES = 8;

export interface SpinnerProps {
  /** Pixel size. Default 16. */
  size?: number;
  className?: string;
  /** Announced to screen readers. Pass null when a parent already announces the busy state. */
  label?: string | null;
}

/** Apple-style activity indicator: fading spokes that step around. Inherits currentColor. */
export function Spinner({ size = 16, className, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="animate-[spin_0.8s_steps(8)_infinite]">
        {Array.from({ length: SPOKES }, (_, i) => (
          <rect
            key={i}
            x="11"
            y="1.5"
            width="2"
            height="6.5"
            rx="1"
            fill="currentColor"
            opacity={0.18 + (0.82 * (SPOKES - i)) / SPOKES}
            transform={`rotate(${(360 / SPOKES) * -i} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}

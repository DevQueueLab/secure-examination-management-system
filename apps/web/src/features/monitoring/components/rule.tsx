import { MarksRule } from '@/components/ui/marks-rule';
import { cn } from '@/lib/cn';

/**
 * One tick per question: answered ones stand full height in carmine, the rest stay short in graphite, so a column of
 * rows reads as a single picture of the room. Long papers fall back to the Marks rule.
 */
export function CountRule({
  count,
  total,
  label,
  muted = false,
  className,
}: {
  count: number;
  total: number;
  label: string;
  /** Finished attempts recede to graphite. */
  muted?: boolean;
  className?: string;
}) {
  if (total <= 0) return null;
  const done = Math.min(count, total);
  if (total > 40) {
    return <MarksRule size="sm" marker="both" value={done} max={total} label={label} valueText={`${done} of ${total}`} tone={muted ? 'neutral' : 'accent'} className={className} />;
  }
  const slot = 100 / total;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
      className={cn('relative h-3.5', className)}
    >
      <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <line x1={0} x2={100} y1={13.5} y2={13.5} vectorEffect="non-scaling-stroke" className="stroke-label-tertiary" />
        {Array.from({ length: total }, (_, i) => {
          const x = slot * (i + 0.5);
          const on = i < done;
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={on ? 0 : 8}
              y2={14}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className={on ? (muted ? 'stroke-label-secondary' : 'stroke-accent') : 'stroke-label-tertiary'}
            />
          );
        })}
      </svg>
    </div>
  );
}

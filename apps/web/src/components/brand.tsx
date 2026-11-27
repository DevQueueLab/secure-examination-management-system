import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * The Athena mark: an A whose crossbar is a sealed point, on an accent tile.
 * `tile={false}` draws the glyph alone in currentColor.
 */
export function AthenaMark({ size = 28, tile = true, className }: { size?: number; tile?: boolean; className?: string }) {
  // Unique per instance: a hidden copy elsewhere on the page must not own the gradient.
  const gradientId = `athena-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
      {tile && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1585F2" />
              <stop offset="1" stopColor="#0064D2" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
        </>
      )}
      <path
        d="M9.25 23.25 16 8.75l6.75 14.5"
        fill="none"
        stroke={tile ? '#fff' : 'currentColor'}
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="18.6" r="1.9" fill={tile ? '#fff' : 'currentColor'} />
    </svg>
  );
}

/** Mark plus the name, for headers and the sign-in panel. */
export function AthenaWordmark({ size = 28, className, label = true }: { size?: number; className?: string; label?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <AthenaMark size={size} />
      {label && (
        <span className="font-semibold tracking-[-0.02em] text-label" style={{ fontSize: Math.round(size * 0.68) }}>
          Athena
        </span>
      )}
    </span>
  );
}

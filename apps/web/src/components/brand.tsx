import { cn } from '@/lib/cn';

/**
 * The Athena mark: an A whose crossbar is a sealed point, on a carmine tile.
 * `tile={false}` draws the glyph alone in currentColor.
 */
export function AthenaMark({ size = 28, tile = true, className }: { size?: number; tile?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
      {tile && <rect width="32" height="32" rx="8" fill="#9c1220" />}
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
        <span className="font-display leading-none text-label" style={{ fontSize: Math.round(size * 0.9) }}>
          Athena
        </span>
      )}
    </span>
  );
}

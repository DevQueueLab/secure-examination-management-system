import { AvatarPhoto } from '@/features/profile/avatar-photo';
import { cn } from '@/lib/cn';

const HONORIFIC = /^(dr|prof|mr|mrs|ms|mx|engr|sir)\.?$/i;

/** Name parts without leading titles such as "Dr." or "Prof.". */
export function nameParts(name: string | null | undefined): string[] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && HONORIFIC.test(parts[0] ?? '')) parts.shift();
  return parts;
}

/** Given name for greetings: "Dr. Sara Ahmed" -> "Sara". */
export function givenName(name: string | null | undefined): string {
  return nameParts(name)[0] ?? '';
}

export function initialsOf(name: string | null | undefined): string {
  const parts = nameParts(name);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const sizes = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-7 text-caption',
  md: 'size-8 text-footnote',
  lg: 'size-10 text-callout',
  xl: 'size-14 text-title-3',
} as const;

export interface AvatarProps {
  name: string | null | undefined;
  size?: keyof typeof sizes;
  className?: string;
  /** Hide from assistive tech when the name is already next to it. Default true. */
  decorative?: boolean;
  /** Shows this person's profile photo over the initials, when they have one. */
  userId?: string | null;
}

/** Monogram in the style of Contacts: initials on a neutral graphite gradient, under the photo when there is one. */
export function Avatar({ name, size = 'md', className, decorative = true, userId }: AvatarProps) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (name ?? 'Unknown')}
      aria-hidden={decorative || undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-[0.01em] text-white',
        'bg-[linear-gradient(180deg,#8f9298_0%,#65686e_100%)]',
        sizes[size],
        className,
      )}
    >
      {initialsOf(name)}
      {userId ? <AvatarPhoto userId={userId} /> : null}
    </span>
  );
}

import type { ExamPhase } from '@athena/shared';
import { EXAM_PHASE_LABEL } from '@athena/shared';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-fill text-label-secondary',
        accent: 'bg-accent-tint text-accent-text',
        success: 'bg-success-tint text-success-text',
        warning: 'bg-warning-tint text-warning-text',
        danger: 'bg-danger-tint text-danger-text',
        info: 'bg-info-tint text-info-text',
      },
      size: {
        sm: 'h-5 px-2 text-caption',
        md: 'h-6 px-2.5 text-footnote',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

const dotColor: Record<Tone, string> = {
  neutral: 'bg-label-tertiary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  /** Leading status dot. `pulse` animates it for live states. */
  dot?: boolean | 'pulse';
}

/** Status pill. Pair tone with words: colour is never the only signal. */
export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <StatusDot tone={tone ?? 'neutral'} pulse={dot === 'pulse'} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-1.5 shrink-0', className)}>
      {pulse && (
        <span className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', dotColor[tone])} />
      )}
      <span className={cn('relative inline-flex size-1.5 rounded-full', dotColor[tone])} />
    </span>
  );
}

/** One mapping for exam lifecycle colours, used on every screen. */
export const EXAM_PHASE_TONE: Record<ExamPhase, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  ongoing: 'success',
  completed: 'accent',
  archived: 'neutral',
};

export function PhaseBadge({ phase, size, className }: { phase: ExamPhase; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Badge tone={EXAM_PHASE_TONE[phase]} size={size} dot={phase === 'ongoing' ? 'pulse' : true} className={className}>
      {EXAM_PHASE_LABEL[phase]}
    </Badge>
  );
}

import type { ExamPhase } from '@athena/shared';
import { EXAM_PHASE_LABEL } from '@athena/shared';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
/** Badge tones: every Tone plus gold (certified: published, verified, passed) and wine. */
export type BadgeTone = Tone | 'gold' | 'wine';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none tracking-[0.005em] [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-fill text-label-secondary',
        accent: 'bg-accent-tint text-accent-text',
        success: 'bg-success-tint text-success-text',
        warning: 'bg-warning-tint text-warning-text',
        danger: 'bg-danger-tint text-danger-text',
        /** Ink, never blue: neutral facts that still deserve a mark (scheduled, roles). */
        info: 'bg-info-tint text-info-text',
        gold: 'bg-gold-tint text-gold-text',
        wine: 'bg-wine-tint text-wine-text',
      },
      size: {
        sm: 'h-5 px-2 text-caption',
        md: 'h-6 px-2.5 text-footnote',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

const dotColor: Record<BadgeTone, string> = {
  neutral: 'bg-label-tertiary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  gold: 'bg-gold',
  wine: 'bg-wine',
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

/** A static state dot. Always paired with a text label; `pulse` is accepted for compatibility and renders still. */
export function StatusDot({ tone = 'neutral', className }: { tone?: BadgeTone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cn('inline-flex size-1.5 shrink-0 rounded-full', dotColor[tone], className)} />;
}

/**
 * One mapping for exam lifecycle colours, used on every screen. Live is carmine (the exam that has the
 * floor); scheduled is ink; completed is green; drafts and archives stay grey. No blue, no pulsing dots.
 */
export const EXAM_PHASE_TONE: Record<ExamPhase, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  ongoing: 'accent',
  completed: 'success',
  archived: 'neutral',
};

export function PhaseBadge({ phase, size, className }: { phase: ExamPhase; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Badge tone={EXAM_PHASE_TONE[phase]} size={size} className={className}>
      {EXAM_PHASE_LABEL[phase]}
    </Badge>
  );
}

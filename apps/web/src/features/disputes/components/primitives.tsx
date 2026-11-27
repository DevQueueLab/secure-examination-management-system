'use client';

import { Check, Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { MarksRule } from '@/components/ui/marks-rule';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { OUTCOME_TONE, STATUS_TONE, fmtDateTime, fmtMarks, fmtSpan, slaState } from '../format';
import type { DisputeOutcome, DisputeStatus, Step } from '../types';

/** Re-renders on an interval so countdowns stay true without a reload. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** A status change lands physically: the new badge springs in (enter-only) and slides into place if its row reflows. */
export function StatusBadge({ status, label, size = 'md' }: { status: DisputeStatus; label: string; size?: 'sm' | 'md' }) {
  const reduced = useReducedMotion();
  return (
    <motion.span key={status} layout={!reduced} initial={reduced ? false : { scale: 0.86, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy} className="inline-flex">
      <Badge tone={STATUS_TONE[status]} size={size}>
        {label}
      </Badge>
    </motion.span>
  );
}

/** The decision's outcome seals with a short overshoot when it first appears. */
export function OutcomeBadge({ outcome, label, size = 'md' }: { outcome: DisputeOutcome; label: string; size?: 'sm' | 'md' }) {
  const reduced = useReducedMotion();
  return (
    <motion.span key={outcome} initial={reduced ? false : { scale: 0.7, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.12 }} className="inline-flex">
      <Badge tone={OUTCOME_TONE[outcome]} size={size}>
        {outcome !== 'rejected' && <Check aria-hidden />}
        {label}
      </Badge>
    </motion.span>
  );
}

/**
 * The score on the Marks rule, with the needle travelling from the previous score to the current one once on
 * mount. Under reduced motion it renders at the current score.
 */
export function ScoreNeedle({ from, to, max, label = 'Score', className }: { from: number; to: number; max: number; label?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? to : from);
  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setValue(to)));
    return () => cancelAnimationFrame(raf);
  }, [reduced, to]);
  return <MarksRule value={value} max={max} label={label} valueText={`${fmtMarks(to)} of ${fmtMarks(max)}`} size="md" labels="ends" format={(n) => fmtMarks(n)} settle={false} className={className} />;
}

/** Time left to respond. Under a day reads as a warning, past due as an error. Nothing once decided. */
export function SlaBadge({ status, dueAt, size = 'md', className }: { status: DisputeStatus; dueAt: string | null; size?: 'sm' | 'md'; className?: string }) {
  const now = useNow();
  const sla = slaState(status, dueAt, now);
  if (sla.kind === 'done') return null;
  const overdue = sla.kind === 'overdue';
  const tone = overdue ? 'danger' : sla.soon ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} size={size} className={cn('tabular-nums', className)} title={dueAt ? `Response due ${fmtDateTime(dueAt)}` : undefined}>
      <Clock aria-hidden />
      {overdue ? `Overdue by ${fmtSpan(sla.ms)}` : `Due in ${fmtSpan(sla.ms)}`}
    </Badge>
  );
}

/** Inline SLA text for dense rows. */
export function SlaText({ status, dueAt }: { status: DisputeStatus; dueAt: string | null }) {
  const now = useNow();
  const sla = slaState(status, dueAt, now);
  if (sla.kind === 'done') return <span className="text-label-tertiary">–</span>;
  if (sla.kind === 'overdue') return <span className="font-medium text-danger-text">{fmtSpan(sla.ms)} over</span>;
  return <span className={cn(sla.soon ? 'font-medium text-warning-text' : 'text-label-secondary')}>{fmtSpan(sla.ms)} left</span>;
}

/** Submitted, under review, resolved: each step with when it happened. The steps pop in and the line draws on mount. */
export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <ol className={cn('grid grid-cols-3 gap-2', className)} aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex flex-col gap-2" aria-current={s.state === 'current' ? 'step' : undefined}>
          <div className="flex items-center gap-2">
            <motion.span
              initial={reduced ? false : { scale: 0.55, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...spring.bouncy, delay: i * 0.12 }}
              className={cn(
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold',
                s.state === 'done' && 'bg-success text-white',
                s.state === 'current' && 'bg-accent-tint text-accent-text ring-2 ring-accent',
                s.state === 'upcoming' && 'bg-fill text-label-tertiary',
              )}
            >
              {s.state === 'done' ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
            </motion.span>
            {i < steps.length - 1 && (
              <span aria-hidden className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-fill-strong">
                {steps[i + 1]!.state !== 'upcoming' && (
                  <motion.span
                    className="absolute inset-0 origin-left rounded-full bg-success"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ ...spring.smooth, delay: 0.08 + i * 0.14 }}
                  />
                )}
              </span>
            )}
          </div>
          <div className="min-w-0 pr-2">
            <p className={cn('text-subheadline font-semibold', s.state === 'upcoming' ? 'text-label-tertiary' : 'text-label')}>{s.label}</p>
            <p className="text-footnote tabular-nums text-label-secondary">{s.at ? fmtDateTime(s.at) : s.state === 'current' ? 'In progress' : s.state === 'done' ? 'Done' : 'Not yet'}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * "20 of 23, up from 19": the value now, then where it came from in words, so direction never rests on colour
 * alone. Gains read green and losses red.
 */
export function ScoreChange({
  before,
  after,
  max,
  size = 'md',
  format = fmtMarks,
  showUnchanged = false,
  className,
}: {
  before: number | null;
  after: number | null;
  max?: number | null;
  size?: 'sm' | 'md' | 'lg';
  format?: (n: number | null) => string;
  showUnchanged?: boolean;
  className?: string;
}) {
  const delta = before !== null && after !== null ? Math.round((after - before) * 1000) / 1000 : null;
  const tone = !delta ? 'text-label' : delta > 0 ? 'text-success-text' : 'text-danger-text';
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums', size === 'lg' ? 'text-title-2' : size === 'md' ? 'text-headline' : 'text-callout', className)}>
      <span className={cn('font-semibold', tone)}>{format(after)}</span>
      {max !== undefined && max !== null && <span className="font-normal text-label-secondary">of {format(max)}</span>}
      {delta !== null && delta !== 0 && (
        <span className="text-footnote font-normal text-label-secondary">
          {delta > 0 ? 'up' : 'down'} from {format(before)}
        </span>
      )}
      {delta === 0 && showUnchanged && <span className="text-footnote font-normal text-label-tertiary">unchanged</span>}
    </span>
  );
}

export function Hash({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  return <code className={cn('rounded bg-fill px-1 py-px font-mono text-[0.8125rem] text-label-secondary', className)}>{value.slice(0, 12)}</code>;
}

/** Green when the seal or chain checks out, red when it doesn't. Never shown as a bare glyph. */
export function IntegrityBadge({ ok, okLabel, badLabel, size = 'md' }: { ok: boolean; okLabel: string; badLabel: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={ok ? 'success' : 'danger'} size={size}>
      {ok ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
      {ok ? okLabel : badLabel}
    </Badge>
  );
}

/** A tinted note inside a page: warnings, conflicts, pointers. No side stripe. */
export function Banner({ tone, icon, title, children, action, className }: { tone: 'warning' | 'info' | 'danger' | 'success' | 'neutral'; icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const tint = {
    warning: 'bg-warning-tint text-warning-text',
    info: 'bg-info-tint text-info-text',
    danger: 'bg-danger-tint text-danger-text',
    success: 'bg-success-tint text-success-text',
    neutral: 'bg-fill text-label-secondary',
  }[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex flex-col gap-3 rounded-xl px-4 py-3.5 sm:flex-row sm:items-center', tint, className)}>
      <div className="flex min-w-0 flex-1 gap-3">
        {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-[18px]">{icon}</span>}
        <div className="min-w-0">
          <p className="text-callout font-semibold">{title}</p>
          {children && <div className="mt-0.5 text-subheadline text-label">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 max-sm:pl-[30px]">{action}</div>}
    </div>
  );
}

/** Label and value rows for small facts. */
export function Facts({ rows, className }: { rows: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-subheadline', className)}>
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-label-secondary">{r.label}</dt>
          <dd className="min-w-0 text-right tabular-nums text-label">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

'use client';

import type { CandidateExamCard } from '@athena/shared';
import { MarksRule } from '@/components/ui/marks-rule';
import { formatCountdown, formatMinutes, formatWhen } from './format';

/** A duration as light numerals with small units: "1 h", "1 h 30 min", "45 min". */
export function Duration({ minutes }: { minutes: number }) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const unit = (text: string) => <span className="ml-[0.08em] mr-[0.28em] text-[0.42em] font-normal tracking-normal text-label-secondary last:mr-0">{text}</span>;
  return (
    <>
      <span className="sr-only">{formatMinutes(total)}</span>
      <span aria-hidden>
        {h > 0 && (
          <>
            {h}
            {unit('h')}
          </>
        )}
        {(m > 0 || h === 0) && (
          <>
            {m}
            {unit('min')}
          </>
        )}
      </span>
    </>
  );
}

/**
 * The window, or once an attempt is running its own clock, on the Marks rule: the needle stands at now and
 * the stretch already gone is drawn faint, so what is left reads at a glance and shrinks toward the close.
 */
export function TimeRule({ card, now, compact = false }: { card: CandidateExamCard; now: number; compact?: boolean }) {
  const attempt = card.attempt;
  const running = !!attempt && (attempt.status === 'in_progress' || attempt.status === 'awaiting_sync');
  const from = Date.parse(running ? attempt.startedAt : card.windowOpensAt);
  const to = Date.parse(running ? attempt.deadlineAt : card.windowClosesAt);
  const left = Math.max(0, to - now);
  const value = Math.min(to, Math.max(from, now));
  const f = to > from ? (value - from) / (to - from) : 1;
  // Days, not just clock times: a take-home can start and end at the same time of day.
  const closes = running ? formatWhen(attempt.deadlineAt, now) : formatWhen(card.windowClosesAt, now);
  const label = running ? 'Time left on your attempt' : 'The window closes in';
  // Past the needle the ticks keep full strength; behind it they fade to a third.
  const fade = `calc(${(f * 100).toFixed(3)}% - 6px)`;
  const mask = `linear-gradient(90deg, rgb(0 0 0 / 0.32) ${fade}, #000 ${fade})`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-subheadline text-label-secondary">{label}</p>
        <p className={compact ? 'numeral text-[1.625rem] leading-none text-label' : 'numeral text-[1.625rem] leading-none text-label sm:text-[1.875rem]'}>{left > 0 ? formatCountdown(left) : 'Closed'}</p>
      </div>
      <div style={{ maskImage: mask, WebkitMaskImage: mask }}>
        <MarksRule
          value={value}
          min={from}
          max={to}
          label={running ? 'Time left on your attempt' : 'Exam window'}
          valueText={left > 0 ? `${formatCountdown(left)} left. ${running ? 'Your attempt ends' : 'The window closes'} ${closes}.` : 'Closed'}
        />
      </div>
      <div className="flex justify-between gap-6 text-footnote text-label-secondary">
        <span className={compact ? 'hidden' : 'max-sm:hidden'}>{running ? `Started ${formatWhen(attempt.startedAt, now)}` : `Opened ${formatWhen(card.windowOpensAt, now)}`}</span>
        <span className={compact ? 'ml-auto text-right' : 'text-right max-sm:ml-auto'}>{running ? `Ends ${formatWhen(attempt.deadlineAt, now)}` : `Closes ${formatWhen(card.windowClosesAt, now)}`}</span>
      </div>
    </div>
  );
}


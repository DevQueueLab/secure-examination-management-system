'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { RadioGroup, Radio } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useExtendAll } from '../api';
import { useServerNow } from '../clock';
import { clockTime, plural } from '../format';
import type { LiveAttempt, OutageSuggestion } from '../types';
import { isLive } from './live-bits';

function outageReason(s: OutageSuggestion): string {
  return `Connection outage at ${clockTime(s.windowStart)} affecting ${plural(s.affected, 'candidate')}`;
}

/**
 * Correlated-outage suggestion: several candidates dropped in the same two minutes, which points at the venue or
 * network rather than at anyone's conduct. One click gives exactly those candidates their time back.
 */
export function OutageBanner({
  examId,
  suggestion,
  attempts,
  canIntervene,
  onAdjust,
  onDismiss,
}: {
  examId: string;
  suggestion: OutageSuggestion;
  attempts: LiveAttempt[];
  canIntervene: boolean;
  onAdjust: () => void;
  onDismiss: () => void;
}) {
  const extendAll = useExtendAll(examId);
  const back = suggestion.affected - suggestion.stillOffline;

  const apply = async () => {
    try {
      const r = await extendAll.mutateAsync({ minutes: suggestion.minutes, reason: outageReason(suggestion), onlyAffected: true });
      toast.success(`Gave ${plural(r.extended.length, 'candidate')} ${plural(r.minutes, 'more minute')}`, {
        description: r.skipped.length ? `${r.skipped.length} could not be extended (already submitted).` : 'Their timers update on the next sync.',
      });
    } catch (err) {
      toast.error('Couldn’t extend their time', { description: errorMessage(err) });
    }
  };

  return (
    <section
      aria-labelledby="outage-title"
      role="region"
      className="grid gap-4 border-y border-warning/60 py-4 md:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] md:items-center md:gap-6 xl:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)_auto]"
    >
      <DropTrace suggestion={suggestion} attempts={attempts} />
      <div className="min-w-0">
        <h2 id="outage-title" className="text-headline text-label">
          {plural(suggestion.affected, 'candidate')} lost connection at {clockTime(suggestion.windowStart)}.
          {canIntervene && ` Extend their time by ${plural(suggestion.minutes, 'minute')}?`}
        </h2>
        <p className="mt-0.5 text-subheadline text-label-secondary">
          {suggestion.stillOffline === 0
            ? 'All of them are back online. '
            : back === 0
              ? 'None are back online yet. '
              : `${suggestion.stillOffline} still offline, ${back} back online. `}
          Drops this close together usually mean the network, not the candidates.
        </p>
      </div>
      {canIntervene && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:col-start-2 xl:col-start-auto">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Not now
          </Button>
          <Button variant="gray" size="sm" onClick={onAdjust}>
            Change…
          </Button>
          <Button variant="filled" size="sm" loading={extendAll.isPending} onClick={() => void apply()}>
            Extend by {suggestion.minutes} min
          </Button>
        </div>
      )}
    </section>
  );
}

const BIN_MS = 10_000;

/**
 * The alert's instrument: each affected candidate's last heartbeat, stacked in 10-second bins on a time rule, with
 * the detected window shaded. A tall column in one place is what "drops this close together" looks like.
 */
function DropTrace({ suggestion, attempts }: { suggestion: OutageSuggestion; attempts: LiveAttempt[] }) {
  const now = useServerNow();
  const ids = new Set(suggestion.attemptIds);
  const start = Date.parse(suggestion.windowStart);
  const end = Date.parse(suggestion.windowEnd);
  // Three minutes either side of the outage: long enough to show the calm before it, short enough that a cluster
  // still reads as a cluster however long ago it was.
  const from = start - 3 * 60_000;
  const to = Math.max(end + 60_000, Math.min(now, end + 3 * 60_000));
  const toNow = to >= now - 1000;
  // Only candidates still silent: for anyone back online, lastSeenAt is their latest heartbeat, not the drop.
  const drops = attempts
    .filter((a) => ids.has(a.attemptId) && a.lastSeenAt && !isLive(a, now))
    .map((a) => Date.parse(a.lastSeenAt!))
    .filter((t) => t >= from && t <= to);
  const span = to - from;
  const x = (t: number) => ((t - from) / span) * 100;
  const bins = new Map<number, number>();
  for (const t of drops) {
    const b = Math.floor((t - from) / BIN_MS);
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  const tallest = Math.max(1, ...bins.values());
  const seg = Math.min(3.2, 34 / tallest);
  const binWidth = Math.max((BIN_MS / span) * 100, 1.8);
  const minutes: number[] = [];
  for (let t = Math.ceil(from / 60_000) * 60_000; t <= to; t += 60_000) minutes.push(t);
  return (
    <figure
      className="flex flex-col gap-1.5"
      aria-label={`Last heartbeat of ${plural(drops.length, 'candidate')} still offline, from ${clockTime(from)} to ${toNow ? 'now' : clockTime(to)}`}
    >
      <div className="relative h-11">
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <rect x={x(start)} y={0} width={Math.max(0.8, x(end) - x(start))} height={44} className="fill-warning/15" />
          {minutes.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={39} y2={44} vectorEffect="non-scaling-stroke" className="stroke-label-tertiary" />
          ))}
          {[...bins].map(([b, n]) =>
            Array.from({ length: n }, (_, k) => (
              <rect
                key={`${b}-${k}`}
                x={b * binWidth + binWidth * 0.15}
                y={44 - (k + 1) * seg}
                width={binWidth * 0.7}
                height={seg * 0.72}
                className="fill-warning"
              />
            )),
          )}
          <line x1={0} x2={100} y1={44} y2={44} vectorEffect="non-scaling-stroke" className="stroke-separator" />
        </svg>
      </div>
      <figcaption className="flex justify-between text-caption tabular-nums text-label-secondary">
        <span>{clockTime(from)}</span>
        <span>{toNow ? 'now' : clockTime(to)}</span>
      </figcaption>
    </figure>
  );
}

/** Extends many attempts at once: the outage group, or everyone still in progress. */
export function BulkExtendDialog({
  examId,
  open,
  onOpenChange,
  suggestion,
  inProgress,
}: {
  examId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: OutageSuggestion | null;
  inProgress: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {/* Mounts with the content, so each opening starts from the suggestion as it is now. */}
        <BulkExtendBody examId={examId} suggestion={suggestion} inProgress={inProgress} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BulkExtendBody({
  examId,
  suggestion,
  inProgress,
  onDone,
}: {
  examId: string;
  suggestion: OutageSuggestion | null;
  inProgress: number;
  onDone: () => void;
}) {
  const [scope, setScope] = useState<'affected' | 'everyone'>(suggestion ? 'affected' : 'everyone');
  const [minutes, setMinutes] = useState(() => String(suggestion?.minutes ?? 5));
  const [reason, setReason] = useState(() => (suggestion ? outageReason(suggestion) : ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const extendAll = useExtendAll(examId);
  const formId = useId();

  const n = Number.parseInt(minutes, 10);
  const affectedScope = scope === 'affected' && !!suggestion;
  const count = affectedScope ? suggestion.affected : inProgress;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!Number.isInteger(n) || n < 1 || n > 120) next.minutes = 'Choose between 1 and 120 minutes';
    if (reason.trim().length < 3) next.reason = 'Give a reason of at least 3 characters';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const r = await extendAll.mutateAsync({ minutes: n, reason: reason.trim(), onlyAffected: affectedScope });
      toast.success(`Gave ${plural(r.extended.length, 'candidate')} ${plural(n, 'more minute')}`, {
        description: r.skipped.length ? `${r.skipped.length} could not be extended.` : undefined,
      });
      onDone();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else setErrors({ _: errorMessage(err) });
    }
  };

  return (
    <>
      <DialogHeader title="Extend time for several candidates" description="Each deadline moves by the same amount. Every change is in the audit log." />
      <DialogBody>
        <form
          id={formId}
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {suggestion && (
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as 'affected' | 'everyone')} aria-label="Who gets the time">
              <Radio value="affected" label={`The ${plural(suggestion.affected, 'candidate')} in the outage`} description={`Lost connection around ${clockTime(suggestion.windowStart)}`} />
              <Radio value="everyone" label={`Everyone in progress (${inProgress})`} />
            </RadioGroup>
          )}
          <Field label="Minutes to add" error={errors.minutes}>
            <Input type="number" inputMode="numeric" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-28" />
          </Field>
          <Field label="Reason" required error={errors.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="min-h-16" placeholder="What happened?" />
          </Field>
          {errors._ && (
            <p role="alert" className="text-footnote font-medium text-danger-text">
              {errors._}
            </p>
          )}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="gray" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="filled" type="submit" form={formId} loading={extendAll.isPending} disabled={count === 0}>
          Extend {plural(count, 'candidate')}
        </Button>
      </DialogFooter>
    </>
  );
}

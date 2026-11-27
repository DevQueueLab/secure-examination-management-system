'use client';

import { WifiOff } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { RadioGroup, Radio } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useExtendAll } from '../api';
import { clockTime, plural } from '../format';
import type { OutageSuggestion } from '../types';

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
  canIntervene,
  onAdjust,
  onDismiss,
}: {
  examId: string;
  suggestion: OutageSuggestion;
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
      className="flex flex-col gap-3 rounded-xl bg-warning-tint px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-text">
        <WifiOff className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="outage-title" className="text-headline text-label">
          {plural(suggestion.affected, 'candidate')} lost connection at {clockTime(suggestion.windowStart)}.
          {canIntervene && ` Extend their time by ${plural(suggestion.minutes, 'minute')}?`}
        </h2>
        <p className="text-subheadline text-warning-text">
          {suggestion.stillOffline === 0
            ? 'All of them are back online. '
            : back === 0
              ? 'None are back online yet. '
              : `${suggestion.stillOffline} still offline, ${back} back online. `}
          Drops this close together usually mean the network, not the candidates.
        </p>
      </div>
      {canIntervene && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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

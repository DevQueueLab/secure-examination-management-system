'use client';

import { useId, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { givenName } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useExtendAttempt, useForceSubmit } from '../api';
import { useServerNow } from '../clock';
import { clockTime, plural } from '../format';
import type { LiveAttempt } from '../types';
import { AnnouncementComposer } from './announcements-panel';

const PRESETS = ['5', '10', '15', '30'] as const;
const EXTEND_REASONS = ['Connection problem', 'Technical issue on our side', 'Accommodation', 'Late start at the venue'];

function QuickReasons({ reasons, onPick }: { reasons: string[]; onPick: (r: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Common reasons">
      {reasons.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onPick(r)}
          className="h-7 rounded-full bg-fill px-3 text-subheadline text-label-secondary transition-colors hover:bg-fill-strong hover:text-label"
        >
          {r}
        </button>
      ))}
    </div>
  );
}

interface AttemptDialogProps {
  examId: string;
  attempt: LiveAttempt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adds minutes to one candidate's server deadline. Reason required; audited.
 * The form lives in a body that mounts with the dialog content, so every opening starts from a clean form.
 */
export function ExtendTimeDialog({ examId, attempt, open, onOpenChange }: AttemptDialogProps) {
  if (!attempt) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <ExtendTimeBody examId={examId} attempt={attempt} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ExtendTimeBody({ examId, attempt, onDone }: { examId: string; attempt: LiveAttempt; onDone: () => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | 'other'>('10');
  const [custom, setCustom] = useState('20');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const extend = useExtendAttempt(examId);
  const formId = useId();
  const now = useServerNow();

  const minutes = preset === 'other' ? Number.parseInt(custom, 10) : Number(preset);
  const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 120;
  const base = Math.max(Date.parse(attempt.deadlineAt), now);
  const name = givenName(attempt.candidate.name);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!validMinutes) next.minutes = 'Choose between 1 and 120 minutes';
    if (reason.trim().length < 3) next.reason = 'Give a reason of at least 3 characters';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const r = await extend.mutateAsync({ attemptId: attempt.attemptId, minutes, reason: reason.trim() });
      toast.success(`${name} has ${plural(minutes, 'more minute')}`, { description: `New deadline ${clockTime(r.deadlineAt)}` });
      onDone();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else setErrors({ _: errorMessage(err) });
    }
  };

  return (
    <>
      <DialogHeader title={`More time for ${attempt.candidate.name}`} description="Moves their server deadline at once. Their timer updates on the next sync." />
      <DialogBody className="flex flex-col gap-5">
        <form
          id={formId}
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Minutes to add" error={errors.minutes}>
            <div className="flex flex-col gap-2">
              <SegmentedControl
                aria-label="Minutes to add"
                block
                value={preset}
                onValueChange={setPreset}
                options={[...PRESETS.map((p) => ({ value: p, label: `${p} min` })), { value: 'other' as const, label: 'Other' }]}
              />
              {preset === 'other' && (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  aria-label="Custom minutes, 1 to 120"
                  autoFocus
                />
              )}
            </div>
          </Field>
          <Field label="Reason" required error={errors.reason} hint="Kept in the audit log with your name.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="What happened?" className="min-h-16" />
          </Field>
          <QuickReasons reasons={EXTEND_REASONS} onPick={setReason} />
        </form>
        <p className="rounded-lg bg-fill-secondary px-3 py-2.5 text-subheadline text-label-secondary" aria-live="polite">
          {validMinutes ? (
            <>
              New deadline <span className="font-semibold text-label tabular-nums">{clockTime(base + minutes * 60_000)}</span>, was{' '}
              <span className="tabular-nums">{clockTime(attempt.deadlineAt)}</span>
            </>
          ) : (
            'Choose between 1 and 120 minutes.'
          )}
        </p>
        {errors._ && (
          <p role="alert" className="text-footnote font-medium text-danger-text">
            {errors._}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="gray" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="filled" type="submit" form={formId} loading={extend.isPending} disabled={!validMinutes}>
          {validMinutes ? `Add ${plural(minutes, 'minute')}` : 'Add time'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Ends an attempt on the candidate's behalf. Irreversible, so it is an alert dialog with a required reason. */
export function ForceSubmitDialog({ examId, attempt, open, onOpenChange }: AttemptDialogProps) {
  if (!attempt) return null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md text-left">
        <ForceSubmitBody examId={examId} attempt={attempt} onDone={() => onOpenChange(false)} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ForceSubmitBody({ examId, attempt, onDone }: { examId: string; attempt: LiveAttempt; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const forceSubmit = useForceSubmit(examId);
  const name = givenName(attempt.candidate.name);

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError('Give a reason of at least 3 characters');
      return;
    }
    try {
      await forceSubmit.mutateAsync({ attemptId: attempt.attemptId, reason: reason.trim() });
      toast.success(`${attempt.candidate.name}'s attempt is submitted`, { description: 'Their answers were saved as they stood.' });
      onDone();
    } catch (err) {
      setError(isApiError(err) && err.fields.reason ? err.fields.reason : errorMessage(err));
    }
  };

  return (
    <>
      <AlertDialogTitle>Submit {name}’s attempt now?</AlertDialogTitle>
      <AlertDialogDescription>
        Their {attempt.answeredCount} of {attempt.itemCount} answers are submitted as they stand and {name} can’t change them afterwards. This can’t be undone.
      </AlertDialogDescription>
      <form
        className="mt-5 flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Reason" required error={error ?? undefined} hint="Recorded in the audit log and shown on the attempt timeline.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="For example: confirmed using notes after a warning" className="min-h-16" autoFocus />
        </Field>
        <AlertDialogFooter className="mt-5">
          <AlertDialogCancel asChild>
            <Button variant="gray" size="lg" className="text-callout">
              Keep working
            </Button>
          </AlertDialogCancel>
          <Button variant="destructive" size="lg" className="text-callout" type="submit" loading={forceSubmit.isPending}>
            Submit attempt
          </Button>
        </AlertDialogFooter>
      </form>
    </>
  );
}

/** A private announcement to one candidate (shown in their workspace like any other). */
export function MessageDialog({
  examId,
  target,
  open,
  onOpenChange,
}: {
  examId: string;
  target: { userId: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!target) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={`Message ${target.name}`} description="Only they see it. It appears in their exam workspace with a read receipt." />
        <DialogBody>
          <AnnouncementComposer examId={examId} fixedTarget={target} onSent={() => onOpenChange(false)} autoFocus />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

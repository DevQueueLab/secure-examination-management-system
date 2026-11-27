'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { plural } from '../../analytics/format';
import { usePublishResults, useUnpublishResults } from '../api';
import type { ExamResults } from '../types';
import { ChecklistRow } from './checklist';

export function PublishDialog({ data, open, onOpenChange }: { data: ExamResults; open: boolean; onOpenChange: (open: boolean) => void }) {
  const publish = usePublishResults(data.exam.id);
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const blockers = data.checklist.filter((c) => c.level === 'blocker');
  const warnings = data.checklist.filter((c) => c.level === 'warning');
  const submitted = data.rows.filter((r) => r.status === 'submitted').length;
  const republish = data.exam.resultsVersion > 0;
  const needsForce = blockers.length > 0;

  const reset = () => {
    setForce(false);
    setReason('');
    setError(null);
    setBlockedMessage(null);
  };

  const submit = () => {
    setError(null);
    if (needsForce) {
      if (!force) return setBlockedMessage('Resolve the items above, or choose to publish anyway.');
      if (reason.trim().length < 10) return setError('Explain why, in at least 10 characters. The reason is kept in the audit log.');
    }
    publish.mutate(
      { force: needsForce, reason: needsForce ? reason.trim() : null },
      {
        onSuccess: (r) => {
          toast.success('Results published', { description: `${plural(r.notified, 'candidate')} notified. This is version ${r.resultsVersion}.` });
          reset();
          onOpenChange(false);
        },
        onError: (e) => {
          if (isApiError(e) && e.fields.reason) setError(e.fields.reason);
          else if (isApiError(e) && e.status === 409) setBlockedMessage(e.message);
          else toast.error(errorMessage(e));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title={republish ? 'Publish results again' : 'Publish results'}
          description={`${plural(submitted, 'candidate')} will see their score and a breakdown by question, and get a notification.`}
        />
        <DialogBody className="flex flex-col gap-5">
          <ul className="flex flex-col gap-3">
            {[...blockers, ...warnings].map((c) => (
              <ChecklistRow key={c.key} item={c} />
            ))}
            {!blockers.length && !warnings.length && <ChecklistRow item={{ key: 'ungraded', label: 'Ready to publish', detail: 'Every submitted answer is graded and nothing is waiting for review.', count: 0, level: 'ok' }} />}
          </ul>

          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-fill-secondary px-4 py-3 text-subheadline">
            <div>
              <dt className="text-label-secondary">Correct answers</dt>
              <dd className="font-medium text-label">{data.exam.showCorrectAnswers ? 'Shown to candidates' : 'Hidden'}</dd>
            </div>
            <div>
              <dt className="text-label-secondary">Grader feedback</dt>
              <dd className="font-medium text-label">{data.exam.showFeedback ? 'Shown to candidates' : 'Hidden'}</dd>
            </div>
          </dl>

          {needsForce && (
            <div className="flex flex-col gap-3">
              <Checkbox
                checked={force}
                onCheckedChange={(v) => {
                  setForce(v === true);
                  setBlockedMessage(null);
                }}
                label="Publish anyway"
                description="Candidates with ungraded parts see the marks awarded so far. You can grade and publish again later."
              />
              {force && (
                <Field label="Reason" required error={error ?? undefined} hint="Kept in the audit log with your name.">
                  <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two answers are under academic-integrity review; everyone else needs their results today." />
                </Field>
              )}
            </div>
          )}
          {blockedMessage && (
            <p role="alert" className="text-footnote font-medium text-danger-text">
              {blockedMessage}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="filled" loading={publish.isPending} onClick={submit} disabled={needsForce && !force}>
            {needsForce ? 'Publish anyway' : 'Publish results'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnpublishDialog({ data, open, onOpenChange }: { data: ExamResults; open: boolean; onOpenChange: (open: boolean) => void }) {
  const unpublish = useUnpublishResults(data.exam.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (reason.trim().length < 10) return setError('Explain why, in at least 10 characters. Candidates don’t see this; the audit log keeps it.');
    unpublish.mutate(
      { reason: reason.trim() },
      {
        onSuccess: (r) => {
          toast.success('Results hidden from candidates', {
            description: r.supersededReports ? `${plural(r.supersededReports, 'issued report')} now show as superseded when verified.` : undefined,
          });
          setReason('');
          setError(null);
          onOpenChange(false);
        },
        onError: (e) => {
          if (isApiError(e) && e.fields.reason) setError(e.fields.reason);
          else toast.error(errorMessage(e));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Unpublish results?"
          description="Candidates lose access to their scores straight away. Reports already issued are marked superseded on the public verification page."
        />
        <DialogBody>
          <Field label="Reason" required error={error ?? undefined} hint={`Publishing again creates version ${data.exam.resultsVersion + 1}.`}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Question 4 had a wrong key; re-marking before publishing again."
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={unpublish.isPending} onClick={submit}>
            Unpublish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

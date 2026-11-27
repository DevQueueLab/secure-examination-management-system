'use client';

import { Scale, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError } from '@/lib/api';
import { useAssign, useSetStatus } from '../api';
import { fmtDateTime, fmtMarks, fmtRelative, isActive, plural } from '../format';
import type { StaffDisputeView } from '../types';
import { EvidencePanel } from './evidence';
import { Banner, Facts, SlaBadge, StatusBadge, Stepper } from './primitives';
import { ResolutionCard } from './resolution';
import { ResolveDialog } from './resolve-dialog';
import { Thread } from './thread';

const UNASSIGNED = '__none__';

function ReviewPanel({ v }: { v: StaffDisputeView }) {
  const assign = useAssign(v.dispute.id);
  const status = useSetStatus(v.dispute.id);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const d = v.dispute;
  const active = isActive(d.status);
  const item = v.live.item;

  const onAssign = (value: string) => {
    setAssignError(null);
    assign.mutate(
      { assigneeId: value === UNASSIGNED ? null : value },
      {
        onSuccess: (view) => toast.success(view.role === 'staff' && view.assignee ? `Assigned to ${view.assignee.name}` : 'Unassigned'),
        onError: (err) => (isApiError(err) && err.fields.assigneeId ? setAssignError(err.fields.assigneeId) : toast.error(errorMessage(err))),
      },
    );
  };

  const ask = () => {
    if (question.trim().length < 5) {
      setError('Say what you need from the candidate');
      return;
    }
    status.mutate(
      { status: 'needs_info', message: question.trim() },
      {
        onSuccess: () => {
          toast.success('Question sent. The clock keeps running while you wait.');
          setQuestion('');
          setAsking(false);
        },
        onError: (err) => (isApiError(err) && err.fields.message ? setError(err.fields.message) : toast.error(errorMessage(err))),
      },
    );
  };

  return (
    <section className="flex flex-col gap-5 border-y border-separator py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-headline text-label">Review</h3>
        <SlaBadge status={d.status} dueAt={d.dueAt} size="sm" />
      </div>
      <Stepper steps={v.steps} />

      {v.can.assign && active ? (
        <Field label="Reviewer" error={assignError ?? undefined} hint="Whoever graded the answer, or decided the original, can’t be chosen.">
          <Select
            value={v.assignee?.id ?? UNASSIGNED}
            onValueChange={onAssign}
            disabled={assign.isPending}
            options={[
              { value: UNASSIGNED, label: 'Unassigned' },
              ...v.reviewers.map((r) => ({ value: r.id, label: `${r.name} (${r.role})`, description: r.conflict ?? undefined, disabled: !!r.conflict })),
            ]}
          />
        </Field>
      ) : (
        <Facts rows={[{ label: 'Reviewer', value: v.assignee?.name ?? 'Unassigned' }]} />
      )}

      {active && v.can.setStatus && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {d.status !== 'under_review' && (
              <Button
                variant="gray"
                size="sm"
                loading={status.isPending && !asking}
                onClick={() => status.mutate({ status: 'under_review' }, { onSuccess: () => toast.success('Marked as under review'), onError: (err) => toast.error(errorMessage(err)) })}
              >
                Start review
              </Button>
            )}
            {d.status !== 'needs_info' && !asking && (
              <Button variant="gray" size="sm" onClick={() => setAsking(true)}>
                Ask the candidate
              </Button>
            )}
          </div>
          {asking && (
            <div className="flex flex-col gap-2">
              <Field label="What do you need to know?" error={error ?? undefined}>
                <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={2000} autoFocus placeholder="Roughly what time did the connection drop, and for how long?" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="gray" size="sm" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
                <Button variant="tinted" size="sm" onClick={ask} loading={status.isPending}>
                  Send question
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {item && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-subheadline font-semibold text-label">Marks now</p>
          <Facts
            rows={[
              { label: `Answer${item.parts.answer.auto ? ' (automatic)' : ''}`, value: `${fmtMarks(item.parts.answer.score)} / ${fmtMarks(item.parts.answer.max)}` },
              ...(item.parts.working ? [{ label: 'Working', value: `${fmtMarks(item.parts.working.score)} / ${fmtMarks(item.parts.working.max)}` }] : []),
              { label: 'This question', value: `${fmtMarks(item.score)} / ${fmtMarks(item.max)}` },
              { label: 'Paper total', value: `${fmtMarks(v.live.attempt.score)} / ${fmtMarks(v.live.attempt.maxScore)}` },
            ]}
          />
          {item.voided && <p className="text-footnote text-warning-text">This question no longer counts for anyone.</p>}
        </div>
      )}
    </section>
  );
}

export function StaffDispute({ v }: { v: StaffDisputeView }) {
  const [deciding, setDeciding] = useState(false);
  const d = v.dispute;
  const active = isActive(d.status);
  const title = v.question ? `${v.question.label}: ${v.question.title}` : d.categoryLabel;
  const questionProblem = !!v.question && active && (d.category === 'ambiguous_question' || v.signals.sameQuestionActive > 1);
  const remedyHref = v.question ? `/exams/${v.exam.id}/disputes?remedy=${v.question.questionId}&dispute=${d.id}` : null;

  const decide = (
    <Button variant="filled" onClick={() => setDeciding(true)} disabled={!v.can.resolve}>
      <Scale aria-hidden /> Decide
    </Button>
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Disputes', href: '/disputes' }, { label: v.exam.title, href: `/exams/${v.exam.id}/disputes` }, { label: v.candidate.label }]}
        subtitle={`${d.categoryLabel} on ${v.exam.title}, raised ${fmtRelative(d.createdAt)} by ${v.candidate.label}`}
        meta={
          <div className="flex items-center gap-2">
            <StatusBadge status={d.status} label={d.withdrawn ? 'Withdrawn' : d.statusLabel} />
            {d.isAppeal && <Badge tone="info">Appeal</Badge>}
          </div>
        }
        actions={active ? v.can.resolve ? decide : <Tooltip content={v.conflict?.reason ?? 'You can’t decide this dispute'}>{decide}</Tooltip> : undefined}
      />

      <div className="flex flex-col gap-4 pb-6 empty:hidden">
        {v.conflict && active && (
          <Banner tone="warning" icon={<ShieldAlert />} title={v.conflict.reason}>
            A dispute is never decided by the person whose marking is questioned. Assign it to a colleague; you can still add notes.
          </Banner>
        )}
        {questionProblem && remedyHref && (
          <Banner
            tone="info"
            icon={<Users />}
            title="This looks like a question problem"
            action={
              v.can.applyRemedy ? (
                <Button asChild variant="filled" size="sm">
                  <Link href={remedyHref}>Apply a remedy for everyone</Link>
                </Button>
              ) : undefined
            }
          >
            {v.signals.sameQuestionTotal > 1
              ? `${plural(v.signals.sameQuestionTotal, 'candidate')} disputed ${v.question!.label} (${v.signals.sameQuestionActive} still open). `
              : `The candidate says ${v.question!.label} itself is at fault. `}
            Fixing the question re-marks every candidate the same way and answers these disputes together.
            {!v.can.applyRemedy && ' Ask the exam owner to apply it.'}
          </Banner>
        )}
        {v.original && (
          <Banner tone="neutral" icon={<Scale />} title={`Appeal of a decision by ${v.original.resolvedBy ?? 'a colleague'}`}>
            {v.original.outcomeLabel ?? 'Decided'} on {fmtDateTime(v.original.resolvedAt)}: “{v.original.note}”
          </Banner>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-6">
          {v.resolution && <ResolutionCard resolution={v.resolution} audience="staff" questionLabel={v.question?.label ?? null} />}
          <EvidencePanel evidence={v.evidence} audience="staff" questionLabel={v.question?.label ?? null} />
          <Thread
            disputeId={d.id}
            messages={v.messages}
            canMessage={v.can.message}
            staff
            description={d.description}
            raisedLabel={v.candidate.label}
            raisedAt={d.createdAt}
            closedNote="This dispute is closed. The conversation is kept with the record."
          />
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <ReviewPanel v={v} />
        </aside>
      </div>

      {v.can.resolve && <ResolveDialog v={v} open={deciding} onOpenChange={setDeciding} />}
    </>
  );
}

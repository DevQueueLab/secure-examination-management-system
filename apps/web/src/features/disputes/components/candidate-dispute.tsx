'use client';

import { MessageSquareWarning, Scale } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useAppeal, useDispute, useWithdraw } from '../api';
import { fmtDate, fmtDateTime } from '../format';
import type { CandidateDisputeView } from '../types';
import { ResolutionCard } from './resolution';
import { EvidencePanel } from './evidence';
import { Banner, SlaBadge, StatusBadge, Stepper } from './primitives';
import { StaffDispute } from './staff-dispute';
import { Thread } from './thread';

function statusLine(v: CandidateDisputeView): string {
  const d = v.dispute;
  if (d.withdrawn) return 'You withdrew this dispute. Nothing about your marks changed.';
  switch (d.status) {
    case 'open':
      return `Waiting for a reviewer. The exam team replies by ${fmtDate(d.dueAt)}.`;
    case 'under_review':
      return `A reviewer is looking at it. Expect a decision by ${fmtDate(d.dueAt)}.`;
    case 'needs_info':
      return 'The exam team needs more from you. Reply below and it goes straight back into review.';
    case 'appealed':
      return 'You appealed this decision. A different reviewer is looking at it.';
    case 'resolved':
      return 'Decided. The reason is written below.';
    default:
      if (v.appeal.appealId) return 'Closed: you appealed, and the appeal holds the final decision.';
      return v.resolution ? 'Decided and closed. The reason is written below.' : 'This dispute is closed.';
  }
}

function AppealBox({ v }: { v: CandidateDisputeView }) {
  const router = useRouter();
  const appeal = useAppeal(v.dispute.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (v.appeal.appealId) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Scale aria-hidden className="mt-0.5 size-[18px] shrink-0 text-label-secondary" />
          <div className="min-w-0">
            <h3 className="text-headline text-label">You appealed this decision</h3>
            <p className="mt-0.5 text-subheadline text-label-secondary">A reviewer who did not make the original decision is looking at it.</p>
          </div>
        </div>
        <Button asChild variant="gray" size="sm">
          <Link href={`/my-disputes/${v.appeal.appealId}`}>View appeal</Link>
        </Button>
      </div>
    );
  }
  if (!v.can.appeal) {
    return v.appeal.message ? <p className="text-footnote text-label-secondary">{v.appeal.message}</p> : null;
  }

  const submit = () => {
    if (reason.trim().length < 20) {
      setError('Explain why you disagree in at least 20 characters');
      return;
    }
    setError(null);
    appeal.mutate(
      { reason: reason.trim() },
      {
        onSuccess: (view) => {
          toast.success('Appeal submitted');
          router.push(`/my-disputes/${view.dispute.id}`);
        },
        onError: (err) => {
          if (isApiError(err) && err.fields.reason) setError(err.fields.reason);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-headline text-label">Disagree with the decision?</h3>
          <p className="mt-0.5 text-subheadline text-label-secondary">
            You can appeal once{v.appeal.closesAt ? `, until ${fmtDateTime(v.appeal.closesAt)}` : ''}. Someone other than the person who decided will review it.
          </p>
        </div>
        {!open && (
          <Button variant="tinted" onClick={() => setOpen(true)}>
            Appeal
          </Button>
        )}
      </div>
      {open && (
        <>
          <Field label="Why the decision is wrong" error={error ?? undefined} hint="Respond to the reason given. New facts help; repeating the original case does not.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="gray" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" onClick={submit} loading={appeal.isPending}>
              Submit appeal
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CandidateView({ v }: { v: CandidateDisputeView }) {
  const d = v.dispute;
  const confirm = useConfirm();
  const withdraw = useWithdraw(d.id);
  const lastAsk = [...v.messages].reverse().find((m) => !m.fromCandidate && !m.internal);
  const title = v.evidence.item ? `Question ${v.evidence.item.number}: ${v.evidence.item.title}` : d.categoryLabel;
  const showAppeal = !!v.resolution && !!(v.appeal.appealId || v.can.appeal || v.appeal.message);

  const onWithdraw = async () => {
    const ok = await confirm({
      title: 'Withdraw this dispute?',
      description: 'The exam team stops reviewing it and your marks stay as they are. You can’t reopen it, but you can raise a new one while the window is open.',
      confirmLabel: 'Withdraw dispute',
      destructive: true,
    });
    if (!ok) return;
    withdraw.mutate(undefined, {
      onSuccess: () => toast.success('Dispute withdrawn'),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'My disputes', href: '/my-disputes' }, { label: d.isAppeal ? 'Appeal' : v.exam.title }]}
        subtitle={d.isAppeal ? `Appeal on ${v.exam.title}, raised ${fmtDate(d.createdAt)}` : `${d.categoryLabel} on ${v.exam.title}, raised ${fmtDate(d.createdAt)}`}
        meta={
          <div className="flex items-center gap-2">
            <StatusBadge status={d.status} label={d.withdrawn ? 'Withdrawn' : d.statusLabel} />
            <SlaBadge status={d.status} dueAt={d.dueAt} />
          </div>
        }
        actions={
          v.can.withdraw ? (
            <Button variant="gray" onClick={() => void onWithdraw()} loading={withdraw.isPending}>
              Withdraw
            </Button>
          ) : undefined
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-6">
          <section aria-label="Progress" className="flex flex-col gap-3">
            <Stepper steps={v.steps} />
            <p className="text-subheadline text-label-secondary">{statusLine(v)}</p>
          </section>

          {d.status === 'needs_info' && lastAsk && (
            <Banner tone="warning" icon={<MessageSquareWarning />} title="The exam team needs more information">
              “{lastAsk.body}”
            </Banner>
          )}

          {v.original && (
            <Card className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-headline text-label">The decision you appealed</h3>
                <Link href={`/my-disputes/${v.original.id}`} className="inline-flex items-center gap-1 text-subheadline font-medium text-accent-text hover:underline">
                  View the original dispute
                </Link>
              </div>
              <p className="text-footnote text-label-secondary">
                {v.original.outcomeLabel ?? 'Decided'} on {fmtDateTime(v.original.resolvedAt)}
              </p>
              {v.original.note && <p className="whitespace-pre-wrap text-callout text-label">{v.original.note}</p>}
            </Card>
          )}

          {v.resolution && (
            <ResolutionCard resolution={v.resolution} audience="candidate" questionLabel={v.evidence.item ? `Question ${v.evidence.item.number}` : null}>
              {showAppeal ? <AppealBox v={v} /> : null}
            </ResolutionCard>
          )}

          <Thread
            disputeId={d.id}
            messages={v.messages}
            canMessage={v.can.message}
            staff={false}
            description={d.description}
            raisedLabel="You"
            raisedAt={d.createdAt}
            needsReply={d.status === 'needs_info'}
            closedNote={v.can.message ? undefined : 'This conversation is closed because the dispute has been decided or withdrawn.'}
          />
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <EvidencePanel evidence={v.evidence} audience="candidate" />
        </aside>
      </div>
    </>
  );
}

/** One dispute, for whoever opens it: the raiser gets their view, staff get the review workspace. */
export function DisputePage({ id, from }: { id: string; from: 'candidate' | 'staff' }) {
  const { data, isPending, error, refetch } = useDispute(id);
  if (isPending) return <SkeletonRows rows={6} />;
  if (error || !data) {
    const notFound = isApiError(error) && error.isNotFound;
    return (
      <EmptyState
        icon={<MessageSquareWarning />}
        title={notFound ? 'Dispute not found' : 'Couldn’t load this dispute'}
        description={notFound ? 'It may belong to someone else, or the link is wrong.' : errorMessage(error)}
        action={
          notFound ? (
            <Button asChild variant="gray">
              <Link href={from === 'candidate' ? '/my-disputes' : '/disputes'}>{from === 'candidate' ? 'My disputes' : 'All disputes'}</Link>
            </Button>
          ) : (
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }
  return data.role === 'candidate' ? <CandidateView v={data} /> : <StaffDispute v={data} />;
}

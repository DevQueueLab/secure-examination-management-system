'use client';

import { Check, FileQuestion, MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useEvidencePreview, useRaiseContext, useRaiseDispute } from '../api';
import { CATEGORY_COPY, fmtDate, fmtMarks, plural } from '../format';
import type { DisputeCategory, RaiseContext } from '../types';
import { ChoiceList, ChoiceRow } from './choice-list';
import { EvidencePanel } from './evidence';
import { Banner } from './primitives';

const CATEGORIES: DisputeCategory[] = ['grading_error', 'ambiguous_question', 'technical_incident', 'other'];
const needsItem = (c: DisputeCategory | null) => c === 'grading_error' || c === 'ambiguous_question';
const MIN = 20;
const MAX = 2000;

function StepHeading({ id, n, title, done, children }: { id: string; n: number; title: string; done: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold', done ? 'bg-success text-white' : 'bg-fill text-label-secondary')}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0">
        <h2 id={id} className="text-title-3 text-label">{title}</h2>
        {children && <p className="mt-0.5 text-subheadline text-label-secondary">{children}</p>}
      </div>
    </div>
  );
}

function defaultCategory(ctx: RaiseContext, itemId: string | null): DisputeCategory | null {
  if (itemId && ctx.windows.grading_error.allowed) return 'grading_error';
  return null;
}

function Form({ ctx, initialItemId }: { ctx: RaiseContext; initialItemId: string | null }) {
  const router = useRouter();
  const raise = useRaiseDispute();
  const preselected = ctx.items.find((i) => i.id === initialItemId && !i.openDispute && !i.voided) ? initialItemId : null;
  const [category, setCategory] = useState<DisputeCategory | null>(() => defaultCategory(ctx, preselected));
  const [itemId, setItemId] = useState<string | null>(preselected);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);

  const itemRequired = needsItem(category);
  const item = ctx.items.find((i) => i.id === itemId) ?? null;
  const ready = !!category && (!itemRequired || !!item);
  const preview = useEvidencePreview(ctx.attempt.id, item?.id ?? null, category ?? 'grading_error', ready);
  const length = description.trim().length;
  const remaining = ctx.limits.max - ctx.limits.used;
  const atLimit = remaining <= 0;
  const alreadyOpen = ctx.items.filter((i) => i.openDispute);

  const submit = () => {
    const next: Record<string, string> = {};
    if (!category) next.category = 'Choose what kind of problem this is';
    if (itemRequired && !item) next.attemptItemId = 'Choose the question this is about';
    if (length < MIN) next.description = `Describe the problem in at least ${MIN} characters`;
    setErrors(next);
    if (Object.keys(next).length) return;
    setConflict(null);
    raise.mutate(
      { attemptId: ctx.attempt.id, attemptItemId: item?.id ?? null, category: category!, description: description.trim() },
      {
        onSuccess: (view) => {
          toast.success(view.dispute.dueAt ? `Dispute submitted. Expect a reply by ${fmtDate(view.dispute.dueAt)}.` : 'Dispute submitted');
          router.push(`/my-disputes/${view.dispute.id}`);
        },
        onError: (err) => {
          if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
          else if (isApiError(err) && err.status === 409) setConflict(err.message);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex flex-col gap-10">
        {atLimit && (
          <Banner tone="warning" icon={<MessageSquareWarning />} title={`You have used all ${ctx.limits.max} disputes for this exam`}>
            Add to one of your existing disputes instead. Each one has its own conversation with the exam team.
          </Banner>
        )}

        <section className="flex flex-col gap-4" aria-labelledby="step-category">
          <StepHeading id="step-category" n={1} title="What went wrong?" done={!!category}>
            Pick the closest match. It decides who looks at it first, not the outcome.
          </StepHeading>
          {errors.category && <p className="text-footnote text-danger-text">{errors.category}</p>}
          <ChoiceList<DisputeCategory> value={category} onValueChange={(c) => setCategory(c)} label="What went wrong">
            {CATEGORIES.map((c) => {
              const w = ctx.windows[c];
              return (
                <ChoiceRow
                  key={c}
                  value={c}
                  disabled={!w.allowed || atLimit}
                  title={CATEGORY_COPY[c].label}
                  description={w.allowed ? CATEGORY_COPY[c].explain : (w.message ?? 'Not available for this attempt right now.')}
                />
              );
            })}
          </ChoiceList>
        </section>

        <section className={cn('flex flex-col gap-4', !category && 'opacity-60')} aria-labelledby="step-question">
          <StepHeading id="step-question" n={2} title={itemRequired || !category ? 'Which question?' : 'Which question? (optional)'} done={!!item}>
            {category && !itemRequired ? 'Pick one if the problem affected a particular question.' : 'Your answer and its marks are attached exactly as they stand now.'}
          </StepHeading>
          {errors.attemptItemId && <p className="text-footnote text-danger-text">{errors.attemptItemId}</p>}
          <ChoiceList value={itemId} onValueChange={(v) => setItemId(v)} label="Question">
            {ctx.items.map((i) => (
              <ChoiceRow
                key={i.id}
                value={i.id}
                disabled={!category || !!i.openDispute || i.voided || atLimit}
                title={`Question ${i.number}: ${i.title}`}
                description={i.voided ? `No longer counts: ${i.voidReason ?? 'removed for everyone'}` : i.openDispute ? 'You already have an open dispute about this question.' : i.typeLabel}
                aside={
                  i.openDispute ? (
                    <Badge tone="info" size="sm">
                      Open
                    </Badge>
                  ) : ctx.exam.published && i.score !== null ? (
                    <span className="text-subheadline tabular-nums text-label-secondary">
                      {fmtMarks(i.score)} / {fmtMarks(i.max)}
                    </span>
                  ) : null
                }
              />
            ))}
          </ChoiceList>
          {!itemRequired && item && (
            <div>
              <Button variant="plain" size="sm" onClick={() => setItemId(null)}>
                Not about one question
              </Button>
            </div>
          )}
          {alreadyOpen.length > 0 && (
            <p className="text-footnote text-label-secondary">
              Already open:{' '}
              {alreadyOpen.map((i, k) => (
                <span key={i.id}>
                  {k > 0 && ', '}
                  <Link className="font-medium text-accent-text hover:underline" href={`/my-disputes/${i.openDispute!.id}`}>
                    question {i.number}
                  </Link>
                </span>
              ))}
              . Add new detail there instead.
            </p>
          )}
        </section>

        <section className={cn('flex flex-col gap-4', !ready && 'opacity-60')} aria-labelledby="step-explain">
          <StepHeading id="step-explain" n={3} title="Explain what happened" done={length >= MIN}>
            Say what you expected and why. Point to the step, part or wording you mean. The reviewer sees your answer as it was marked.
          </StepHeading>
          <Field
            label="Your case"
            error={errors.description}
            hint={
              <span className="flex justify-between gap-4">
                <span>{category ? `For example: “${CATEGORY_COPY[category].example}”` : 'Be specific: a precise case is decided faster.'}</span>
                <span className={cn('shrink-0 tabular-nums', length > 0 && length < MIN && 'text-warning-text')}>
                  {length < MIN ? `${MIN - length} more to go` : `${length} / ${MAX}`}
                </span>
              </span>
            }
          >
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} maxLength={MAX} disabled={!ready || atLimit} placeholder="What should have happened, and what makes you think so?" />
          </Field>
        </section>

        {conflict && (
          <Banner tone="warning" icon={<MessageSquareWarning />} title="This dispute can’t be raised">
            {conflict}
          </Banner>
        )}

        <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-footnote text-label-secondary">
            {plural(Math.max(0, remaining), 'dispute')} left for this exam. The exam team replies within five days, with a written reason for any decision.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="gray">
              <Link href="/my-disputes">Cancel</Link>
            </Button>
            <Button variant="filled" onClick={submit} loading={raise.isPending} disabled={atLimit}>
              Submit dispute
            </Button>
          </div>
        </div>
      </div>

      <aside className="lg:sticky lg:top-6">
        {ready ? (
          preview.isPending ? (
            <Card className="flex flex-col gap-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ) : preview.data ? (
            <EvidencePanel evidence={preview.data.evidence} audience="candidate" preview />
          ) : (
            <Card>
              <p className="text-callout text-label-secondary">{errorMessage(preview.error, 'The preview isn’t available right now. Your record is still captured when you submit.')}</p>
            </Card>
          )
        ) : (
          <Card className="flex flex-col items-center gap-2 py-10 text-center">
            <FileQuestion aria-hidden className="size-8 text-label-tertiary" />
            <p className="text-callout font-semibold text-label">What the reviewer will see</p>
            <p className="max-w-xs text-subheadline text-label-secondary">Choose a problem{needsItem(category) ? ' and a question' : ''} to preview the record that is sealed with your dispute.</p>
          </Card>
        )}
      </aside>
    </div>
  );
}

export function RaiseFlow({ attemptId, itemId }: { attemptId: string | null; itemId: string | null }) {
  const ctx = useRaiseContext(attemptId);
  const crumbs = [{ label: 'My disputes', href: '/my-disputes' }, { label: 'Raise a dispute' }];
  if (!attemptId) {
    return (
      <>
        <PageHeader title="Raise a dispute" breadcrumbs={crumbs} />
        <EmptyState
          icon={<MessageSquareWarning />}
          title="Choose an exam first"
          description="Open a published result and choose Raise a dispute about this question, or pick an exam from My disputes."
          action={
            <Button asChild variant="gray">
              <Link href="/my-disputes">My disputes</Link>
            </Button>
          }
        />
      </>
    );
  }
  if (ctx.isPending) {
    return (
      <>
        <PageHeader title="Raise a dispute" breadcrumbs={crumbs} />
        <SkeletonRows rows={5} />
      </>
    );
  }
  if (ctx.error || !ctx.data) {
    return (
      <>
        <PageHeader title="Raise a dispute" breadcrumbs={crumbs} />
        <EmptyState
          icon={<MessageSquareWarning />}
          title="This attempt can’t be disputed"
          description={errorMessage(ctx.error)}
          action={
            <Button asChild variant="gray">
              <Link href="/my-disputes">My disputes</Link>
            </Button>
          }
        />
      </>
    );
  }
  const c = ctx.data;
  const anyOpen = Object.values(c.windows).some((w) => w.allowed);
  const closes = Object.values(c.windows)
    .map((w) => w.closesAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  return (
    <>
      <PageHeader
        title="Raise a dispute"
        breadcrumbs={crumbs}
        subtitle={`${c.exam.title}${c.exam.published && c.attempt.score !== null ? `, your score ${fmtMarks(c.attempt.score)} of ${fmtMarks(c.attempt.maxScore)}` : ''}${anyOpen && closes ? `, open until ${fmtDate(closes)}` : ''}`}
      />
      {anyOpen ? (
        <Form ctx={c} initialItemId={itemId} />
      ) : (
        <EmptyState
          icon={<MessageSquareWarning />}
          title="Disputes are closed for this exam"
          description={Object.values(c.windows).find((w) => w.message)?.message ?? 'The window for raising disputes has passed.'}
          action={
            <Button asChild variant="gray">
              <Link href="/my-disputes">My disputes</Link>
            </Button>
          }
        />
      )}
    </>
  );
}

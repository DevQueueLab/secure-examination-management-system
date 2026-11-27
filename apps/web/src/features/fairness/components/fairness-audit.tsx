'use client';

import { CalendarClock, ClipboardCheck } from 'lucide-react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useFairnessAudit, useRecalibrate } from '../api';
import { DIFFICULTY_LABEL, fmtDateTime, fmtPercent, fmtShare, fmtSignedPoints, plural } from '../format';
import type { AuditItem, FairnessAuditReport, Spread } from '../types';

/**
 * After the exam: did the papers turn out equally hard? Predicted difficulty (stored when each paper was
 * assembled) against the difficulty measured on submitted answers, and the questions whose calibration is off.
 */
export function FairnessAudit({ examId }: { examId: string }) {
  const { data, isPending, error, refetch } = useFairnessAudit(examId);
  const recalibrate = useRecalibrate(examId);
  const confirm = useConfirm();

  const learnable = data?.items.filter((i) => i.n > 0) ?? [];
  const canRecalibrate = data?.state === 'ready' && learnable.length > 0;

  async function onRecalibrate() {
    if (!data) return;
    const ok = await confirm({
      title: 'Update difficulty estimates in the question bank?',
      description: `The observed difficulty of ${plural(learnable.length, 'question', 'questions')} is replaced with this exam's results (${plural(data.gradedAnswers, 'graded answer', 'graded answers')}). Papers assembled from now on balance with the new values; papers already sat stay as they are. The change is recorded in the audit log.`,
      confirmLabel: `Recalibrate ${plural(learnable.length, 'question', 'questions')}`,
    });
    if (!ok) return;
    try {
      const result = await recalibrate.mutateAsync();
      toast.success(`Recalibrated ${plural(result.updated, 'question', 'questions')}`, { description: 'Future papers balance with the new estimates.' });
    } catch (err) {
      toast.error(errorMessage(err, 'Recalibration failed. Try again.'));
    }
  }

  return (
    <Section
      title="After the exam: did the papers turn out equally hard?"
      description="Each paper's expected difficulty, recorded when it was assembled, against the difficulty its questions showed on submitted answers."
      actions={
        canRecalibrate ? (
          <Button variant={data.candidates > 0 ? 'filled' : 'gray'} onClick={onRecalibrate} loading={recalibrate.isPending}>
            Recalibrate bank
          </Button>
        ) : undefined
      }
    >
      {isPending ? (
        <div role="status" aria-label="Loading the audit" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full max-w-2xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : error ? (
        <EmptyState
          size="sm"
          icon={<ClipboardCheck />}
          title="The audit didn’t load"
          description={errorMessage(error)}
          action={
            <Button size="sm" variant="tinted" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : data.state === 'not_completed' ? (
        <EmptyState size="sm" icon={<CalendarClock />} title="Opens when the window closes" description={data.message ?? undefined} />
      ) : data.state === 'no_results' ? (
        <EmptyState size="sm" icon={<ClipboardCheck />} title="No graded results yet" description={data.message ?? undefined} />
      ) : (
        <AuditReady data={data} />
      )}
    </Section>
  );
}

function spreadLine(s: Spread | null) {
  if (!s) return { value: '–', hint: 'Not recorded for these papers' };
  const same = Math.abs(s.maxPercent - s.minPercent) < 0.05;
  return {
    value: same ? fmtPercent(s.minPercent) : `${fmtPercent(s.minPercent)} – ${fmtPercent(s.maxPercent)}`,
    hint: same ? 'Identical for every paper' : `Range ${s.rangePercent.toFixed(1)} pts, standard deviation ${s.sdPercent.toFixed(1)} pts`,
  };
}

function AuditReady({ data }: { data: FairnessAuditReport }) {
  const predicted = spreadLine(data.papers.predicted);
  const observed = spreadLine(data.papers.observed);
  const items = [...data.items].sort(
    (a, b) => Number(b.recalibrate) - Number(a.recalibrate) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0),
  );
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 border-y py-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <Fact term="Papers compared" value={data.papers.count.toLocaleString()} detail={data.papers.distinct === 1 ? 'One shared question set' : `${data.papers.distinct} different question sets`} />
        <Fact term="Predicted when assembled" value={predicted.value} detail={predicted.hint} />
        <Fact term="Observed on submitted answers" value={observed.value} detail={observed.hint} />
      </dl>
      {data.papers.distinct === 1 && (
        <p className="max-w-prose text-subheadline text-label-secondary">
          With one shared question set, papers cannot differ in difficulty. Calibrating the questions below still sharpens how future papers that draw on them are balanced.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="max-sm:px-3">Question</TableHead>
            <TableHead numeric className="max-sm:hidden">
              Answers
            </TableHead>
            <TableHead numeric className="max-sm:hidden">
              Label prior
            </TableHead>
            <TableHead numeric className="max-sm:hidden">
              Engine estimate
            </TableHead>
            <TableHead numeric className="max-sm:px-3">
              Observed
            </TableHead>
            <TableHead numeric className="max-sm:px-3">
              Difference
            </TableHead>
            <TableHead className="max-sm:hidden">
              <span className="sr-only">Status</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <AuditRow key={item.questionId} item={item} minN={data.thresholds.minN} />
          ))}
        </TableBody>
      </Table>
      <p className="text-footnote text-label-secondary">
        Observed is the mean share of the answer marks earned (method marks excluded). A question is flagged when it differs from the engine’s estimate by more than{' '}
        {Math.round(data.thresholds.delta * 100)} points on at least {data.thresholds.minN} graded answers.
        {data.lastRecalibration && (
          <>
            {' '}
            Last recalibrated {fmtDateTime(data.lastRecalibration.at)}
            {data.lastRecalibration.by ? ` by ${data.lastRecalibration.by}` : ''} ({plural(data.lastRecalibration.questions, 'question', 'questions')}).
          </>
        )}
      </p>
    </div>
  );
}

function AuditRow({ item, minN }: { item: AuditItem; minN: number }) {
  const status =
    item.n === 0 ? null : item.n < minN ? (
      <Badge size="sm">Few answers</Badge>
    ) : item.recalibrate ? (
      <Badge size="sm" tone="warning">
        Recalibrate
      </Badge>
    ) : (
      <Badge size="sm" tone="success">
        On estimate
      </Badge>
    );
  return (
    <TableRow>
      <TableCell className="max-sm:px-3 sm:max-w-[18rem]">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-footnote tabular-nums text-label-tertiary">{item.label}</span>
          <span className="sm:truncate">{item.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary">
          <span>{DIFFICULTY_LABEL[item.difficulty]}</span>
          <span>{item.sectionTitle}</span>
          {/* Phones drop the status column; the verdict moves under the title. */}
          {status && <span className="sm:hidden">{status}</span>}
        </div>
      </TableCell>
      <TableCell numeric className="max-sm:hidden">
        {item.n}
      </TableCell>
      <TableCell numeric className="text-label-secondary max-sm:hidden">
        {fmtShare(item.labelPrior)}
      </TableCell>
      <TableCell numeric className="max-sm:hidden">
        {fmtShare(item.estimateP)}
      </TableCell>
      <TableCell numeric className="max-sm:px-3">
        {item.observedP === null ? '–' : fmtShare(item.observedP)}
      </TableCell>
      <TableCell numeric className={cn('max-sm:px-3', item.recalibrate ? 'font-medium text-warning-text' : 'text-label-secondary')}>
        {fmtSignedPoints(item.delta)}
      </TableCell>
      <TableCell className="max-sm:hidden">{status}</TableCell>
    </TableRow>
  );
}

/** One row of the predicted-against-observed comparison: a term, its figure, and what the figure covers. */
function Fact({ term, value, detail }: { term: string; value: string; detail: string }) {
  return (
    <div className="contents">
      <dt className="pt-2.5 text-subheadline text-label-secondary sm:pb-2.5">{term}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2.5 pb-2.5 text-callout sm:pt-2.5">
        <span className="font-semibold tabular-nums text-label">{value}</span>
        <span className="text-footnote text-label-secondary">{detail}</span>
      </dd>
    </div>
  );
}

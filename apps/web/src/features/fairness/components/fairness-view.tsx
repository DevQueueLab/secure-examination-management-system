'use client';

import { CircleCheck, Scale, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useFairnessSimulation } from '../api';
import { DIFFICULTY_LABEL, fmtBand, fmtPercent, fmtShare, fmtShareStrict, listOf, plural } from '../format';
import type { FairnessSimulationReport } from '../types';
import { DistributionChart, DistributionLegend } from './distribution-chart';
import { ExposureChart, ExposureLegend } from './exposure-chart';
import { FairnessAudit } from './fairness-audit';

const RUN_OPTIONS = [
  { value: '200', label: '200' },
  { value: '400', label: '400' },
  { value: '1000', label: '1,000' },
];

/** Fairness of randomized papers (IC-5.2): simulated evidence before the exam, an audit against candidates’ results after it. */
export function FairnessView({ examId }: { examId: string }) {
  const [runs, setRuns] = useState(400);
  const { data, isPending, isPlaceholderData, error, refetch } = useFairnessSimulation(examId, runs);

  if (isPending) return <FairnessSkeleton />;
  if (error) {
    const forbidden = isApiError(error) && (error.isForbidden || error.isNotFound);
    return (
      <EmptyState
        icon={<Scale />}
        title={forbidden ? 'The fairness report is for this exam’s examiners' : 'The fairness report didn’t load'}
        description={forbidden ? 'Ask the exam owner to add you as a co-examiner to see how its papers are balanced.' : errorMessage(error)}
        action={
          forbidden ? undefined : (
            <Button variant="tinted" onClick={() => refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  if (!data.hasQuestions) {
    return (
      <EmptyState
        icon={<Scale />}
        title="Add questions to see how fair the papers are"
        description="Once the exam has questions, Athena simulates hundreds of papers to show how evenly difficulty is spread."
        action={
          <Button asChild variant="tinted">
            <Link href={`/exams/${examId}/questions`}>Go to questions</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {data.hasPools ? <SimulationReport data={data} runs={runs} onRunsChange={setRuns} stale={isPlaceholderData} /> : <NoPools data={data} examId={examId} />}
      <HowBalancingWorks data={data} />
      <FairnessAudit examId={examId} />
    </div>
  );
}

function headline(data: FairnessSimulationReport): string {
  const papers = `all ${data.runs.toLocaleString()} simulated papers`;
  const balanced = data.balanced.deviation.maxPercent;
  const random = data.random.deviation.maxPercent;
  if (random < 0.05) return `Every simulated paper has the same expected difficulty, balanced or not, so there is nothing for balancing to correct.`;
  const kept = balanced < 0.05 ? `Balancing put ${papers} on the target difficulty` : `Balancing kept ${papers} within ${fmtBand(balanced)} of the target difficulty`;
  return `${kept}, while a random draw strayed up to ${fmtBand(random)}.`;
}

function SimulationReport({ data, runs, onRunsChange, stale }: { data: FairnessSimulationReport; runs: number; onRunsChange: (n: number) => void; stale: boolean }) {
  const [distView, setDistView] = useState<'chart' | 'table'>('chart');
  const [exposureView, setExposureView] = useState<'chart' | 'table'>('chart');
  const b = data.balanced;
  const r = data.random;
  const t = data.tolerance;
  const band = fmtBand(t.configuredPercent, 0);
  const pooled = data.exposure.filter((e) => e.pooled);
  const fixedCount = data.exposure.length - pooled.length;
  const draws = listOf(data.pools.map((p, i) => `${p.drawCount} of the ${p.poolSize}${i === 0 ? ' questions' : ''} in ${p.title}`));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h2 className="max-w-3xl text-title-2 text-label">{headline(data)}</h2>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="max-w-2xl text-subheadline text-label-secondary">
            Both runs assemble {plural(data.runs, 'paper', 'papers')} from this exam’s pools, marks and difficulty estimates. The target is {fmtPercent(data.targetPercent)} expected
            score, with a tolerance of {band}.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-footnote text-label-secondary">Papers simulated</span>
            <SegmentedControl size="sm" aria-label="Papers simulated" options={RUN_OPTIONS} value={String(runs)} onValueChange={(v) => onRunsChange(Number(v))} />
          </div>
        </div>
        {!data.exam.balanceDifficulty && (
          <div className="flex items-start gap-3 rounded-xl bg-warning-tint px-4 py-3 text-callout text-label">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Balancing is switched off for this exam, so candidates’ papers follow the random draw. Turn it on in{' '}
              <Link href={`/exams/${data.exam.id}/settings`} className="font-medium text-accent-text underline">
                Settings
              </Link>{' '}
              to give every candidate the balanced distribution.
            </p>
          </div>
        )}
      </header>

      <Card>
        <CardHeader
          title="Expected difficulty of every simulated paper"
          description="Share of papers at each expected score. Balancing pulls papers into the band around the target."
          action={<ViewToggle label="Difficulty distribution" value={distView} onChange={setDistView} />}
        />
        <div className={cn('mb-6 grid gap-x-10 gap-y-5 transition-opacity duration-200 sm:grid-cols-2', stale && 'opacity-50')}>
          <Figure value={`${b.spread.sdPercent.toFixed(1)} pts`}>
            standard deviation of expected score across balanced papers, against {r.spread.sdPercent.toFixed(1)} pts for a random draw.
          </Figure>
          <Figure
            value={fmtShareStrict(t.balancedShare)}
            badge={
              t.achievable ? (
                <Badge size="sm" tone="success">
                  <CircleCheck aria-hidden />
                  Tolerance met
                </Badge>
              ) : (
                <Badge size="sm" tone="warning">
                  <TriangleAlert aria-hidden />
                  Holds at {fmtBand(t.holdsAtPercent)}
                </Badge>
              )
            }
          >
            of balanced papers land within {band} of the target, against {fmtShareStrict(t.randomShare)} of random-draw papers.
          </Figure>
        </div>
        <ToleranceRules balanced={b.deviation.maxPercent} random={r.deviation.maxPercent} tolerance={t.configuredPercent} stale={stale} />
        {!t.achievable && (
          <p className="-mt-2 mb-6 max-w-prose text-subheadline text-label-secondary">
            The pools don’t have enough interchangeable questions, with the same marks and a different difficulty, to reach {band} every time. The balancer holds{' '}
            {fmtBand(t.holdsAtPercent)} for {fmtShare(t.holdsForShare)} of papers, so widen the tolerance or add questions to the pools.
          </p>
        )}
        {distView === 'chart' && (
          <div className="mb-6">
            <DistributionLegend tolerancePercent={t.configuredPercent} />
          </div>
        )}
        <DistributionChart bins={data.histogram.bins} runs={data.runs} targetPercent={data.targetPercent} tolerancePercent={t.configuredPercent} view={distView} stale={stale} />
      </Card>

      <Card>
        <CardHeader
          title="How often each pool question is shown"
          description="Exposure is leak risk: the more papers carry a question, the more one leak reveals. The line on each row marks an even draw, where every question in its pool is equally likely."
          action={<ViewToggle label="Question exposure" value={exposureView} onChange={setExposureView} />}
        />
        <div className={cn('mb-6 flex flex-col gap-2 transition-opacity duration-200', stale && 'opacity-50')}>
          <Figure value={fmtShare(b.overlap.sharedShare)}>
            of a paper’s questions also appear on another candidate’s paper, on average,{' '}
            {fmtShare(b.overlap.sharedShare) === fmtShare(r.overlap.sharedShare)
              ? 'about the same as with a random draw.'
              : `against ${fmtShare(r.overlap.sharedShare)} with a random draw.`}
          </Figure>
          <p className="max-w-prose text-footnote text-label-secondary">
            Each paper draws {draws}
            {fixedCount > 0 ? `, plus ${plural(fixedCount, 'fixed question', 'fixed questions')} that every candidate gets` : ''}. The overlap is approximate, averaged over{' '}
            {b.overlap.sampled ? `${b.overlap.pairs.toLocaleString()} randomly sampled` : `all ${b.overlap.pairs.toLocaleString()}`} pairs of simulated papers.
          </p>
        </div>
        {exposureView === 'chart' && (
          <div className="mb-3">
            <ExposureLegend />
          </div>
        )}
        <div className={cn('transition-opacity duration-200', stale && 'opacity-50')}>
          <ExposureChart rows={pooled} view={exposureView} />
        </div>
      </Card>
    </div>
  );
}

/** The furthest any simulated paper lands from the target, balanced against random, on the Marks rule with the gold tolerance band. */
function ToleranceRules({ balanced, random, tolerance, stale }: { balanced: number; random: number; tolerance: number; stale: boolean }) {
  const max = Math.max(5, Math.ceil(Math.max(balanced, random, tolerance) + 1));
  const rows = [
    { label: 'Balanced', value: balanced, tone: 'accent' as const },
    { label: 'Random draw', value: random, tone: 'neutral' as const },
  ];
  return (
    <div role="group" aria-labelledby="fair-distance" className={cn('mb-6 flex flex-col gap-3 transition-opacity duration-200', stale && 'opacity-50')}>
      <p id="fair-distance" className="text-subheadline text-label-secondary">
        Furthest any paper lands from the target score, in points. The gold band is the {fmtBand(tolerance, 0)} tolerance.
      </p>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 sm:gap-4">
          <span className="text-subheadline text-label">{row.label}</span>
          <MarksRule
            value={row.value}
            max={max}
            label={`${row.label}: furthest from the target`}
            valueText={`${row.value.toFixed(2)} points`}
            band={[0, tolerance]}
            tone={row.tone}
            labels="ends"
            ticks={{ major: 1, minor: 0.25 }}
          />
          <span className="numeral text-right text-title-3 text-label">{row.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function NoPools({ data, examId }: { data: FairnessSimulationReport; examId: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="max-w-3xl text-title-2 text-label">
        Every candidate gets the same {plural(data.questionsPerPaper, 'question', 'questions')}, so there is nothing to balance.
      </h2>
      <p className="max-w-prose text-subheadline text-label-secondary">
        With the current difficulty estimates, every paper has the same expected score, {fmtPercent(data.targetPercent)}. Option order and parameterized values can still differ
        per candidate. To randomize papers fairly, turn a section into a pool that draws some of its questions, and Athena balances each draw.
      </p>
      <div className="mt-1">
        <Button asChild variant="tinted" size="sm">
          <Link href={`/exams/${examId}/questions`}>
            <SlidersHorizontal aria-hidden />
            Edit sections
          </Link>
        </Button>
      </div>
    </section>
  );
}

function HowBalancingWorks({ data }: { data: FairnessSimulationReport }) {
  const { priorWeight: w, labelPriors } = data.calibration;
  const priors = listOf((['easy', 'medium', 'hard'] as const).map((d) => `${DIFFICULTY_LABEL[d].toLowerCase()} ${fmtShare(labelPriors[d])}`));
  const band = fmtBand(data.exam.tolerancePercent, 0);
  return (
    <Section
      title="How balancing works"
      description="Every paper a candidate sits is assembled by these rules from a seed stored with the attempt, and the paper each candidate sat is recorded with its expected difficulty, so a dispute can be checked against it."
    >
      <div className="flex max-w-prose flex-col gap-3 text-callout text-label-secondary">
        <p>
          Athena estimates the share of each question’s marks a candidate is likely to earn. The estimate starts from the question’s label ({priors}) and blends in candidates’ results
          as they arrive: <span className="whitespace-nowrap tabular-nums text-label">p = ({w} × label + n × observed) ÷ ({w} + n)</span>. After {w} graded answers the results
          weigh as much as the label, and after {w * 3} they weigh three times as much.
        </p>
        <p>
          With balancing on, each pool draws questions in proportion to its mix of easy, medium and hard. The target is the expected score of an average random paper. If a paper
          lands more than {band} from it, Athena swaps a drawn question for an undrawn one from the same pool with the same marks, so the total never changes, and repeats until
          the paper is inside the band or no swap brings it closer.
        </p>
        <p>
          When several swaps would help, Athena prefers one that lands inside the band, then one that keeps the difficulty label, and picks among the rest at random. Balanced
          papers therefore still differ from one another.
        </p>
      </div>
    </Section>
  );
}

/** A key figure: the number first, then the sentence that says what it measures. */
function Figure({ value, badge, children }: { value: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-title-1 tabular-nums text-label">{value}</span>
        {badge}
      </div>
      <p className="max-w-md text-subheadline text-label-secondary">{children}</p>
    </div>
  );
}

function ViewToggle({ value, onChange, label }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void; label: string }) {
  return (
    <SegmentedControl
      size="sm"
      aria-label={`${label}: chart or table`}
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'chart', label: 'Chart' },
        { value: 'table', label: 'Table' },
      ]}
    />
  );
}

function FairnessSkeleton() {
  return (
    <div role="status" aria-label="Loading the fairness report" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-full max-w-3xl" />
        <Skeleton className="h-7 w-2/3 max-w-xl" />
      </div>
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-[30rem] rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

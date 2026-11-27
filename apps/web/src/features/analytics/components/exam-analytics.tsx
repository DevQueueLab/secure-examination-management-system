'use client';

import { BarChart3, FileText, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type SortDirection } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { downloadPdf } from '../../results/api';
import { useExamAnalytics } from '../api';
import { fmtDuration, fmtMarks, fmtPercent, fmtRelative, fmtShare, fmtStat, plural } from '../format';
import { Meta } from './meta';
import type { ExamAnalytics, ItemAnalysis } from '../types';
import { ChartViewToggle, DistractorChart, Meter, ScoreHistogram } from './charts';
import { InsightBadge, InsightList, SEVERITY, worstInsight } from './insights';

type SortKey = 'number' | 'difficulty' | 'discrimination' | 'pointBiserial' | 'skipRate' | 'avgTimeMs' | 'findings';

const BAND: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  acceptable: 'Acceptable',
  questionable: 'Questionable',
  poor: 'Poor',
};

function ReliabilityTile({ r }: { r: ExamAnalytics['summary']['reliability'] }) {
  const name = r.method === 'KR-20' ? 'KR-20' : 'Cronbach’s alpha';
  return (
    <div className="flex min-w-0 flex-col bg-surface p-4">
      <div className="flex items-center gap-1.5 text-subheadline font-medium text-label-secondary">
        <span className="truncate">Reliability</span>
        <Tooltip
          content={`${name} over ${plural(r.items, 'question')}: how consistently the paper ranks candidates. 0.7 is acceptable for a class test, 0.8 good, 0.9 excellent.`}
        >
          <button type="button" aria-label="What reliability means" className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-label-tertiary outline-none hover:text-label focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus">
            <Info aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div className="numeral mt-2.5 text-[1.875rem] leading-[2.125rem] text-label">{r.value === null ? '–' : fmtStat(r.value)}</div>
      <div className="mt-0.5 text-footnote text-label-secondary">{r.value === null ? (r.note ?? 'Not enough data yet') : <Meta items={[BAND[r.band ?? ''], name]} />}</div>
    </div>
  );
}

function ItemDrilldown({ item, onClose }: { item: ItemAnalysis | null; onClose: () => void }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const d = item?.distractors;
  const rows = d
    ? [
        ...d.options.map((o) => ({ id: o.id, letter: o.letter, text: o.text, isKey: o.isKey, count: o.count, upperShare: o.upperShare, lowerShare: o.lowerShare })),
        ...(d.omitted.count
          ? [{ id: 'omitted', letter: '–', text: 'Left blank', isKey: false, count: d.omitted.count, upperShare: d.upperSize ? d.omitted.upper / d.upperSize : 0, lowerShare: d.lowerSize ? d.omitted.lower / d.lowerSize : 0 }]
          : []),
      ]
    : [];
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      {item && (
        <SheetContent
          title={
            <span className="flex gap-2.5">
              <span className="tabular-nums">{item.label}</span>
              <span>{item.title}</span>
            </span>
          }
          description={<Meta items={[item.typeLabel, item.category, `${fmtMarks(item.maxScore)} marks`]} />}
          className="w-[min(34rem,calc(100vw-1rem))]">
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {(
                [
                  ['Difficulty (p)', fmtStat(item.difficulty), 'Share of marks earned; higher is easier'],
                  ['Discrimination (D)', fmtStat(item.discrimination), 'Top 27% minus bottom 27%'],
                  ['Point-biserial (r)', fmtStat(item.pointBiserial), 'Item against the rest of the paper'],
                  ['Mean score', item.meanScore === null ? '–' : `${fmtMarks(item.meanScore)} / ${fmtMarks(item.maxScore)}`, item.meanPercent === null ? '' : fmtPercent(item.meanPercent, 1)],
                  ['Skipped', fmtShare(item.skipRate), `${item.answered} of ${item.attempts} answered`],
                  ['Average time', fmtDuration(item.avgTimeMs), item.flaggedRate ? `${fmtShare(item.flaggedRate)} flagged it` : 'Nobody flagged it'],
                ] as const
              ).map(([label, value, hint]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-footnote text-label-secondary">{label}</dt>
                  <dd className="text-title-3 tabular-nums text-label">{value}</dd>
                  {hint && <dd className="text-caption text-label-tertiary">{hint}</dd>}
                </div>
              ))}
            </dl>

            {item.upperMean !== null && item.lowerMean !== null && (
              <div className="flex flex-col gap-2">
                <h3 className="text-headline text-label">Top and bottom scorers</h3>
                <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-x-3 gap-y-2 text-subheadline">
                  <span className="text-label-secondary">Top 27%</span>
                  <Meter value={item.upperMean} label="Top 27% mean share of marks" />
                  <span className="text-right tabular-nums text-label">{fmtShare(item.upperMean)}</span>
                  <span className="text-label-secondary">Bottom 27%</span>
                  <Meter value={item.lowerMean} tone="neutral" label="Bottom 27% mean share of marks" />
                  <span className="text-right tabular-nums text-label">{fmtShare(item.lowerMean)}</span>
                </div>
              </div>
            )}

            {d && rows.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-headline text-label">How each option was chosen</h3>
                  <ChartViewToggle value={view} onChange={setView} label="Options" />
                </div>
                <DistractorChart
                  rows={rows}
                  upperSize={d.upperSize}
                  lowerSize={d.lowerSize}
                  view={view}
                  footer="The key should draw more of the top group than the bottom; a working distractor does the opposite. An option nobody picks is doing no work."
                />
              </div>
            )}

            {item.insights.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-headline text-label">Findings</h3>
                <InsightList insights={item.insights} />
              </div>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

export function ExamAnalyticsView({ examId }: { examId: string }) {
  const { data, isPending, error, refetch } = useExamAnalytics(examId);
  const { can } = useAuth();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'number', dir: 'asc' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const items = useMemo(() => {
    const list = [...(data?.items ?? [])];
    const sign = sort.dir === 'asc' ? 1 : -1;
    const val = (i: ItemAnalysis): number | null => {
      switch (sort.key) {
        case 'number':
          return i.number;
        case 'findings': {
          const w = worstInsight(i.insights);
          return w ? SEVERITY[w.severity].rank : 9;
        }
        default:
          return i[sort.key];
      }
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === null && y === null) return a.number - b.number;
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * (x - y) || a.number - b.number;
    });
  }, [data, sort]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    const denied = isApiError(error) && (error.isForbidden || error.isNotFound);
    return (
      <EmptyState
        icon={<BarChart3 />}
        art={denied ? 'shield' : undefined}
        title={denied ? 'You can’t see analytics for this exam' : 'Couldn’t load analytics'}
        description={denied ? 'Analytics are visible to the exam’s staff.' : errorMessage(error)}
        action={
          denied ? undefined : (
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const s = data.summary;
  if (s.n === 0) {
    return <EmptyState icon={<BarChart3 />} art="owl" title="No submissions to analyse" description="Item difficulty, discrimination and the score distribution appear after candidates submit. Examiner previews never count." />;
  }

  const sortProps = (key: SortKey, firstDir: 'asc' | 'desc' = 'desc') => ({
    sort: (sort.key === key ? sort.dir : false) as SortDirection,
    onSort: () => setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir })),
  });
  const open = data.items.find((i) => i.questionId === openId) ?? null;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadPdf(`/reports/exams/${examId}/pdf`, 'exam-report.pdf');
    } catch (e) {
      toast.error(errorMessage(e, 'The report could not be generated.'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-subheadline text-label-secondary">
          <Meta
            items={[
              `${plural(s.n, 'submission')}${s.pending ? `, ${s.pending} still being graded (their written answers count once graded)` : ''}`,
              'Sandbox attempts left out',
              `Updated ${fmtRelative(data.generatedAt)}`,
            ]}
          />
        </p>
        {can('reports.generate') && (
          <Button variant="gray" loading={downloading} onClick={() => void download()}>
            <FileText /> Download report
          </Button>
        )}
      </div>

      {/* One grouped strip with hairlines between the figures, not a row of separate cards. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator lg:grid-cols-5">
        <StatTile className="rounded-none" label="Mean" value={fmtPercent(s.percent.mean, 1)} hint={s.score.mean !== null ? `${fmtMarks(s.score.mean, 1)} of ${fmtMarks(s.maxScore)} marks` : undefined} />
        <StatTile className="rounded-none" label="Median" value={fmtPercent(s.percent.median, 1)} hint={s.percent.min !== null ? `Range ${fmtPercent(s.percent.min)}–${fmtPercent(s.percent.max)}` : undefined} />
        <StatTile className="rounded-none" label="Standard deviation" value={s.percent.sd === null ? '–' : fmtMarks(s.percent.sd, 1)} hint="Percentage points" />
        <ReliabilityTile r={s.reliability} />
        <StatTile label="Pass rate" value={s.passRate === null ? '–' : fmtPercent(s.passRate * 100)} hint={s.passPercent === null ? 'No pass mark set' : `${s.passed} of ${s.n} at ${fmtPercent(s.passPercent)} or above`} className="rounded-none max-lg:col-span-2" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <Card>
          <CardHeader title="Score distribution" description="Percent of total marks in ten-point bands" action={<ChartViewToggle value={view} onChange={setView} label="Score distribution" />} />
          <ScoreHistogram bins={s.histogram} passPercent={s.passPercent} view={view} height={232} />
        </Card>
        <Card>
          <CardHeader title="What to look at" description={data.insights.length ? 'Most serious first. Select one to open the question.' : undefined} />
          {data.insights.length ? (
            <InsightList insights={data.insights} onOpen={setOpenId} limit={6} />
          ) : (
            <p className="text-callout text-label-secondary">Nothing stands out: questions discriminate well and none look miskeyed.</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="items-heading" className="text-title-3 text-label">
            Questions
          </h2>
          <p className="mt-0.5 text-subheadline text-label-secondary">p is the share of marks earned (higher is easier). D compares the top and bottom 27%; below 0.2 the question barely separates them.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead {...sortProps('number', 'asc')} className="w-14">
                Q
              </TableHead>
              <TableHead>Question</TableHead>
              <TableHead {...sortProps('difficulty', 'asc')}>Difficulty p</TableHead>
              <TableHead numeric {...sortProps('discrimination', 'asc')}>
                D
              </TableHead>
              <TableHead numeric {...sortProps('pointBiserial', 'asc')}>
                r
              </TableHead>
              <TableHead numeric {...sortProps('skipRate')}>
                Skipped
              </TableHead>
              <TableHead numeric {...sortProps('avgTimeMs')}>
                Avg time
              </TableHead>
              <TableHead {...sortProps('findings', 'asc')}>Findings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const worst = worstInsight(i.insights);
              return (
                <TableRow key={i.questionId} interactive className="cursor-pointer" onClick={() => setOpenId(i.questionId)}>
                  <TableCell className="font-semibold tabular-nums">
                    <button type="button" onClick={() => setOpenId(i.questionId)} className="rounded-sm outline-none focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus" aria-label={`Open ${i.label} details`}>
                      {i.label}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <div className="truncate font-medium">{i.title}</div>
                    <div className="text-footnote text-label-secondary">
                      <Meta items={[i.typeLabel, i.category]} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Meter value={i.difficulty} label={`${i.label} difficulty`} className="w-20" />
                      <span className="tabular-nums">{fmtStat(i.difficulty)}</span>
                    </div>
                  </TableCell>
                  <TableCell numeric className={cn(i.discrimination !== null && i.discrimination < 0 && 'font-semibold text-danger-text')}>
                    {fmtStat(i.discrimination)}
                  </TableCell>
                  <TableCell numeric>{fmtStat(i.pointBiserial)}</TableCell>
                  <TableCell numeric>{fmtShare(i.skipRate)}</TableCell>
                  <TableCell numeric>{fmtDuration(i.avgTimeMs)}</TableCell>
                  <TableCell className="max-w-56">
                    {worst ? (
                      <div className="flex items-center gap-1.5">
                        <InsightBadge insight={worst} />
                        {i.insights.length > 1 && <span className="text-footnote tabular-nums text-label-tertiary">+{i.insights.length - 1}</span>}
                      </div>
                    ) : (
                      <span className="text-label-tertiary">–</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {(data.topics.length > 0 || data.sections.length > 1) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.topics.length > 0 && (
            <Card>
              <CardHeader title="Topic mastery" description="Share of available marks earned, by question category" />
              <ul className="flex flex-col gap-3">
                {data.topics.map((t) => (
                  <li key={t.category} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3">
                    <span className="truncate text-callout text-label">{t.category}</span>
                    <Meter value={(t.meanPercent ?? 0) / 100} label={`${t.category} mastery`} />
                    <span className="text-right text-callout tabular-nums text-label">{fmtPercent(t.meanPercent)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.sections.length > 1 && (
            <Card>
              <CardHeader title="Sections" description="Mean share of each section’s marks" />
              <ul className="flex flex-col gap-3">
                {data.sections.map((sec) => (
                  <li key={sec.sectionId} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3">
                    <span className="truncate text-callout text-label">{sec.title}</span>
                    <Meter value={(sec.meanPercent ?? 0) / 100} label={`${sec.title} mean`} />
                    <span className="text-right text-callout tabular-nums text-label">{fmtPercent(sec.meanPercent)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <ItemDrilldown item={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

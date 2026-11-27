'use client';

import { CircleCheck, EyeOff, FileText, Search, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, type SortDirection } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { ChartViewToggle, ScoreHistogram } from '../../analytics/components/charts';
import { fmtDate, fmtDateTime, fmtMarks, fmtPercent, plural } from '../../analytics/format';
import { downloadPdf, useExamResults } from '../api';
import type { ExamResults, ResultRow } from '../types';
import { ChecklistRow } from './checklist';
import { PublishDialog, UnpublishDialog } from './publish-dialogs';

type SortKey = 'name' | 'submitted' | 'score' | 'rank';

const SUBMIT_REASON: Record<string, string> = { timeout: 'Time ran out', proctor: 'Ended by proctor', offline_sync: 'Synced after offline' };

function usePdf() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, path: string, name: string) => {
    setBusy(key);
    try {
      await downloadPdf(path, name);
    } catch (e) {
      toast.error(errorMessage(e, 'The report could not be generated.'));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function StatusBanner({ data, onPublish, onUnpublish, canPublish, canReport, pdf }: { data: ExamResults; onPublish: () => void; onUnpublish: () => void; canPublish: boolean; canReport: boolean; pdf: ReturnType<typeof usePdf> }) {
  const { exam } = data;
  const published = exam.resultsStatus === 'published';
  const blockers = data.checklist.filter((c) => c.level === 'blocker').length;
  const report = canReport && (
    <Button variant="gray" loading={pdf.busy === 'exam'} onClick={() => void pdf.run('exam', `/reports/exams/${exam.id}/pdf`, 'exam-report.pdf')}>
      <FileText /> Exam report
    </Button>
  );
  return (
    <div className={cn('flex flex-col gap-4 rounded-xl px-5 py-4 sm:flex-row sm:items-center', published ? 'bg-success-tint' : 'bg-surface')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {published ? <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" /> : <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-label-tertiary" />}
        <div className="min-w-0">
          <p className="text-headline text-label">
            {published ? `Results visible to candidates since ${fmtDateTime(exam.resultsPublishedAt)}` : 'Candidates can’t see results yet'}
          </p>
          <p className="text-subheadline text-label-secondary">
            {published
              ? `Version ${exam.resultsVersion}${exam.resultsPublishedBy ? `, published by ${exam.resultsPublishedBy}` : ''}. Later grade changes reach candidates straight away.`
              : blockers
                ? `${plural(blockers, 'item')} to resolve before publishing. Scores stay private until you publish.`
                : 'Everything is ready. Publishing notifies every candidate.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {report}
        {canPublish &&
          (published ? (
            <Button variant="destructive-tinted" onClick={onUnpublish}>
              Unpublish
            </Button>
          ) : (
            <Button variant="filled" onClick={onPublish}>
              Review and publish
            </Button>
          ))}
      </div>
    </div>
  );
}

function compareRows(key: SortKey, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return (a: ResultRow, b: ResultRow) => {
    const nulls = (x: number | null, y: number | null) => (x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : sign * (x - y));
    switch (key) {
      case 'name':
        return sign * a.candidate.name.localeCompare(b.candidate.name);
      case 'submitted':
        return nulls(a.submittedAt ? Date.parse(a.submittedAt) : null, b.submittedAt ? Date.parse(b.submittedAt) : null);
      case 'score':
        return nulls(a.percent, b.percent);
      case 'rank':
        return nulls(a.rank, b.rank);
    }
  };
}

export function ExamResultsView({ examId }: { examId: string }) {
  const { data, isPending, error, refetch } = useExamResults(examId);
  const { can } = useAuth();
  const pdf = usePdf();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' });
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.rows ?? []).filter(
      (r) => !q || r.candidate.name.toLowerCase().includes(q) || r.candidate.email.toLowerCase().includes(q) || (r.candidate.rollNumber ?? '').toLowerCase().includes(q),
    );
    return list.sort(compareRows(sort.key, sort.dir));
  }, [data, query, sort]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (error || !data) {
    const denied = isApiError(error) && (error.isForbidden || error.isNotFound);
    return (
      <EmptyState
        icon={<Trophy />}
        title={denied ? 'You can’t see results for this exam' : 'Couldn’t load results'}
        description={denied ? 'Results are visible to the exam’s staff with analytics or publishing access.' : errorMessage(error)}
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

  const d = data.distribution;
  const canPublish = can('results.publish');
  const canReport = can('reports.generate');
  const submitted = data.rows.filter((r) => r.status === 'submitted');
  const pending = submitted.filter((r) => r.ungradedParts > 0).length;
  const sortProps = (key: SortKey) => ({
    sort: (sort.key === key ? sort.dir : false) as SortDirection,
    onSort: () => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'rank' ? 'asc' : 'desc' })),
  });

  return (
    <div className="flex flex-col gap-6">
      <StatusBanner data={data} canPublish={canPublish} canReport={canReport} pdf={pdf} onPublish={() => setPublishing(true)} onUnpublish={() => setUnpublishing(true)} />

      {!submitted.length ? (
        <EmptyState icon={<Trophy />} title="No submissions yet" description="Scores, the distribution and the publishing checklist appear once candidates submit." />
      ) : (
        <>
          {/* One grouped strip with hairlines between the figures, not a row of separate cards. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator lg:grid-cols-4">
            <StatTile className="rounded-none" label="Candidates" value={d.n} hint={pending ? `${pending} still being graded` : 'All graded'} />
            <StatTile className="rounded-none" label="Mean" value={fmtPercent(d.mean, 1)} hint={d.sd !== null ? `SD ${fmtMarks(d.sd, 1)} points` : undefined} />
            <StatTile className="rounded-none" label="Median" value={fmtPercent(d.median, 1)} hint={d.min !== null ? `Range ${fmtPercent(d.min)}–${fmtPercent(d.max)}` : undefined} />
            <StatTile className="rounded-none" label="Pass rate" value={d.passRate === null ? '–' : fmtPercent(d.passRate * 100)} hint={d.passPercent === null ? 'No pass mark set' : `${d.passed} of ${d.n} at ${fmtPercent(d.passPercent)} or above`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <Card>
              <CardHeader title="Score distribution" description="Percent of the total marks, in ten-point bands" action={<ChartViewToggle value={view} onChange={setView} label="Score distribution" />} />
              <ScoreHistogram bins={d.histogram} passPercent={d.passPercent} view={view} height={232} />
            </Card>
            <Card>
              <CardHeader title="Before publishing" description={data.exam.resultsStatus === 'published' ? 'Checked again for every change' : 'What candidates would see right now'} />
              <ul className="flex flex-col gap-3">
                {data.checklist
                  .filter((c) => c.level !== 'info' || c.count > 0)
                  .map((c) => (
                    <ChecklistRow key={c.key} item={c} />
                  ))}
              </ul>
            </Card>
          </div>

          <section aria-labelledby="results-table" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="results-table" className="text-title-3 text-label">
                Candidates
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-footnote tabular-nums text-label-secondary" aria-live="polite">
                  {rows.length === data.rows.length ? plural(rows.length, 'candidate') : `${rows.length} of ${data.rows.length}`}
                </span>
                <Input
                  type="search"
                  size="sm"
                  aria-label="Search candidates"
                  placeholder="Name, email or roll number"
                  containerClassName="w-64 max-sm:w-full"
                  leading={<Search />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead {...sortProps('name')}>Candidate</TableHead>
                  <TableHead {...sortProps('submitted')}>Submitted</TableHead>
                  <TableHead>Grading</TableHead>
                  <TableHead numeric {...sortProps('score')}>
                    Score
                  </TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead numeric {...sortProps('rank')}>
                    Rank
                  </TableHead>
                  {canReport && (
                    <TableHead>
                      <span className="sr-only">Report</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.attemptId}>
                    <TableCell>
                      <div className="font-medium">{r.candidate.name}</div>
                      <div className="text-footnote text-label-secondary">{r.candidate.rollNumber ?? r.candidate.email}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.status === 'submitted' ? (
                        <>
                          <div className="tabular-nums">{fmtDate(r.submittedAt)}</div>
                          {r.submitReason && SUBMIT_REASON[r.submitReason] && <div className="text-footnote text-label-secondary">{SUBMIT_REASON[r.submitReason]}</div>}
                        </>
                      ) : (
                        <Badge tone="info" size="sm" dot="pulse">
                          {r.status === 'awaiting_sync' ? 'Waiting to sync' : 'Still writing'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status !== 'submitted' ? (
                        <span className="text-label-tertiary">–</span>
                      ) : r.ungradedParts > 0 ? (
                        <Badge tone="warning" size="sm">
                          {plural(r.ungradedParts, 'part')} to grade
                        </Badge>
                      ) : (
                        <span className="text-subheadline text-label-secondary">Complete</span>
                      )}
                    </TableCell>
                    <TableCell numeric className="whitespace-nowrap">
                      {r.score === null ? (
                        <span className="text-label-tertiary">–</span>
                      ) : (
                        <>
                          <span className="font-medium">{fmtMarks(r.score)}</span>
                          <span className="text-label-secondary"> / {fmtMarks(r.maxScore)}</span>
                          <div className="text-footnote text-label-secondary">{fmtPercent(r.percent, 1)}</div>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.pass === null ? (
                        <span className="text-label-tertiary">–</span>
                      ) : (
                        <Badge tone={r.pass ? 'success' : 'danger'} size="sm">
                          {r.pass ? 'Pass' : 'Below pass'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell numeric>{r.rank ?? <span className="text-label-tertiary">–</span>}</TableCell>
                    {canReport && (
                      <TableCell className="w-10 pr-3">
                        {r.status === 'submitted' && (
                          <Tooltip content="Download report">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Download ${r.candidate.name}’s report`}
                              loading={pdf.busy === r.attemptId}
                              onClick={() => void pdf.run(r.attemptId, `/reports/attempts/${r.attemptId}/pdf`, 'result-report.pdf')}
                            >
                              <FileText />
                            </Button>
                          </Tooltip>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableEmpty colSpan={canReport ? 7 : 6}>
                    <EmptyState size="sm" surface={false} icon={<Search />} title="No candidate matches" description="Try part of a name, an email or a roll number." />
                  </TableEmpty>
                )}
              </TableBody>
            </Table>
          </section>
        </>
      )}

      <PublishDialog data={data} open={publishing} onOpenChange={setPublishing} />
      <UnpublishDialog data={data} open={unpublishing} onOpenChange={setUnpublishing} />
    </div>
  );
}

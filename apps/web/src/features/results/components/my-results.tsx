'use client';

import { Hourglass, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { fmtDate, fmtMarks, fmtPercent } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import { useMyResults } from '../api';

export function MyResults() {
  const { data, isPending, error, refetch } = useMyResults();
  const results = data ?? [];
  return (
    <>
      <PageHeader title="Results" subtitle="Scores appear here once your examiner publishes them. You’ll get a notification." />
      {isPending ? (
        <SkeletonRows rows={3} />
      ) : error ? (
        <EmptyState
          icon={<Trophy />}
          title="Couldn’t load your results"
          description={errorMessage(error)}
          action={
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !results.length ? (
        <EmptyState icon={<Trophy />} title="No results yet" description="Exams you submit appear here straight away. Your score shows after the examiner publishes results." />
      ) : (
        <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
          {results.map((r) => (
            <li key={r.attemptId}>
              <Link
                href={`/results/${r.attemptId}`}
                className="group flex items-center gap-4 px-4 py-4 outline-none transition-colors hover:bg-fill-secondary focus-visible:outline-[length:var(--focus-width)] focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-callout font-semibold text-label">{r.exam.title}</p>
                  <p className="mt-0.5 text-footnote text-label-secondary">
                    <Meta items={[r.exam.code, r.submittedAt ? `Submitted ${fmtDate(r.submittedAt)}` : 'Not submitted', r.published && r.publishedAt ? `Published ${fmtDate(r.publishedAt)}` : null]} />
                  </p>
                </div>
                {r.published && r.percent !== null ? (
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-title-3 text-label">{fmtPercent(r.percent, 1)}</p>
                      <p className="text-footnote tabular-nums text-label-secondary">
                        {fmtMarks(r.score)} / {fmtMarks(r.maxScore)}
                      </p>
                    </div>
                    {r.pass !== null && (
                      <Badge tone={r.pass ? 'success' : 'danger'} size="sm">
                        {r.pass ? 'Passed' : 'Below pass'}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <Badge tone="neutral">
                    <Hourglass aria-hidden /> Awaiting publication
                  </Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

'use client';

import { ShieldCheck } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage, isApiError } from '@/lib/api';
import { useIntegrityOverview } from '../api';
import { AuthorshipPanel } from './authorship-panel';
import { OverviewPanel } from './overview-panel';
import { PrivacyNote } from './privacy-note';
import { SimilarityPanel } from './similarity-panel';
import { TraceLeakButton } from './trace-leak-button';

type Tab = 'overview' | 'authorship' | 'similarity';
const TABS: Tab[] = ['overview', 'authorship', 'similarity'];

/** The exam's integrity review: Overview | Authorship | Similarity, with the tab and selection in the URL. */
export function IntegrityView({ examId }: { examId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview';
  const answer = params.get('answer');
  const pair = params.get('pair');

  const go = useCallback(
    (next: Partial<{ tab: Tab; answer: string | null; pair: string | null }>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (q.get('tab') === 'overview') q.delete('tab');
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const overview = useIntegrityOverview(examId);

  return (
    <div className="flex flex-col gap-5">
      <PrivacyNote priorityRule={overview.data?.priorityRule} />
      <Tabs value={tab} onValueChange={(v) => go({ tab: v as Tab })} className="gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Integrity views">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="authorship">Authorship</TabsTrigger>
            <TabsTrigger value="similarity">Similarity</TabsTrigger>
          </TabsList>
          <TraceLeakButton examId={examId} size="sm" label="Trace a leaked copy" />
        </div>

        {overview.isPending ? (
          <div role="status" aria-label="Loading integrity overview" className="flex flex-col gap-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <SkeletonRows rows={6} />
          </div>
        ) : overview.isError ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={isApiError(overview.error) && overview.error.isNotFound ? 'Not available' : 'Couldn’t load integrity review'}
            description={
              isApiError(overview.error) && overview.error.isNotFound
                ? 'This exam doesn’t exist or you are not on its staff.'
                : errorMessage(overview.error)
            }
            action={
              !(isApiError(overview.error) && overview.error.isNotFound) && (
                <Button onClick={() => overview.refetch()}>Try again</Button>
              )
            }
          />
        ) : (
          <>
            <TabsContent value="overview">
              <OverviewPanel
                data={overview.data}
                onReplay={(answerId) => go({ tab: 'authorship', answer: answerId })}
                onOpenPair={(a, b) => go({ tab: 'similarity', pair: a < b ? `${a}:${b}` : `${b}:${a}` })}
              />
            </TabsContent>
            <TabsContent value="authorship">
              <AuthorshipPanel data={overview.data} selected={answer} onSelect={(answerId) => go({ answer: answerId })} />
            </TabsContent>
            <TabsContent value="similarity">
              <SimilarityPanel examId={examId} selected={pair} onSelect={(pairId) => go({ pair: pairId })} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

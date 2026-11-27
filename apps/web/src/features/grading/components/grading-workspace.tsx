'use client';

import { EyeOff, PenLine } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage, isApiError } from '@/lib/api';
import { useGradingQueue } from '../api';
import { Grader } from './grader';
import { QueueList } from './queue-list';
import { RubricEditor } from './rubric-editor';

/** /exams/:examId/grading. The tab and the open question live in the URL so a grader can share or reload them. */
export function GradingWorkspace({ examId }: { examId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get('tab') === 'rubrics' ? 'rubrics' : 'queue';
  const questionId = params.get('q');
  const { data: queue, isPending, error, refetch } = useGradingQueue(examId);

  const go = (next: { tab?: 'queue' | 'rubrics'; q?: string | null }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.tab) {
      if (next.tab === 'queue') sp.delete('tab');
      else sp.set('tab', next.tab);
    }
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q);
      else sp.delete('q');
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (isPending) return <SkeletonRows rows={4} />;
  if (error || !queue) {
    const notStaff = isApiError(error) && (error.isNotFound || error.isForbidden);
    return (
      <EmptyState
        icon={<PenLine />}
        title={notStaff ? 'You aren’t grading this exam' : 'Couldn’t load the grading queue'}
        description={notStaff ? 'Ask the exam’s owner to add you as a grader.' : errorMessage(error)}
        action={
          notStaff ? undefined : (
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const grading = tab === 'queue' && !!questionId && queue.questions.some((q) => q.questionId === questionId);
  const { total, graded } = queue.progress;

  return (
    <Tabs value={tab} onValueChange={(v) => go({ tab: v as 'queue' | 'rubrics' })} className="gap-5">
      {!grading && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Grading">
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="rubrics">Rubrics</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3">
            {queue.anonymous && (
              <Badge tone="neutral">
                <EyeOff aria-hidden /> Anonymous grading
              </Badge>
            )}
            {total > 0 && (
              <div className="flex w-52 items-center gap-2.5">
                <span className="whitespace-nowrap text-subheadline font-medium tabular-nums text-label">
                  Graded {graded}/{total}
                </span>
                <MarksRule settle size="sm" marker="fill" labels="none" tone={graded === total ? 'gold' : 'accent'} value={graded} max={total} label={`Graded ${graded} of ${total} answers`} valueText={`${graded} of ${total}`} />
              </div>
            )}
          </div>
        </div>
      )}

      <TabsContent value="queue">
        {grading ? (
          <Grader key={questionId} examId={examId} questionId={questionId!} questions={queue.questions} onBack={() => go({ q: null })} onSelectQuestion={(q) => go({ q })} />
        ) : (
          <QueueList examId={examId} queue={queue} onOpen={(q) => go({ q })} onRubric={(q) => go({ tab: 'rubrics', q })} />
        )}
      </TabsContent>
      <TabsContent value="rubrics">
        <RubricEditor examId={examId} questions={queue.questions} questionId={questionId} onSelectQuestion={(q) => go({ q })} />
      </TabsContent>
    </Tabs>
  );
}

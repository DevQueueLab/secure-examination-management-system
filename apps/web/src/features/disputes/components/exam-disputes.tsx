'use client';

import { Gavel, Link2, Scale, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Section } from '@/components/ui/section';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { useExamDisputeSummary, useInbox, useRemedies } from '../api';
import { plural } from '../format';
import type { ExamDisputeSummary } from '../types';
import { LedgerExplorer } from './ledger-explorer';
import { RemedyHistory, RemedyWizard } from './remedy-wizard';
import { DisputeTable } from './staff-inbox';

type Tab = 'disputes' | 'remedies' | 'ledger';

/** The exam's dispute health in one strip: plain numbers, each with what it means. */
function Tiles({ s }: { s: ExamDisputeSummary }) {
  const decided = s.counts.outcomes.upheld + s.counts.outcomes.partially_upheld + s.counts.outcomes.rejected;
  const hours = s.timeliness.avgResolutionHours;
  const stats = [
    { label: 'Waiting for a decision', value: s.counts.active, hint: s.counts.overdue ? `${s.counts.overdue} past the five-day deadline` : s.counts.active ? 'All within the deadline' : 'Nothing waiting' },
    { label: 'Decided', value: decided, hint: decided ? `${s.counts.outcomes.upheld + s.counts.outcomes.partially_upheld} upheld, ${s.counts.outcomes.rejected} not upheld` : 'No decisions yet' },
    {
      label: 'Time to decide',
      value: hours === null ? '–' : hours < 1 ? 'Under an hour' : `${hours} h`,
      hint: s.timeliness.onTimePercent === null ? 'Average, once decisions exist' : `${s.timeliness.onTimePercent}% decided on time`,
    },
    { label: 'Question remedies', value: s.remedies.count, hint: s.remedies.count ? `${plural(s.remedies.affectedAttempts, 'paper')} re-marked` : 'None applied' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-y-4 border-y border-separator py-4 lg:grid-cols-4 lg:divide-x lg:divide-separator">
      {stats.map((t) => (
        <div key={t.label} className="flex flex-col gap-0.5 pr-4 lg:px-5 lg:first:pl-0 lg:last:pr-0">
          <dt className="text-footnote text-label-secondary">{t.label}</dt>
          <dd className="text-title-2 font-semibold tabular-nums text-label">{t.value}</dd>
          <dd className="text-footnote text-label-secondary">{t.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function DisputesTab({ examId, s, onFix }: { examId: string; s: ExamDisputeSummary; onFix: (questionId: string) => void }) {
  const inbox = useInbox({ examId, status: 'all' });
  // Several disputes on one question, or any saying the question itself is wrong, point at the question.
  const hot = s.hotQuestions.filter((h) => h.active > 0 && (h.total > 1 || h.questionProblem > 0));
  return (
    <div className="flex flex-col gap-8">
      {hot.length > 0 && s.canApplyRemedies && (
        <Section title="Questions drawing disputes" description="Several candidates disputing one question usually means the question, not the marking. Fixing it once is fairer than deciding each case.">
          <ul className="divide-y divide-separator border-y border-separator">
            {hot.map((h) => (
              <li key={h.questionId} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-callout font-semibold text-label">
                    {h.label}: {h.title}
                  </p>
                  <p className="text-footnote text-label-secondary">
                    {plural(h.total, 'dispute')}
                    {`, ${h.active} still open`}
                  </p>
                </div>
                <Button variant="tinted" size="sm" onClick={() => onFix(h.questionId)}>
                  Fix for everyone
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Disputes on this exam">
        {inbox.isPending ? (
          <SkeletonRows rows={4} />
        ) : inbox.error ? (
          <EmptyState icon={<Scale />} title="Couldn’t load disputes" description={errorMessage(inbox.error)} />
        ) : (
          <DisputeTable
            rows={inbox.data.items}
            showExam={false}
            empty={
              <EmptyState
                surface={false}
                size="sm"
                icon={<Gavel />}
                title="No disputes for this exam"
                description="When a candidate questions a mark or a question, it arrives here with their answer and marks frozen as they stood."
              />
            }
          />
        )}
      </Section>
    </div>
  );
}

function RemediesTab({ examId, initialQuestionId, disputeId }: { examId: string; initialQuestionId: string | null; disputeId: string | null }) {
  const { data, isPending, error, refetch } = useRemedies(examId);
  if (isPending) return <SkeletonRows rows={5} />;
  if (error || !data) {
    return (
      <EmptyState
        icon={<Users />}
        title="Couldn’t load the questions"
        description={errorMessage(error)}
        action={
          <Button variant="tinted" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Section title="Fix a question for everyone" description="When a key is wrong or a question was unclear, re-mark every candidate the same way instead of deciding disputes one at a time. Nobody’s score goes down.">
        <RemedyWizard key={initialQuestionId ?? 'none'} examId={examId} data={data} initialQuestionId={initialQuestionId} disputeId={disputeId} />
      </Section>
      <Section title="Applied remedies" as="h2">
        <RemedyHistory remedies={data.remedies} />
      </Section>
    </div>
  );
}

/** The exam's Disputes tab: health at a glance, every dispute, question remedies and the ledger behind them. */
export function ExamDisputes({ examId, remedyQuestionId, disputeId }: { examId: string; remedyQuestionId: string | null; disputeId: string | null }) {
  const summary = useExamDisputeSummary(examId);
  const [tab, setTab] = useState<Tab>(remedyQuestionId ? 'remedies' : 'disputes');
  const [fixing, setFixing] = useState<string | null>(remedyQuestionId);

  if (summary.isPending) return <SkeletonRows rows={5} />;
  if (summary.error || !summary.data) {
    return (
      <EmptyState
        icon={<Gavel />}
        title="Couldn’t load disputes for this exam"
        description={errorMessage(summary.error)}
        action={
          <Button variant="tinted" onClick={() => void summary.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const s = summary.data;
  return (
    <div className="flex flex-col gap-6">
      <Tiles s={s} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} variant="underline">
        <TabsList>
          <TabsTrigger value="disputes">
            Disputes
            {s.counts.active > 0 && (
              <Badge tone="info" size="sm" className="ml-1.5">
                {s.counts.active}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="remedies">Question remedies</TabsTrigger>
          <TabsTrigger value="ledger">
            <Link2 aria-hidden className="mr-1 size-3.5" />
            Ledger
          </TabsTrigger>
        </TabsList>
        <TabsContent value="disputes" className="pt-6">
          <DisputesTab
            examId={examId}
            s={s}
            onFix={(qid) => {
              setFixing(qid);
              setTab('remedies');
            }}
          />
        </TabsContent>
        <TabsContent value="remedies" className="pt-6">
          <RemediesTab examId={examId} initialQuestionId={fixing} disputeId={fixing === remedyQuestionId ? disputeId : null} />
        </TabsContent>
        <TabsContent value="ledger" className="pt-6">
          <LedgerExplorer data={s} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import { AlarmClockPlus, Activity, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useClarifications, useIncidents } from '../api';
import { useServerNow } from '../clock';
import type { LiveAttempt, LiveMonitor, RosterEntry, StaffClarification } from '../types';
import { useLiveMonitor } from '../use-live-monitor';
import { AnnouncementsPanel } from './announcements-panel';
import { CandidateDrawer, type DrawerActions } from './candidate-drawer';
import { ClarificationsPanel } from './clarifications-panel';
import { IncidentsPanel } from './incidents-panel';
import { ExtendTimeDialog, ForceSubmitDialog, MessageDialog } from './intervention-dialogs';
import { LiveIndicator, isLive } from './live-bits';
import { BulkExtendDialog, OutageBanner } from './outage-banner';
import { CohortCompletion, ExamWindow, InstrumentPanel, KpiStrip, type KpiCounts, type KpiKey } from './overview';
import { NO_FILTERS, Roster, type RosterFilters } from './roster';

type Tab = 'roster' | 'indicators' | 'clarifications' | 'announcements';

const KPI_FILTERS: Record<KpiKey, Partial<RosterFilters>> = {
  in_progress: { status: 'in_progress' },
  submitted: { status: 'submitted' },
  not_started: { status: 'not_started' },
  online: { connection: 'online' },
  incidents: { openOnly: true },
};

/** Which counter the filters correspond to exactly, so the strip and the toolbar never disagree. */
function kpiOf(f: RosterFilters): KpiKey | null {
  for (const [key, preset] of Object.entries(KPI_FILTERS) as [KpiKey, Partial<RosterFilters>][]) {
    const target = { ...NO_FILTERS, q: f.q, ...preset };
    if (target.status === f.status && target.connection === f.connection && target.priority === f.priority && target.openOnly === f.openOnly) return key;
  }
  return null;
}

/** The counters, recomputed every second from the cached roster so they agree with the rows below. */
function LiveKpis({ data, active, onToggle }: { data: LiveMonitor; active: KpiKey | null; onToggle: (k: KpiKey) => void }) {
  const now = useServerNow();
  const counts: KpiCounts = useMemo(() => {
    const inProgress = data.attempts.filter((a) => a.status === 'in_progress');
    const online = inProgress.filter((a) => isLive(a, now)).length;
    const submitted = data.attempts.filter((a) => a.status === 'submitted');
    const withOpen = data.attempts.filter((a) => a.incidents.open > 0);
    // A candidate who has not started will still answer a full paper, so they count at the usual paper length.
    const lengths = data.attempts.map((a) => a.itemCount).filter((n) => n > 0).sort((x, y) => x - y);
    const usual = lengths.length ? lengths[Math.floor(lengths.length / 2)]! : 0;
    return {
      enrolled: data.summary.enrolled,
      inProgress: inProgress.length,
      submitted: submitted.length,
      autoSubmitted: submitted.filter((a) => a.submitReason === 'timeout').length,
      notStarted: data.notStarted.length,
      online,
      offline: inProgress.length - online,
      openIncidents: withOpen.reduce((sum, a) => sum + a.incidents.open, 0),
      candidatesWithOpen: withOpen.length,
      answered: data.attempts.reduce((sum, a) => sum + Math.min(a.answeredCount, a.itemCount), 0),
      capacity: data.attempts.reduce((sum, a) => sum + a.itemCount, 0) + data.notStarted.length * usual,
    };
  }, [data, now]);
  return (
    <>
      <KpiStrip counts={counts} active={active} onToggle={onToggle} />
      <CohortCompletion answered={counts.answered} capacity={counts.capacity} />
    </>
  );
}

function dismissedKey(examId: string) {
  return `athena:monitor:${examId}:dismissed-outage`;
}
function readDismissed(examId: string): string | null {
  try {
    return sessionStorage.getItem(dismissedKey(examId));
  } catch {
    return null;
  }
}

function MonitorSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading the live monitor">
      <Skeleton className="h-[13.5rem] w-full rounded-2xl" />
      <Skeleton className="h-8 w-80 rounded-lg" />
      <SkeletonRows rows={6} />
    </div>
  );
}

/** FR-3.6 live examination monitoring: the proctor's control room for one exam. */
export function MonitorView({ examId }: { examId: string }) {
  const { can } = useAuth();
  const canIntervene = can('monitor.intervene');
  const [tab, setTab] = useState<Tab>('roster');
  const [filters, setFilters] = useState<RosterFilters>(NO_FILTERS);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extendFor, setExtendFor] = useState<LiveAttempt | null>(null);
  const [submitFor, setSubmitFor] = useState<LiveAttempt | null>(null);
  const [messageTo, setMessageTo] = useState<{ userId: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<'extend' | 'submit' | 'message' | 'bulk' | 'bulk-outage' | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => (typeof window === 'undefined' ? null : readDismissed(examId)));

  const onClarification = useCallback((c: StaffClarification) => {
    toast(`${c.candidate.name} asked a question`, {
      description: c.question.length > 140 ? `${c.question.slice(0, 140)}…` : c.question,
      action: { label: 'Answer', onClick: () => setTab('clarifications') },
      duration: 10_000,
    });
  }, []);

  const live = useLiveMonitor(examId, { onClarification });
  const clarifications = useClarifications(examId);
  const incidents = useIncidents(examId);
  const data = live.data;

  const entries: RosterEntry[] = useMemo(
    () =>
      data
        ? [
            ...data.attempts.map((attempt) => ({ kind: 'attempt' as const, key: attempt.attemptId, attempt })),
            ...data.notStarted.map((candidate) => ({ kind: 'not-started' as const, key: `user:${candidate.userId}`, candidate })),
          ]
        : [],
    [data],
  );
  const drawerEntry = entries.find((e) => e.key === drawerKey) ?? null;
  const candidates = useMemo(
    () =>
      entries
        .map((e) => (e.kind === 'attempt' ? e.attempt.candidate : e.candidate))
        .map((c) => ({ userId: c.userId, name: c.name, rollNumber: c.rollNumber }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );

  const actions: DrawerActions = useMemo(
    () => ({
      onExtend: (a) => {
        setExtendFor(a);
        setDialog('extend');
      },
      onForceSubmit: (a) => {
        setSubmitFor(a);
        setDialog('submit');
      },
      onMessage: (t) => {
        setMessageTo(t);
        setDialog('message');
      },
    }),
    [],
  );

  const openEntry = (e: RosterEntry) => {
    setDrawerKey(e.key);
    setDrawerOpen(true);
  };
  const openAttempt = (attemptId: string) => {
    setDrawerKey(attemptId);
    setDrawerOpen(true);
  };

  const activeKpi = kpiOf(filters);
  const toggleKpi = (k: KpiKey) => {
    setTab('roster');
    setFilters((f) => (activeKpi === k ? { ...NO_FILTERS, q: f.q } : { ...NO_FILTERS, q: f.q, ...KPI_FILTERS[k] }));
  };

  const suggestion = data?.suggestion ?? null;
  const showOutage = !!suggestion && suggestion.windowStart !== dismissed;
  const dismissOutage = () => {
    if (!suggestion) return;
    setDismissed(suggestion.windowStart);
    try {
      sessionStorage.setItem(dismissedKey(examId), suggestion.windowStart);
    } catch {
      /* private mode: dismissal lasts for this page only */
    }
  };

  if (live.isPending) return <MonitorSkeleton />;
  // Only a failed first load replaces the page. A failed refresh keeps the last data on screen (see LiveIndicator),
  // so a server restart never takes the roster, an open drawer or a half-written dialog away from the proctor.
  if (!data) {
    const notFound = isApiError(live.error) && (live.error.isNotFound || live.error.isForbidden);
    return (
      <EmptyState
        icon={<Activity />}
        title={notFound ? 'You can’t monitor this exam' : 'Couldn’t load the live monitor'}
        description={notFound ? 'Live monitoring is open to the exam’s staff: its examiners and assigned proctors.' : errorMessage(live.error)}
        action={
          !notFound && (
            <Button onClick={() => live.refetch()}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          )
        }
      />
    );
  }

  const waiting = (clarifications.data ?? []).filter((c) => !c.answer).length;
  const openIndicators = (incidents.data?.incidents ?? []).filter((e) => !e.review || e.review.status === 'open').length;
  const inProgress = data.attempts.filter((a) => a.status === 'in_progress').length;

  return (
    <div className="flex flex-col gap-4">
      {showOutage && suggestion && (
        <OutageBanner
          key={suggestion.windowStart}
          examId={examId}
          suggestion={suggestion}
          attempts={data.attempts}
          canIntervene={canIntervene}
          onAdjust={() => setDialog('bulk-outage')}
          onDismiss={dismissOutage}
        />
      )}

      <InstrumentPanel
        status={
          <>
            <LiveIndicator connected={live.connected} updatedAt={live.dataUpdatedAt} unreachable={live.isRefetchError} />
            <ExamWindow exam={data.exam} />
          </>
        }
      >
        <LiveKpis data={data} active={activeKpi} onToggle={toggleKpi} />
      </InstrumentPanel>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="max-w-full overflow-x-auto scrollbar-none" aria-label="Monitor sections">
            <TabsTrigger value="roster">Roster</TabsTrigger>
            <TabsTrigger value="indicators">
              Indicators
              {openIndicators > 0 && <span className="tabular-nums text-label-secondary">{openIndicators}</span>}
            </TabsTrigger>
            <TabsTrigger value="clarifications">
              <span className="hidden sm:inline">Clarifications</span>
              <span className="sm:hidden">Questions</span>
              {waiting > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-caption font-semibold text-on-accent tabular-nums">
                  {waiting}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="announcements">
              <span className="hidden sm:inline">Announcements</span>
              <span className="sm:hidden">Announce</span>
            </TabsTrigger>
          </TabsList>
          {canIntervene && tab === 'roster' && inProgress > 0 && (
            <Button variant="gray" size="sm" onClick={() => setDialog('bulk')}>
              <AlarmClockPlus aria-hidden />
              Extend everyone…
            </Button>
          )}
        </div>

        <TabsContent value="roster">
          <Roster entries={entries} filters={filters} onFiltersChange={setFilters} onOpen={openEntry} canIntervene={canIntervene} actions={actions} />
        </TabsContent>
        <TabsContent value="indicators">
          <IncidentsPanel examId={examId} attempts={data.attempts} canReview={canIntervene} onOpenCandidate={openAttempt} />
        </TabsContent>
        <TabsContent value="clarifications">
          <ClarificationsPanel examId={examId} canAnswer={canIntervene} />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsPanel examId={examId} candidates={candidates} canSend={canIntervene} />
        </TabsContent>
      </Tabs>

      <CandidateDrawer examId={examId} entry={drawerEntry} open={drawerOpen && !!drawerEntry} onOpenChange={setDrawerOpen} canIntervene={canIntervene} actions={actions} />
      <ExtendTimeDialog examId={examId} attempt={extendFor} open={dialog === 'extend'} onOpenChange={(o) => setDialog(o ? 'extend' : null)} />
      <ForceSubmitDialog examId={examId} attempt={submitFor} open={dialog === 'submit'} onOpenChange={(o) => setDialog(o ? 'submit' : null)} />
      <MessageDialog examId={examId} target={messageTo} open={dialog === 'message'} onOpenChange={(o) => setDialog(o ? 'message' : null)} />
      {/* "Change…" on the banner starts from the outage group; "Extend everyone…" means everyone. */}
      <BulkExtendDialog
        examId={examId}
        open={dialog === 'bulk' || dialog === 'bulk-outage'}
        onOpenChange={(o) => !o && setDialog(null)}
        suggestion={dialog === 'bulk-outage' ? suggestion : null}
        inProgress={inProgress}
      />
    </div>
  );
}

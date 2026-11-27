'use client';

import { RT, type EventSeverity, type IncidentReviewStatus } from '@athena/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useSocketRoom } from '@/lib/socket';
import { applyReviewedEvent, monitorKeys } from './api';
import { serverNow, syncServerClock } from './clock';
import type { LiveAttempt, LiveMonitor, MonitorEvent, StaffClarification } from './types';

/** Push payloads, read defensively: the engine owns them and they may carry more or fewer fields. */
interface ProgressPush {
  attemptId: string;
  answeredCount?: number;
  itemCount?: number;
  flaggedCount?: number;
  lastSeenAt?: string;
  online?: boolean;
  rttMs?: number | null;
}
interface ConnectivityPush {
  attemptId: string;
  online: boolean;
}
interface ExtendedPush {
  attemptId: string;
  deadlineAt?: string;
}
interface IncidentPush {
  attemptId: string;
  /** Our MonitorEvent shape, or the engine's raw event row (flat reviewStatus). */
  event?: Partial<MonitorEvent> & { reviewStatus?: IncidentReviewStatus | null };
}

const POLL_LIVE_MS = 30_000;
const POLL_FALLBACK_MS = 10_000;

function recount(prev: LiveMonitor, attempts: LiveAttempt[]): LiveMonitor['summary'] {
  const inProgress = attempts.filter((a) => a.status === 'in_progress');
  return {
    ...prev.summary,
    inProgress: inProgress.length,
    awaitingSync: attempts.filter((a) => a.status === 'awaiting_sync').length,
    submitted: attempts.filter((a) => a.status === 'submitted').length,
    onlineNow: inProgress.filter((a) => a.online).length,
    openIncidents: attempts.reduce((sum, a) => sum + a.incidents.open, 0),
  };
}

function toEvent(push: IncidentPush, attempt: LiveAttempt | undefined): MonitorEvent | null {
  const e = push.event;
  if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') return null;
  const severity: EventSeverity = e.severity ?? 'info';
  return {
    id: e.id,
    attemptId: push.attemptId,
    candidate: e.candidate ?? attempt?.candidate ?? { userId: '', name: 'Candidate', rollNumber: null, initials: '?' },
    type: e.type,
    severity,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date(serverNow()).toISOString(),
    clientTs: typeof e.clientTs === 'string' ? e.clientTs : null,
    payload: e.payload ?? {},
    review: e.review ?? (severity === 'info' ? null : { status: e.reviewStatus ?? 'open', note: null, reviewedAt: null, reviewedBy: null }),
  };
}

/**
 * The control room's data: GET /live, kept current by socket pushes merged into the query cache.
 * Pushes are a speed-up only: the query polls every 10 s while the socket is down (30 s while it is up),
 * and anything the cache cannot patch precisely (a new attempt, a submission) triggers a debounced refetch.
 */
export function useLiveMonitor(examId: string, options: { onClarification?: (c: StaffClarification) => void } = {}) {
  const qc = useQueryClient();
  const key = monitorKeys.live(examId);
  // Latest callback without re-subscribing the socket handlers; written after render, read only in push handlers.
  const onClarification = useRef(options.onClarification);
  useEffect(() => {
    onClarification.current = options.onClarification;
  });

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const soon = useCallback((id: string, fn: () => void, ms = 1200) => {
    const t = timers.current;
    if (t.has(id)) return;
    t.set(
      id,
      setTimeout(() => {
        t.delete(id);
        fn();
      }, ms),
    );
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const refetchLive = () => soon('live', () => void qc.invalidateQueries({ queryKey: key }));

  const patchAttempt = (attemptId: string, patch: (a: LiveAttempt) => LiveAttempt) => {
    let known = false;
    qc.setQueryData<LiveMonitor>(key, (prev) => {
      if (!prev) return prev;
      const attempts = prev.attempts.map((a) => {
        if (a.attemptId !== attemptId) return a;
        known = true;
        return patch(a);
      });
      return known ? { ...prev, attempts, summary: recount(prev, attempts) } : prev;
    });
    if (!known) refetchLive();
  };

  const nowIso = () => new Date(serverNow()).toISOString();

  const { connected } = useSocketRoom(
    { kind: 'exam-staff', examId },
    {
      [RT.attemptProgress]: (p: ProgressPush) =>
        patchAttempt(p.attemptId, (a) => ({
          ...a,
          answeredCount: p.answeredCount ?? a.answeredCount,
          itemCount: p.itemCount ?? a.itemCount,
          flaggedCount: p.flaggedCount ?? a.flaggedCount,
          lastSeenAt: p.lastSeenAt ?? nowIso(),
          online: p.online ?? true,
          rttMs: p.rttMs === undefined ? a.rttMs : p.rttMs,
        })),
      [RT.attemptConnectivity]: (p: ConnectivityPush) =>
        patchAttempt(p.attemptId, (a) => ({ ...a, online: p.online, lastSeenAt: p.online ? nowIso() : a.lastSeenAt })),
      [RT.attemptIncident]: (p: IncidentPush) => {
        const live = qc.getQueryData<LiveMonitor>(key);
        const event = toEvent(p, live?.attempts.find((a) => a.attemptId === p.attemptId));
        if (event) {
          const seen = live?.recentEvents.some((e) => e.id === event.id) ?? false;
          if (seen || (event.review && event.review.status !== 'open')) {
            // A review outcome from another proctor: update the lists now, recount from the server.
            applyReviewedEvent(qc, examId, event);
            refetchLive();
          } else {
            qc.setQueryData<LiveMonitor>(key, (prev) => {
              if (!prev) return prev;
              const attempts = prev.attempts.map((a) =>
                a.attemptId !== event.attemptId || event.severity === 'info'
                  ? a
                  : {
                      ...a,
                      incidents: {
                        total: a.incidents.total + 1,
                        open: a.incidents.open + 1,
                        byType: { ...a.incidents.byType, [event.type]: (a.incidents.byType[event.type] ?? 0) + 1 },
                      },
                    },
              );
              const recentEvents = event.type === 'announcement_read' ? prev.recentEvents : [event, ...prev.recentEvents].slice(0, 50);
              return { ...prev, attempts, recentEvents, summary: recount(prev, attempts) };
            });
          }
        } else {
          refetchLive();
        }
        soon('incidents', () => void qc.invalidateQueries({ queryKey: monitorKeys.incidents(examId) }));
        soon(`timeline:${p.attemptId}`, () => void qc.invalidateQueries({ queryKey: monitorKeys.timeline(examId, p.attemptId) }));
      },
      [RT.timeExtended]: (p: ExtendedPush) => {
        const next = typeof p?.deadlineAt === 'string' ? p.deadlineAt : null;
        if (next) {
          // Derived from the deadline difference, so a push that arrives after our own refetch adds nothing twice.
          patchAttempt(p.attemptId, (a) => {
            const added = Math.max(0, Math.round((Date.parse(next) - Date.parse(a.deadlineAt)) / 1000));
            return {
              ...a,
              deadlineAt: next,
              timeExtensionSeconds: a.timeExtensionSeconds + added,
              remainingSeconds: a.remainingSeconds === null ? null : a.remainingSeconds + added,
            };
          });
        } else refetchLive();
        soon(`timeline:${p.attemptId}`, () => void qc.invalidateQueries({ queryKey: monitorKeys.timeline(examId, p.attemptId) }));
      },
      [RT.attemptStarted]: () => refetchLive(),
      [RT.attemptSubmitted]: (p: { attemptId?: string }) => {
        if (p?.attemptId) patchAttempt(p.attemptId, (a) => ({ ...a, status: 'submitted', submittedAt: a.submittedAt ?? nowIso(), online: false, remainingSeconds: null }));
        refetchLive();
      },
      [RT.clarificationAsked]: (c: StaffClarification) => {
        void qc.invalidateQueries({ queryKey: monitorKeys.clarifications(examId) });
        if (c && typeof c.question === 'string') onClarification.current?.(c);
      },
      [RT.clarificationAnswered]: () => void qc.invalidateQueries({ queryKey: monitorKeys.clarifications(examId) }),
      [RT.announcement]: () => void qc.invalidateQueries({ queryKey: monitorKeys.announcements(examId) }),
    },
  );

  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const data = await api.get<LiveMonitor>(`/monitoring/exams/${examId}/live`, { signal });
      syncServerClock(data.serverNow);
      return data;
    },
    staleTime: 3_000,
    refetchInterval: connected ? POLL_LIVE_MS : POLL_FALLBACK_MS,
    refetchOnWindowFocus: true,
  });

  return { ...query, connected };
}

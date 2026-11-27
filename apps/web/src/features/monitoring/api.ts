'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AttemptTimeline,
  BulkExtensionResult,
  ExtensionResult,
  IncidentList,
  LiveMonitor,
  MonitorEvent,
  ReviewOutcome,
  StaffAnnouncement,
  StaffClarification,
} from './types';

const base = '/monitoring';

export const monitorKeys = {
  all: (examId: string) => ['monitoring', examId] as const,
  live: (examId: string) => ['monitoring', examId, 'live'] as const,
  timeline: (examId: string, attemptId: string) => ['monitoring', examId, 'timeline', attemptId] as const,
  incidents: (examId: string) => ['monitoring', examId, 'incidents'] as const,
  announcements: (examId: string) => ['monitoring', examId, 'announcements'] as const,
  clarifications: (examId: string) => ['monitoring', examId, 'clarifications'] as const,
};

export function useTimeline(examId: string, attemptId: string | null) {
  return useQuery({
    queryKey: monitorKeys.timeline(examId, attemptId ?? 'none'),
    queryFn: () => api.get<AttemptTimeline>(`${base}/attempts/${attemptId}/timeline`),
    enabled: !!attemptId,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function useIncidents(examId: string) {
  return useQuery({
    queryKey: monitorKeys.incidents(examId),
    queryFn: () => api.get<IncidentList>(`${base}/exams/${examId}/incidents`),
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

export function useAnnouncements(examId: string) {
  return useQuery({
    queryKey: monitorKeys.announcements(examId),
    queryFn: async () => (await api.get<{ items: StaffAnnouncement[] }>(`${base}/exams/${examId}/announcements`)).items,
    staleTime: 5_000,
    // Read receipts arrive by polling; they matter for a minute or two after sending.
    refetchInterval: 15_000,
  });
}

export function useClarifications(examId: string) {
  return useQuery({
    queryKey: monitorKeys.clarifications(examId),
    queryFn: async () => (await api.get<{ items: StaffClarification[] }>(`${base}/exams/${examId}/clarifications`)).items,
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

/** Refreshes everything that can change after an intervention on one attempt. */
function useRefreshAttempt(examId: string) {
  const qc = useQueryClient();
  return (attemptId?: string) => {
    void qc.invalidateQueries({ queryKey: monitorKeys.live(examId) });
    if (attemptId) void qc.invalidateQueries({ queryKey: monitorKeys.timeline(examId, attemptId) });
  };
}

export function useSendAnnouncement(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; priority: 'normal' | 'urgent'; targetUserId?: string | null }) =>
      api.post<StaffAnnouncement>(`${base}/exams/${examId}/announcements`, input),
    onSuccess: (created) => {
      qc.setQueryData<StaffAnnouncement[]>(monitorKeys.announcements(examId), (prev) => [created, ...(prev ?? []).filter((a) => a.id !== created.id)]);
    },
  });
}

export function useAnswerClarification(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; answer: string; broadcast: boolean }) =>
      api.post<StaffClarification>(`${base}/clarifications/${input.id}/answer`, { answer: input.answer, broadcast: input.broadcast }),
    onSuccess: (updated) => {
      qc.setQueryData<StaffClarification[]>(monitorKeys.clarifications(examId), (prev) => prev?.map((c) => (c.id === updated.id ? updated : c)));
      void qc.invalidateQueries({ queryKey: monitorKeys.clarifications(examId) });
    },
  });
}

export function useExtendAttempt(examId: string) {
  const refresh = useRefreshAttempt(examId);
  return useMutation({
    mutationFn: (input: { attemptId: string; minutes: number; reason: string }) =>
      api.post<ExtensionResult>(`${base}/attempts/${input.attemptId}/extend`, { minutes: input.minutes, reason: input.reason }),
    onSuccess: (r) => refresh(r.attemptId),
  });
}

export function useExtendAll(examId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshAttempt(examId);
  return useMutation({
    mutationFn: (input: { minutes: number; reason: string; onlyAffected: boolean }) =>
      api.post<BulkExtensionResult>(`${base}/exams/${examId}/extend-all`, input),
    onSuccess: (r) => {
      // Once everyone in the outage has been given time, the server stops suggesting it. Drop the banner now
      // instead of waiting for the refetch below.
      const done = new Set(r.extended.map((e) => e.attemptId));
      qc.setQueryData<LiveMonitor>(monitorKeys.live(examId), (prev) =>
        prev?.suggestion && prev.suggestion.attemptIds.every((id) => done.has(id)) ? { ...prev, suggestion: null } : prev,
      );
      refresh();
    },
  });
}

export function useForceSubmit(examId: string) {
  const refresh = useRefreshAttempt(examId);
  return useMutation({
    mutationFn: (input: { attemptId: string; reason: string }) =>
      api.post<{ attemptId: string; status: string }>(`${base}/attempts/${input.attemptId}/force-submit`, { reason: input.reason }),
    onSuccess: (r) => refresh(r.attemptId),
  });
}

/** Writes the outcome into every cached list that holds the indicator, so all panels agree at once. */
export function applyReviewedEvent(qc: ReturnType<typeof useQueryClient>, examId: string, event: MonitorEvent) {
  qc.setQueryData<IncidentList>(monitorKeys.incidents(examId), (prev) =>
    prev ? { ...prev, incidents: prev.incidents.map((e) => (e.id === event.id ? event : e)) } : prev,
  );
  qc.setQueryData<AttemptTimeline>(monitorKeys.timeline(examId, event.attemptId), (prev) =>
    prev ? { ...prev, events: prev.events.map((e) => (e.id === event.id ? event : e)) } : prev,
  );
}

export function useReviewIndicator(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; status: ReviewOutcome; note: string }) =>
      api.patch<MonitorEvent>(`${base}/events/${input.eventId}/review`, { status: input.status, note: input.note }),
    onSuccess: (event) => {
      applyReviewedEvent(qc, examId, event);
      void qc.invalidateQueries({ queryKey: monitorKeys.incidents(examId) });
      void qc.invalidateQueries({ queryKey: monitorKeys.live(examId) });
    },
  });
}

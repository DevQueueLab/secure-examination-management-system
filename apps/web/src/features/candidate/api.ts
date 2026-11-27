'use client';

import type { AttemptView, CandidateExamCard, ExamLobby, StartAttemptInput } from '@athena/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export const candidateKeys = {
  exams: ['candidate', 'exams'] as const,
  lobby: (examId: string) => ['candidate', 'lobby', examId] as const,
  serverClock: ['candidate', 'server-clock'] as const,
};

export function useCandidateExams() {
  return useQuery({
    queryKey: candidateKeys.exams,
    queryFn: () => api.get<CandidateExamCard[]>('/attempts/exams'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useExamLobby(examId: string) {
  return useQuery({
    queryKey: candidateKeys.lobby(examId),
    queryFn: () => api.get<ExamLobby>(`/attempts/exams/${examId}/lobby`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useStartAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAttemptInput) => api.post<AttemptView>('/attempts', input),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: candidateKeys.exams });
      void queryClient.invalidateQueries({ queryKey: candidateKeys.lobby(view.examId) });
    },
  });
}

export interface ServerClockSample {
  /** Server clock minus device clock, in ms. */
  offsetMs: number;
  rttMs: number;
  serverTime: string;
}

/** Best of three round trips to /health: the lowest RTT gives the tightest estimate of the server clock. */
export async function measureServerClock(samples = 3): Promise<ServerClockSample> {
  let best: ServerClockSample | null = null;
  for (let i = 0; i < samples; i++) {
    const sentAt = performance.now();
    const deviceSent = Date.now();
    const res = await api.get<{ serverTime: string }>('/health', { retries: 0, timeoutMs: 8_000, cache: 'no-store' });
    const rttMs = performance.now() - sentAt;
    const serverMs = Date.parse(res.serverTime);
    if (!Number.isFinite(serverMs)) continue;
    const offsetMs = serverMs + rttMs / 2 - (deviceSent + rttMs);
    if (!best || rttMs < best.rttMs) best = { offsetMs, rttMs, serverTime: res.serverTime };
  }
  if (!best) throw new Error('No usable clock sample');
  return best;
}

export function useServerClock() {
  return useQuery({
    queryKey: candidateKeys.serverClock,
    queryFn: () => measureServerClock(3),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Server time in epoch ms, ticking every `intervalMs`. Countdowns on the dashboard and lobby use it, so a wrong
 * device clock never shows the wrong opening time. Falls back to the device clock until the first sample.
 */
export function useServerNow(intervalMs = 1_000): number {
  const clock = useServerClock();
  const offset = clock.data?.offsetMs ?? 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
}

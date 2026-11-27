'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { IntegrityOverview, LeakTraceResult, ProvenanceView, SimilarityReport } from './types';

export const integrityKeys = {
  overview: (examId: string) => ['integrity', examId, 'overview'] as const,
  similarity: (examId: string) => ['integrity', examId, 'similarity'] as const,
  provenance: (answerId: string) => ['integrity', 'provenance', answerId] as const,
  scopeExam: (examId: string | null) => ['integrity', 'scope-exam', examId] as const,
};

export function useIntegrityOverview(examId: string) {
  return useQuery({
    queryKey: integrityKeys.overview(examId),
    queryFn: () => api.get<IntegrityOverview>(`/integrity/exams/${examId}/overview`),
    staleTime: 15_000,
    retry: (count, error) => count < 2 && !(error as { status?: number }).status,
  });
}

export function useSimilarity(examId: string, enabled = true) {
  return useQuery({
    queryKey: integrityKeys.similarity(examId),
    queryFn: () => api.get<SimilarityReport>(`/integrity/exams/${examId}/similarity`),
    staleTime: 30_000,
    enabled,
  });
}

export function useProvenance(answerId: string | null) {
  return useQuery({
    queryKey: integrityKeys.provenance(answerId ?? 'none'),
    queryFn: () => api.get<ProvenanceView>(`/integrity/answers/${answerId}/provenance`),
    enabled: !!answerId,
    staleTime: 60_000,
  });
}

/** Every trace is audited on the server; nothing is cached here. */
export function useLeakTrace() {
  return useMutation({
    mutationFn: (body: { text: string; code: string; examId?: string }) => api.post<LeakTraceResult>('/integrity/leak-trace', body),
  });
}

/** The exam a leak trace is limited to, for its title. */
export function useScopeExam(examId: string | null) {
  return useQuery({
    queryKey: integrityKeys.scopeExam(examId),
    queryFn: () => api.get<{ id: string; title: string }>(`/exams/${examId}`),
    enabled: !!examId,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

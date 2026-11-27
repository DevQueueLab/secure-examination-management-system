'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  DisputeCategory,
  DisputeView,
  Evidence,
  ExamDisputeSummary,
  Inbox,
  InboxFilters,
  MyDisputes,
  Part,
  RaiseContext,
  RemediesOverview,
  RemedyInput,
  RemedyReport,
  ScoreHistoryData,
  StaffDisputeView,
} from './types';

export const disputeKeys = {
  all: ['disputes'] as const,
  mine: ['disputes', 'mine'] as const,
  context: (attemptId: string) => ['disputes', 'context', attemptId] as const,
  preview: (attemptId: string, itemId: string | null, category: DisputeCategory) => ['disputes', 'preview', attemptId, itemId, category] as const,
  detail: (id: string) => ['disputes', 'detail', id] as const,
  inbox: (filters: InboxFilters) => ['disputes', 'inbox', filters] as const,
  remedies: (examId: string) => ['disputes', 'remedies', examId] as const,
  summary: (examId: string) => ['disputes', 'summary', examId] as const,
  history: (attemptId: string) => ['disputes', 'history', attemptId] as const,
};

/** Everything a dispute decision can touch: lists, the exam's numbers, scores and published results. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: disputeKeys.all });
    void qc.invalidateQueries({ queryKey: ['results'] });
    void qc.invalidateQueries({ queryKey: ['grading'] });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
  };
}

// ---------------------------------------------------------------- candidate

export function useMyDisputes() {
  return useQuery({ queryKey: disputeKeys.mine, queryFn: () => api.get<MyDisputes>('/disputes/mine'), staleTime: 10_000 });
}

export function useRaiseContext(attemptId: string | null) {
  return useQuery({
    queryKey: disputeKeys.context(attemptId ?? ''),
    queryFn: () => api.get<RaiseContext>(`/disputes/attempts/${attemptId}/context`),
    enabled: !!attemptId,
    staleTime: 10_000,
  });
}

export function useEvidencePreview(attemptId: string, itemId: string | null, category: DisputeCategory, enabled: boolean) {
  return useQuery({
    queryKey: disputeKeys.preview(attemptId, itemId, category),
    queryFn: () => api.get<{ evidence: Evidence }>(`/disputes/attempts/${attemptId}/preview`, { query: { itemId, category } }),
    enabled,
    staleTime: 30_000,
  });
}

export function useRaiseDispute() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: { attemptId: string; attemptItemId: string | null; category: DisputeCategory; description: string }) => api.post<DisputeView>('/disputes', body),
    onSuccess: refresh,
  });
}

export function useDispute(id: string) {
  return useQuery({ queryKey: disputeKeys.detail(id), queryFn: () => api.get<DisputeView>(`/disputes/${id}`), staleTime: 5_000 });
}

function useDisputeMutation<TBody>(id: string, path: string) {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: TBody) => api.post<DisputeView>(`/disputes/${id}/${path}`, body),
    onSuccess: (view) => {
      if (view && typeof view === 'object' && 'dispute' in view) qc.setQueryData(disputeKeys.detail(id), view);
      refresh();
    },
  });
}

export const useSendMessage = (id: string) => useDisputeMutation<{ body: string; internal?: boolean }>(id, 'messages');
export const useWithdraw = (id: string) => useDisputeMutation<void>(id, 'withdraw');
export const useAppeal = (id: string) => useDisputeMutation<{ reason: string }>(id, 'appeal');

export function useScoreHistory(attemptId: string) {
  return useQuery({
    queryKey: disputeKeys.history(attemptId),
    queryFn: () => api.get<ScoreHistoryData>(`/disputes/attempts/${attemptId}/history`, { retries: 1 }),
    staleTime: 15_000,
    retry: false,
  });
}

// ---------------------------------------------------------------- staff

export function useInbox(filters: InboxFilters) {
  return useQuery({
    queryKey: disputeKeys.inbox(filters),
    queryFn: () =>
      api.get<Inbox>('/disputes', {
        query: {
          examId: filters.examId,
          status: filters.status,
          category: filters.category,
          assignedToMe: filters.assignedToMe ? 'true' : undefined,
          overdue: filters.overdue ? 'true' : undefined,
        },
      }),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

export const useAssign = (id: string) => useDisputeMutation<{ assigneeId: string | null }>(id, 'assign');
export const useSetStatus = (id: string) => useDisputeMutation<{ status: 'under_review' | 'needs_info'; message?: string }>(id, 'status');

export interface RegradeBody {
  part: Part;
  score?: number;
  rubricItemIds?: string[];
  adjustment?: number;
}

export function useResolve(id: string) {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: { outcome: string; note: string; regrade?: RegradeBody | null }) =>
      api.post<StaffDisputeView & { supersededReports: number }>(`/disputes/${id}/resolve`, body),
    onSuccess: (view) => {
      qc.setQueryData(disputeKeys.detail(id), view);
      refresh();
    },
  });
}

export function useRemedies(examId: string) {
  return useQuery({ queryKey: disputeKeys.remedies(examId), queryFn: () => api.get<RemediesOverview>(`/disputes/exams/${examId}/remedies`), staleTime: 10_000 });
}

/** Preview (dryRun) or apply a remedy. Applying must be asked for explicitly: the API previews by default. */
export function useRunRemedy(examId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: RemedyInput) => api.post<RemedyReport>(`/disputes/exams/${examId}/remedies`, body, { timeoutMs: 60_000 }),
    onSuccess: (report) => {
      if (!report.dryRun) refresh();
    },
  });
}

export function useExamDisputeSummary(examId: string) {
  return useQuery({ queryKey: disputeKeys.summary(examId), queryFn: () => api.get<ExamDisputeSummary>(`/disputes/exams/${examId}/summary`), staleTime: 10_000 });
}

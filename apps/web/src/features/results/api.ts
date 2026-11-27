'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, ApiError, api } from '@/lib/api';
import type { ExamResults, IssuedReport, MyResultDetail, MyResultSummary, PublishResult, VerifyResponse } from './types';

export const resultsKeys = {
  exam: (examId: string) => ['results', examId] as const,
  mine: ['results', 'mine'] as const,
  mineDetail: (attemptId: string) => ['results', 'mine', attemptId] as const,
  verify: (code: string) => ['verify', code] as const,
};

export function useExamResults(examId: string) {
  return useQuery({
    queryKey: resultsKeys.exam(examId),
    queryFn: () => api.get<ExamResults>(`/results/exams/${examId}`),
    staleTime: 10_000,
  });
}

function useRefreshExam(examId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: resultsKeys.exam(examId) });
    void qc.invalidateQueries({ queryKey: ['analytics', examId] });
    void qc.invalidateQueries({ queryKey: ['grading'] });
    void qc.invalidateQueries({ queryKey: ['exams', examId] });
  };
}

export function usePublishResults(examId: string) {
  const refresh = useRefreshExam(examId);
  return useMutation({
    mutationFn: (body: { force?: boolean; reason?: string | null }) => api.post<PublishResult>(`/results/exams/${examId}/publish`, body),
    onSuccess: refresh,
  });
}

export function useUnpublishResults(examId: string) {
  const refresh = useRefreshExam(examId);
  return useMutation({
    mutationFn: (body: { reason: string }) =>
      api.post<{ resultsStatus: string; resultsVersion: number; supersededReports: number }>(`/results/exams/${examId}/unpublish`, body),
    onSuccess: refresh,
  });
}

export function useMyResults() {
  return useQuery({
    queryKey: resultsKeys.mine,
    queryFn: async () => (await api.get<{ results: MyResultSummary[] }>('/results/mine')).results,
    staleTime: 15_000,
  });
}

export function useMyResult(attemptId: string) {
  return useQuery({
    queryKey: resultsKeys.mineDetail(attemptId),
    queryFn: () => api.get<MyResultDetail>(`/results/mine/${attemptId}`),
    staleTime: 15_000,
  });
}

export function useIssueReport(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IssuedReport>(`/reports/attempts/${attemptId}/issue`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: resultsKeys.mineDetail(attemptId) }),
  });
}

export function useVerification(code: string) {
  return useQuery({
    queryKey: resultsKeys.verify(code),
    // api.get already retries dropped connections; a 404 or 429 is an answer, so no second retry layer here.
    queryFn: () => api.get<VerifyResponse>(`/public/verify/${encodeURIComponent(code)}`),
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Downloads a PDF the API streams as an attachment. Uses fetch (not a link) so a refusal shows as a message
 * instead of a JSON page, and so the file name comes from the server.
 */
export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
  if (!res.ok) {
    let message = 'The report could not be generated. Try again.';
    let code = 'REPORT_FAILED';
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError({ status: res.status, code, message });
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ExamAnalytics } from './types';

export const analyticsKeys = {
  exam: (examId: string) => ['analytics', examId] as const,
};

export function useExamAnalytics(examId: string) {
  return useQuery({
    queryKey: analyticsKeys.exam(examId),
    queryFn: () => api.get<ExamAnalytics>(`/analytics/exams/${examId}`),
    staleTime: 30_000,
  });
}

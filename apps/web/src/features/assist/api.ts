'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api, isApiError } from '@/lib/api';

export interface SuggestedCriterion {
  rubricItemId: string;
  label: string;
  points: number;
  applies: boolean;
  marks: number;
  reason: string;
}

export interface SuggestedMarks {
  part: 'answer';
  max: number;
  criteria: SuggestedCriterion[];
  score: number;
  note: string;
  injectionSuspected: boolean;
}

/** True only when the server has a provider key. Any failure (signed out, no permission) reads as off. */
export function useAssistEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['assist', 'status'],
    queryFn: async () => (await api.get<{ enabled: boolean }>('/assist/status')).enabled === true,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data === true;
}

export function useSuggestMarks() {
  return useMutation({
    mutationFn: (answerId: string) => api.post<SuggestedMarks>(`/assist/grading/answers/${answerId}/suggest`, {}),
  });
}

/** Plain wording for a failed suggestion; rate limits name the wait in minutes. */
export function suggestionError(error: unknown): string {
  if (isApiError(error) && error.status === 429) {
    const seconds = Number(error.fields.retryAfter);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 1;
    return `Too many suggestions just now. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  if (isApiError(error) && error.message) return error.message;
  return 'Suggestions are unavailable right now. Try again in a moment.';
}

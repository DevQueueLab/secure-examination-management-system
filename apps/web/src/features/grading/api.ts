'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GradeInput, GradeResult, GradingQueue, InboxExam, Part, QuestionAnswers, Rescore, RubricItem, RubricList } from './types';

export const gradingKeys = {
  inbox: ['grading', 'inbox'] as const,
  exam: (examId: string) => ['grading', examId] as const,
  queue: (examId: string) => ['grading', examId, 'queue'] as const,
  answers: (examId: string, questionId: string) => ['grading', examId, 'answers', questionId] as const,
  rubric: (examId: string, questionId: string) => ['grading', examId, 'rubric', questionId] as const,
};

export function useGradingInbox() {
  return useQuery({
    queryKey: gradingKeys.inbox,
    queryFn: async () => (await api.get<{ exams: InboxExam[] }>('/grading/inbox')).exams,
    staleTime: 15_000,
  });
}

export function useGradingQueue(examId: string) {
  return useQuery({
    queryKey: gradingKeys.queue(examId),
    queryFn: () => api.get<GradingQueue>(`/grading/exams/${examId}/queue`),
    staleTime: 10_000,
  });
}

export function useQuestionAnswers(examId: string, questionId: string | null) {
  return useQuery({
    queryKey: gradingKeys.answers(examId, questionId ?? 'none'),
    queryFn: () => api.get<QuestionAnswers>(`/grading/exams/${examId}/questions/${questionId}/answers`),
    enabled: !!questionId,
    staleTime: 10_000,
  });
}

export function useRubric(examId: string, questionId: string | null) {
  return useQuery({
    queryKey: gradingKeys.rubric(examId, questionId ?? 'none'),
    queryFn: () => api.get<RubricList>(`/grading/exams/${examId}/questions/${questionId}/rubric`),
    enabled: !!questionId,
    staleTime: 10_000,
  });
}

/** Results, analytics and the inbox all read scores, so a grade or rubric change refreshes them. */
function useInvalidateScores(examId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: gradingKeys.queue(examId) });
    void qc.invalidateQueries({ queryKey: gradingKeys.inbox });
    void qc.invalidateQueries({ queryKey: ['results', examId] });
    void qc.invalidateQueries({ queryKey: ['analytics', examId] });
  };
}

/** Grades one part of one answer. The answers list is patched in place so the grader never flickers. */
export function useGradeAnswer(examId: string, questionId: string) {
  const qc = useQueryClient();
  const refresh = useInvalidateScores(examId);
  return useMutation({
    mutationFn: ({ answerId, input }: { answerId: string; input: GradeInput }) => api.put<GradeResult>(`/grading/answers/${answerId}`, input),
    onSuccess: (result) => {
      qc.setQueryData<QuestionAnswers>(gradingKeys.answers(examId, questionId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          progress: result.progress,
          answers: prev.answers.map((a) =>
            a.id === result.answer.id
              ? {
                  ...a,
                  parts: result.answer.parts,
                  rubricItemIds: result.answer.rubricItemIds,
                  feedback: result.answer.feedback,
                  itemScore: result.answer.itemScore,
                  graded: result.answer.graded,
                  gradedAt: result.answer.gradedAt,
                  gradedBy: result.answer.gradedBy,
                  scoreStatus: 'manual',
                }
              : a,
          ),
        };
      });
      void qc.invalidateQueries({ queryKey: gradingKeys.rubric(examId, questionId) });
      refresh();
    },
  });
}

export function useGradeGroup(examId: string, questionId: string) {
  const qc = useQueryClient();
  const refresh = useInvalidateScores(examId);
  return useMutation({
    mutationFn: (input: GradeInput & { answerIds: string[] }) =>
      api.post<{ answers: GradeResult['answer'][]; progress: { total: number; graded: number }; published: boolean }>('/grading/answers/group', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gradingKeys.answers(examId, questionId) });
      void qc.invalidateQueries({ queryKey: gradingKeys.rubric(examId, questionId) });
      refresh();
    },
  });
}

export function useZeroBlanks(examId: string, questionId: string) {
  const qc = useQueryClient();
  const refresh = useInvalidateScores(examId);
  return useMutation({
    mutationFn: () => api.post<{ graded: number }>(`/grading/exams/${examId}/questions/${questionId}/zero-blanks`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gradingKeys.answers(examId, questionId) });
      refresh();
    },
  });
}

export interface RubricDraft {
  label: string;
  description?: string | null;
  points: number;
  target: Part;
  position?: number;
}

export function useRubricMutations(examId: string, questionId: string) {
  const qc = useQueryClient();
  const refresh = useInvalidateScores(examId);
  const settle = () => {
    void qc.invalidateQueries({ queryKey: gradingKeys.rubric(examId, questionId) });
    void qc.invalidateQueries({ queryKey: gradingKeys.answers(examId, questionId) });
    refresh();
  };
  const create = useMutation({
    mutationFn: (draft: RubricDraft) => api.post<{ item: RubricItem } | RubricItem>(`/grading/exams/${examId}/questions/${questionId}/rubric`, draft),
    onSuccess: settle,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RubricDraft> }) =>
      api.patch<{ item: RubricItem; rescored: Rescore }>(`/grading/rubric-items/${id}`, patch),
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ rescored: Rescore }>(`/grading/rubric-items/${id}`),
    onSuccess: settle,
  });
  return { create, update, remove };
}

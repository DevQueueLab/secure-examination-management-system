'use client';

import type { AttemptView } from '@athena/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CandidateImportResult,
  Category,
  EligibleCandidates,
  EligibleStaff,
  EnrollmentList,
  ExamDetail,
  ExamFilters,
  ExamInput,
  ExamListResponse,
  ExamReview,
  ExamSectionView,
  QuestionDetail,
  QuestionFilters,
  QuestionImportResult,
  QuestionInput,
  QuestionPage,
  QuestionPreview,
  QuestionSaveResult,
  QuestionVersions,
  StaffMember,
} from './types';

/**
 * Query keys. Everything about one exam lives under ['exams', id] (the shared exam header reads
 * ['exams', id, 'summary']), so invalidating that prefix refreshes every view of the exam at once.
 */
export const authoringKeys = {
  questions: ['questions'] as const,
  questionList: (f: QuestionFilters) => ['questions', 'list', f] as const,
  question: (id: string) => ['questions', 'detail', id] as const,
  versions: (id: string) => ['questions', 'versions', id] as const,
  categories: ['questions', 'categories'] as const,
  tags: ['questions', 'tags'] as const,
  examLists: ['exams', 'list'] as const,
  examList: (f: ExamFilters) => ['exams', 'list', f] as const,
  exam: (id: string) => ['exams', id] as const,
  examDetail: (id: string) => ['exams', id, 'detail'] as const,
  review: (id: string) => ['exams', id, 'review'] as const,
  enrollments: (id: string, f: { q?: string; cohort?: string } = {}) => ['exams', id, 'enrollments', f] as const,
  eligible: (id: string, f: { q?: string; cohort?: string }) => ['exams', id, 'eligible', f] as const,
  staffEligible: (id: string, q: string) => ['exams', id, 'staff-eligible', q] as const,
};

/** After any change to an exam: refresh its views and the exam lists. */
export function invalidateExam(qc: QueryClient, examId: string) {
  void qc.invalidateQueries({ queryKey: authoringKeys.exam(examId) });
  void qc.invalidateQueries({ queryKey: authoringKeys.examLists });
}

// ---------- question bank ----------

export function useQuestions(filters: QuestionFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authoringKeys.questionList(filters),
    queryFn: () => api.get<QuestionPage>('/questions', { query: { ...filters } }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: authoringKeys.categories,
    queryFn: async () => (await api.get<{ items: Category[] }>('/questions/categories')).items,
    staleTime: 60_000,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; color?: string | null }) => api.post<Category>('/questions/categories', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authoringKeys.categories }),
  });
}

export function useTags() {
  return useQuery({
    queryKey: authoringKeys.tags,
    queryFn: async () => (await api.get<{ items: { tag: string; count: number }[] }>('/questions/tags')).items,
    staleTime: 60_000,
  });
}

export function useQuestion(id: string | undefined) {
  return useQuery({
    queryKey: authoringKeys.question(id ?? ''),
    queryFn: () => api.get<QuestionDetail>(`/questions/${id}`),
    enabled: !!id,
  });
}

export function useQuestionVersions(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: authoringKeys.versions(id ?? ''),
    queryFn: () => api.get<QuestionVersions>(`/questions/${id}/versions`),
    enabled: !!id && enabled,
  });
}

function useBankInvalidation() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['questions', 'list'] });
    void qc.invalidateQueries({ queryKey: authoringKeys.categories });
    void qc.invalidateQueries({ queryKey: authoringKeys.tags });
    if (id) {
      void qc.invalidateQueries({ queryKey: authoringKeys.question(id) });
      void qc.invalidateQueries({ queryKey: authoringKeys.versions(id) });
    }
  };
}

export function useCreateQuestion() {
  const invalidate = useBankInvalidation();
  return useMutation({
    mutationFn: (input: QuestionInput) => api.post<QuestionDetail>('/questions', input),
    onSuccess: (q) => invalidate(q.id),
  });
}

export function useUpdateQuestion(id: string) {
  const invalidate = useBankInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuestionInput) => api.put<QuestionSaveResult>(`/questions/${id}`, input),
    onSuccess: (q) => {
      qc.setQueryData(authoringKeys.question(id), q);
      invalidate(id);
    },
  });
}

/** Archive, restore or duplicate one question. Resolves with the affected question. */
export function useQuestionAction() {
  const invalidate = useBankInvalidation();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'restore' | 'duplicate' }) => api.post<QuestionDetail>(`/questions/${id}/${action}`),
    onSuccess: (q, { id }) => {
      invalidate(id);
      invalidate(q.id);
    },
  });
}

export function useBulkQuestionStatus() {
  const invalidate = useBankInvalidation();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: 'archive' | 'restore' }) =>
      api.post<{ updated: number; ids: string[] }>(`/questions/bulk-${action}`, { ids }),
    onSuccess: (r) => {
      invalidate();
      r.ids.forEach((id) => invalidate(id));
    },
  });
}

export function usePreviewQuestion() {
  return useMutation({
    mutationFn: (input: { type: string; content: unknown; key: unknown; seed?: string; shuffleOptions?: boolean }) =>
      api.post<QuestionPreview>('/questions/preview', input),
  });
}

export function useImportQuestions() {
  const invalidate = useBankInvalidation();
  return useMutation({
    mutationFn: (input: { format: 'csv' | 'json'; data: string; dryRun: boolean; filename?: string }) =>
      api.post<QuestionImportResult>('/questions/import', input, { timeoutMs: 120_000 }),
    onSuccess: (r) => {
      if (!r.dryRun) invalidate();
    },
  });
}

// ---------- exams ----------

export function useExams(filters: ExamFilters) {
  return useQuery({
    queryKey: authoringKeys.examList(filters),
    queryFn: () => api.get<ExamListResponse>('/exams', { query: { ...filters } }),
    placeholderData: keepPreviousData,
  });
}

export function useExam(examId: string) {
  return useQuery({
    queryKey: authoringKeys.examDetail(examId),
    queryFn: () => api.get<ExamDetail>(`/exams/${examId}`),
    retry: false,
  });
}

export function useExamReview(examId: string, enabled = true) {
  return useQuery({
    queryKey: authoringKeys.review(examId),
    queryFn: () => api.get<ExamReview>(`/exams/${examId}/review`),
    enabled,
  });
}

export function useCreateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExamInput) => api.post<ExamDetail>('/exams', input),
    onSuccess: (exam) => {
      qc.setQueryData(authoringKeys.examDetail(exam.id), exam);
      void qc.invalidateQueries({ queryKey: authoringKeys.examLists });
    },
  });
}

export function useUpdateExam(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ExamInput>) => api.patch<ExamDetail>(`/exams/${examId}`, patch),
    onSuccess: (exam) => {
      qc.setQueryData(authoringKeys.examDetail(examId), exam);
      invalidateExam(qc, examId);
    },
  });
}

/** publish | unpublish | archive | duplicate. Duplicate resolves with the new draft. */
export function useExamLifecycle(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'archive' | 'duplicate') => api.post<ExamDetail>(`/exams/${examId}/${action}`),
    onSuccess: (exam, action) => {
      if (action !== 'duplicate') qc.setQueryData(authoringKeys.examDetail(examId), exam);
      invalidateExam(qc, examId);
    },
  });
}

/** Sections, pinned questions and pool marks. Every call refreshes the exam. */
export function useExamStructure(examId: string) {
  const qc = useQueryClient();
  const done = () => invalidateExam(qc, examId);
  const base = `/exams/${examId}`;
  return {
    createSection: useMutation({
      mutationFn: (input: { title: string; instructions?: string | null; drawCount?: number | null }) => api.post<ExamSectionView>(`${base}/sections`, input),
      onSuccess: done,
    }),
    updateSection: useMutation({
      mutationFn: ({ sectionId, ...patch }: { sectionId: string; title?: string; instructions?: string | null; drawCount?: number | null }) =>
        api.patch(`${base}/sections/${sectionId}`, patch),
      onSuccess: done,
    }),
    deleteSection: useMutation({
      mutationFn: (sectionId: string) => api.del<{ removedQuestions: number }>(`${base}/sections/${sectionId}`),
      onSuccess: done,
    }),
    reorderSections: useMutation({
      mutationFn: (order: string[]) => api.post(`${base}/sections/reorder`, { order }),
      onSuccess: done,
    }),
    setSectionMarks: useMutation({
      mutationFn: ({ sectionId, marks }: { sectionId: string; marks: number }) => api.post(`${base}/sections/${sectionId}/marks`, { marks }),
      onSuccess: done,
    }),
    addQuestions: useMutation({
      mutationFn: (input: { sectionId: string; questionIds: string[] }) =>
        api.post<{ added: { id: string; questionId: string }[]; skipped: { questionId: string; title: string; reason: string }[] }>(`${base}/questions`, input),
      onSuccess: done,
    }),
    updateQuestion: useMutation({
      mutationFn: ({ examQuestionId, ...patch }: { examQuestionId: string; marks?: number; sectionId?: string; position?: number; repin?: true }) =>
        api.patch(`${base}/questions/${examQuestionId}`, patch),
      onSuccess: done,
    }),
    removeQuestion: useMutation({
      mutationFn: (examQuestionId: string) => api.del(`${base}/questions/${examQuestionId}`),
      onSuccess: done,
    }),
  };
}

export function useEligibleStaff(examId: string, q: string, enabled: boolean) {
  return useQuery({
    queryKey: authoringKeys.staffEligible(examId, q),
    queryFn: async () => (await api.get<{ items: EligibleStaff[] }>(`/exams/${examId}/staff/eligible`, { query: { q } })).items,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useExamStaff(examId: string) {
  const qc = useQueryClient();
  const done = () => invalidateExam(qc, examId);
  return {
    add: useMutation({
      mutationFn: (input: { userId: string; role: 'co_examiner' | 'grader' | 'proctor' }) => api.post<{ items: StaffMember[] }>(`/exams/${examId}/staff`, input),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api.del<{ items: StaffMember[] }>(`/exams/${examId}/staff/${userId}`),
      onSuccess: done,
    }),
  };
}

// ---------- enrollments ----------

export function useEnrollments(examId: string, filters: { q?: string; cohort?: string } = {}, page = 1, pageSize = 25) {
  return useQuery({
    queryKey: [...authoringKeys.enrollments(examId, filters), { page, pageSize }],
    queryFn: () => api.get<EnrollmentList>(`/exams/${examId}/enrollments`, { query: { ...filters, page, pageSize } }),
    placeholderData: keepPreviousData,
  });
}

export function useEligibleCandidates(examId: string, filters: { q?: string; cohort?: string }, enabled: boolean) {
  return useQuery({
    queryKey: authoringKeys.eligible(examId, filters),
    queryFn: () => api.get<EligibleCandidates>(`/exams/${examId}/eligible-candidates`, { query: { ...filters, limit: 100 } }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useEnrollmentMutations(examId: string) {
  const qc = useQueryClient();
  const done = () => invalidateExam(qc, examId);
  const base = `/exams/${examId}/enrollments`;
  return {
    enroll: useMutation({
      mutationFn: (input: { userIds?: string[]; cohort?: string }) => api.post<{ enrolled: number; alreadyEnrolled: number }>(base, input),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ enrollmentId, ...patch }: { enrollmentId: string; timeMultiplier?: number; extraMinutes?: number; accommodationNote?: string | null }) =>
        api.patch<{ id: string; timeMultiplier: number; extraMinutes: number; accommodationNote: string | null; hasActiveAttempt: boolean }>(`${base}/${enrollmentId}`, patch),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (enrollmentId: string) => api.del(`${base}/${enrollmentId}`),
      onSuccess: done,
    }),
    importFile: useMutation({
      mutationFn: (input: { format: 'csv' | 'json'; data: string; dryRun: boolean; filename?: string }) =>
        api.post<CandidateImportResult>(`${base}/import`, input, { timeoutMs: 180_000 }),
      onSuccess: (r) => {
        if (!r.dryRun) done();
      },
    }),
  };
}

/** Starts an examiner preview attempt (engine endpoint); excluded from every statistic. */
export function useSandboxAttempt() {
  return useMutation({
    mutationFn: (examId: string) => api.post<AttemptView>('/attempts/sandbox', { examId }),
  });
}

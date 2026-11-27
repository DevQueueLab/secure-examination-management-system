'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { invalidateExam } from '../api';
import type { ReviewFix } from '../types';
import { formatMarks } from './format';

/** Applies a one-click fix the review offered (set total, equalize pool marks, shrink a draw). */
export function useApplyFix(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fix: ReviewFix) => {
      if (fix.kind === 'set_total') return api.patch(`/exams/${examId}`, { totalMarks: fix.value });
      if (fix.kind === 'set_pool_marks') return api.post(`/exams/${examId}/sections/${fix.sectionId}/marks`, { marks: fix.value });
      return api.patch(`/exams/${examId}/sections/${fix.sectionId}`, { drawCount: fix.value });
    },
    onSuccess: (_r, fix) => {
      invalidateExam(qc, examId);
      toast.success(
        fix.kind === 'set_total'
          ? `Total marks set to ${formatMarks(fix.value)}`
          : fix.kind === 'set_pool_marks'
            ? `Every question in the pool is now worth ${formatMarks(fix.value)}`
            : `The pool now draws ${fix.value}`,
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function fixLabel(fix: ReviewFix): string {
  if (fix.kind === 'set_total') return `Set total to ${formatMarks(fix.value)}`;
  if (fix.kind === 'set_pool_marks') return `Make all ${formatMarks(fix.value)}`;
  return `Draw ${fix.value}`;
}

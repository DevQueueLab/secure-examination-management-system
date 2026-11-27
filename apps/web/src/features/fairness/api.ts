'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FairnessAuditReport, FairnessSimulationReport, RecalibrationResult } from './types';

export const fairnessKeys = {
  all: (examId: string) => ['fairness', examId] as const,
  simulation: (examId: string, runs: number) => ['fairness', examId, 'simulation', runs] as const,
  audit: (examId: string) => ['fairness', examId, 'audit'] as const,
};

/** Monte Carlo comparison of balanced and random papers. Deterministic server side, so it can stay cached. */
export function useFairnessSimulation(examId: string, runs: number) {
  return useQuery({
    queryKey: fairnessKeys.simulation(examId, runs),
    queryFn: () => api.get<FairnessSimulationReport>(`/fairness/exams/${examId}/simulation`, { query: { runs } }),
    // Changing the run count keeps the previous chart on screen until the new one arrives.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useFairnessAudit(examId: string) {
  return useQuery({
    queryKey: fairnessKeys.audit(examId),
    queryFn: () => api.get<FairnessAuditReport>(`/fairness/exams/${examId}/audit`),
    staleTime: 30_000,
  });
}

/** Writes this exam's observed difficulty back to the bank; both reports change afterwards. */
export function useRecalibrate(examId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RecalibrationResult>(`/fairness/exams/${examId}/recalibrate`),
    onSuccess: () => client.invalidateQueries({ queryKey: fairnessKeys.all(examId) }),
  });
}

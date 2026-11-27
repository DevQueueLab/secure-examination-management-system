import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { issuedReports } from '../../db/schema';

/**
 * A verifiable report states a score. When that score can change (a regrade after publication, a rubric edit,
 * unpublishing), the reports issued for it are marked superseded so the public verification page says so.
 */
export async function supersedeReportsForAttempts(tx: Executor, attemptIds: readonly string[]): Promise<number> {
  if (!attemptIds.length) return 0;
  const rows = await tx
    .update(issuedReports)
    .set({ status: 'superseded', supersededAt: new Date() })
    .where(and(inArray(issuedReports.attemptId, [...attemptIds]), eq(issuedReports.status, 'valid')))
    .returning({ id: issuedReports.id });
  return rows.length;
}

export async function supersedeReportsForExam(tx: Executor, examId: string): Promise<number> {
  const rows = await tx
    .update(issuedReports)
    .set({ status: 'superseded', supersededAt: new Date() })
    .where(and(eq(issuedReports.examId, examId), eq(issuedReports.status, 'valid')))
    .returning({ id: issuedReports.id });
  return rows.length;
}

import { eq } from 'drizzle-orm';
import { isAutoGraded, type GradingStatus } from '@athena/shared';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts } from '../../db/schema';
import { round3 } from '../rng';

export interface ItemScore {
  itemId: string;
  /** Final item score, or null while any part awaits a human. */
  score: number | null;
  pending: boolean;
}

/**
 * Combines the parts of each item into a final score:
 *   answer part  = autoScore (objective types) or manualScore (written / code)
 *   working part = workingScore, only when the item awards method marks
 * An item is pending while any part is ungraded. The attempt total is the sum of item scores, floored at 0
 * (negative marking can reduce an item but never the whole paper below zero).
 */
export function combineItem(
  item: { workingMarks: number },
  answer: { autoScore: number | null; manualScore: number | null; workingScore: number | null } | undefined,
  autoGraded: boolean,
): { score: number | null; pending: boolean } {
  const answerPart = autoGraded ? (answer?.autoScore ?? 0) : (answer?.manualScore ?? null);
  const workingPart = item.workingMarks > 0 ? (answer?.workingScore ?? null) : 0;
  if (answerPart === null || workingPart === null) return { score: null, pending: true };
  return { score: round3(answerPart + workingPart), pending: false };
}

/** Recomputes and stores every item score and the attempt total. Call inside the grading transaction. */
export async function recomputeAttempt(tx: Executor, attemptId: string): Promise<{ score: number; maxScore: number; status: GradingStatus; pending: number }> {
  const items = await tx.select().from(attemptItems).where(eq(attemptItems.attemptId, attemptId));
  const rows = await tx.select().from(answers).where(eq(answers.attemptId, attemptId));
  const byItem = new Map(rows.map((a) => [a.attemptItemId, a]));

  let total = 0;
  let maxScore = 0;
  let pending = 0;
  let manualDone = 0;
  for (const item of items) {
    maxScore += item.marks + item.workingMarks;
    const a = byItem.get(item.id);
    const { score, pending: isPending } = combineItem(item, a, isAutoGraded(item.type));
    if (isPending) pending++;
    else {
      total += score!;
      if (!isAutoGraded(item.type) || item.workingMarks > 0) manualDone++;
    }
    if (a && a.score !== score) await tx.update(answers).set({ score }).where(eq(answers.id, a.id));
  }
  const status: GradingStatus = pending === 0 ? 'complete' : manualDone > 0 ? 'partial' : 'pending';
  const score = round3(Math.max(0, total));
  await tx.update(attempts).set({ score, maxScore: round3(maxScore), gradingStatus: status }).where(eq(attempts.id, attemptId));
  return { score, maxScore: round3(maxScore), status, pending };
}

import type { exams, users } from '../schema';

type Exam = typeof exams.$inferSelect;
type User = typeof users.$inferSelect;

/**
 * Realistic activity (attempts, answers, grades, incidents, results) created through the real attempt and
 * grading services, so analytics come from actual submission data. Implemented by the attempt engine.
 */
export async function seedActivity(_ctx: {
  dsMidterm: Exam;
  physicsQuiz: Exam;
  qualifier: Exam;
  students: User[];
  ali: User;
  ayesha: User;
  staff: { sara: User; omar: User; bilal: User; hina: User };
}): Promise<void> {}

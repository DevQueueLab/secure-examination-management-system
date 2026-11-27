import type { Page } from '@playwright/test';
import { examByTitle, sessionAs, signIn, type ApiSession } from './support/api';
import { itemOfType, saveAnswers, startAttempt, submitAttempt } from './support/attempts';
import { EXAMS } from './support/env';
import { expect, test } from './support/fixtures';

interface QueueQuestion {
  questionId: string;
  title: string;
  type: string;
}
interface RubricItem {
  label: string;
  points: number;
  target: 'answer' | 'working';
}

/** Opens one question in the grading workspace, picks the response carrying `marker` and grades it with two rubric lines. */
async function gradeWithRubric(page: Page, grader: ApiSession, examId: string, question: QueueQuestion, marker: string): Promise<number> {
  const rubric = await grader.get<{ items: RubricItem[] }>(`/grading/exams/${examId}/questions/${question.questionId}/rubric`);
  const lines = rubric.body.items.filter((i) => i.target === 'answer' && i.points > 0).slice(0, 2);
  expect(lines, `${question.title} has rubric lines to grade with`).toHaveLength(2);

  await page.goto(`/exams/${examId}/grading?q=${question.questionId}`);
  await page.getByRole('navigation', { name: 'Responses' }).getByRole('button', { name: new RegExp(marker) }).click();

  const panel = page.getByRole('complementary', { name: 'Rubric and score' });
  for (const line of lines) {
    const box = panel.getByRole('checkbox', { name: new RegExp(escapeRegExp(line.label)) });
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');
  }
  await panel.getByLabel('Feedback').fill(`Graded against the rubric: ${lines.map((l) => l.label).join('; ')}.`);
  await panel.getByRole('button', { name: 'Save and next' }).click();

  const total = lines.reduce((sum, l) => sum + l.points, 0);
  // The saved grade shows on the response in the list.
  const response = page.getByRole('navigation', { name: 'Responses' }).getByRole('button', { name: new RegExp(marker) });
  await expect(response).toContainText(`${total}/`);
  return total;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const RESTORE_REASON = 'Restoring the unpublished state after the publication check.';

/** Set just before publishing, so the live midterm is put back even if the flow fails or times out midway. */
let publishedExamId: string | null = null;

async function unpublish(owner: ApiSession, examId: string) {
  const status = await owner.get<{ exam: { resultsStatus: string } }>(`/results/exams/${examId}`);
  if (status.body.exam.resultsStatus !== 'published') return;
  const res = await owner.post(`/results/exams/${examId}/unpublish`, { reason: RESTORE_REASON });
  expect(res.status, 'results unpublish again').toBe(200);
}

test.describe('grading to publication', () => {
  // Other flows expect the live midterm's results to stay unpublished.
  test.afterAll(async () => {
    if (!publishedExamId) return;
    const owner = await sessionAs('sara');
    await unpublish(owner, publishedExamId);
    await owner.dispose();
  });

  test('rubric grades reach the candidate only when results are published', async ({ candidate, pageAs, apiAs }) => {
    test.setTimeout(240_000);
    const owner = await apiAs('sara');
    const grader = await apiAs('bilal');
    const exam = await examByTitle(owner, EXAMS.midterm);
    const before = await owner.get<{ exam: { resultsStatus: string } }>(`/results/exams/${exam.id}`);
    expect(before.body.exam.resultsStatus, 'DS Midterm results start unpublished').toBe('unpublished');

    // The candidate sits the paper and submits two written answers that only a person can mark.
    const marker = `QA-${Date.now().toString(36)}`;
    const sitter = await signIn(candidate.email);
    const attempt = await startAttempt(sitter, exam.id);
    const essay = itemOfType(attempt, 'long_text');
    const code = itemOfType(attempt, 'code');
    await saveAnswers(sitter, attempt.id, [
      {
        itemId: essay.id,
        response: {
          text:
            `${marker} A process is an independent program in execution with its own address space, file handles and other resources, ` +
            'isolated from every other process by the operating system. A thread is a unit of execution inside a process: threads share ' +
            'the memory and open files of their process, but each has its own stack, registers and program counter. Threads suit a web ' +
            'server that handles many requests at once, because switching between them is cheap and they share caches. The risk is a race ' +
            'condition: two threads updating shared data without a lock can corrupt it, and careless locking can deadlock.',
        },
      },
      {
        itemId: code.id,
        response: {
          code: `# ${marker}\ndef is_palindrome(s):\n    i, j = 0, len(s) - 1\n    while i < j:\n        if not s[i].isalnum():\n            i += 1\n        elif not s[j].isalnum():\n            j -= 1\n        elif s[i].lower() != s[j].lower():\n            return False\n        else:\n            i, j = i + 1, j - 1\n    return True\n`,
        },
      },
    ]);
    await submitAttempt(sitter, attempt.id);

    const candidatePage = await pageAs({ email: candidate.email });
    const expectNoScore = async () => {
      const mine = await sitter.get(`/results/mine/${attempt.id}`);
      expect(mine.status).toBe(200);
      expect(mine.body.published).toBe(false);
      expect(mine.body.result).toBeNull();
      expect((await sitter.get(`/reports/attempts/${attempt.id}/pdf`)).status, 'no report before publication').toBe(409);
      await candidatePage.goto(`/results/${attempt.id}`);
      await expect(candidatePage.getByRole('heading', { name: 'Awaiting publication' })).toBeVisible();
      await expect(candidatePage.getByText(/ of \d+(\.\d+)? marks/)).toHaveCount(0);
    };
    await expectNoScore();

    // The grader marks both answers in the grading workspace with the exam's rubric.
    const queue = await grader.get<{ questions: QueueQuestion[] }>(`/grading/exams/${exam.id}/queue`);
    const written = queue.body.questions.find((q) => q.type === 'long_text');
    const coding = queue.body.questions.find((q) => q.type === 'code');
    expect(written && coding, 'the queue lists the written and code questions').toBeTruthy();
    const gradingPage = await pageAs('bilal');
    const essayMarks = await gradeWithRubric(gradingPage, grader, exam.id, written!, marker);
    const codeMarks = await gradeWithRubric(gradingPage, grader, exam.id, coding!, marker);

    // Grading alone reveals nothing to the candidate.
    await expectNoScore();

    // The owner publishes. The window is still open, so the checklist asks for an explicit override and a reason.
    const ownerPage = await pageAs('sara');
    await ownerPage.goto(`/exams/${exam.id}/results`);
    await ownerPage.getByRole('button', { name: 'Review and publish' }).click();
    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog.getByText('Exam window closed')).toBeVisible();
    await dialog.getByRole('checkbox', { name: /Publish anyway/ }).click();
    await dialog.getByLabel('Reason').fill('Publishing early for the end-to-end publication check.');
    publishedExamId = exam.id;
    await dialog.getByRole('button', { name: 'Publish anyway' }).click();
    await expect(ownerPage.getByText('Results published').first()).toBeVisible();

    // The candidate now sees the rubric marks in their result.
    const mine = await sitter.get(`/results/mine/${attempt.id}`);
    expect(mine.body.published).toBe(true);
    expect(mine.body.result.score).toBe(essayMarks + codeMarks);
    await candidatePage.goto(`/results/${attempt.id}`);
    await expect(candidatePage.getByText(`${essayMarks + codeMarks} of ${mine.body.result.maxScore} marks`)).toBeAttached();
    await expect(candidatePage.getByRole('button', { name: 'Download PDF report' })).toBeVisible();
    await candidatePage.goto('/results');
    await expect(candidatePage.getByRole('link', { name: new RegExp(escapeRegExp(EXAMS.midterm)) })).not.toContainText('Awaiting publication');

    // Unpublishing takes the score away again.
    await unpublish(owner, exam.id);
    await expectNoScore();
    await sitter.dispose();
  });
});

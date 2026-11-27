import { answerShownQuestion, attemptView, expectAllSaved, goToQuestion, navCell, questionHeading, snapshot, startFromHome } from './support/exam';
import { expect, test } from './support/fixtures';

test('a second tab locks, and “continue in this tab” moves the exam with every answer', async ({ pageAs, candidate }) => {
  const first = await pageAs(candidate);
  const attemptId = await startFromHome(first);
  const view = await attemptView(first, attemptId);
  await answerShownQuestion(first, view.items[0]!);
  await expectAllSaved(first);

  const second = await first.context().newPage();
  await second.goto(`/attempt/${attemptId}`);
  const lockedHere = second.getByRole('heading', { level: 1, name: 'Your exam is open in another tab' });
  await expect(lockedHere).toBeVisible({ timeout: 30_000 });
  await snapshot(second, 'second tab locked');
  await second.getByRole('button', { name: 'Continue in this tab' }).click();
  await expect(questionHeading(second)).toBeVisible({ timeout: 30_000 });
  await expect(navCell(second, 1)).toHaveAccessibleName(/^Question 1, answered/);

  // The first tab gave the exam up.
  await expect(first.getByRole('heading', { level: 1, name: 'Your exam is open in another tab' })).toBeVisible({ timeout: 15_000 });

  await goToQuestion(second, 2);
  await answerShownQuestion(second, view.items[1]!);
  await expectAllSaved(second);
  const saved = await attemptView(second, attemptId);
  expect(saved.answers.filter((a) => a.response != null).length).toBe(2);
});

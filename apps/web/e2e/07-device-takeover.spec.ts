import { answerShownQuestion, attemptView, expectAllSaved, goToQuestion, navCell, questionHeading, snapshot, startFromHome } from './support/exam';
import { expect, test } from './support/fixtures';

test('a second device takes the exam over, the first one locks, and claiming back restores everything', async ({ pageAs, candidate }) => {
  const first = await pageAs(candidate);
  const attemptId = await startFromHome(first);
  const view = await attemptView(first, attemptId);
  await answerShownQuestion(first, view.items[0]!);
  await expectAllSaved(first);

  // Same person, new sign-in: a second device.
  const second = await pageAs({ email: candidate.email });
  await second.goto(`/attempt/${attemptId}`);
  await expect(second.getByRole('heading', { level: 1, name: 'Your exam is open on another device' })).toBeVisible({ timeout: 30_000 });
  await second.getByRole('button', { name: 'Continue on this device' }).click();
  await expect(questionHeading(second)).toBeVisible({ timeout: 30_000 });
  await expect(navCell(second, 1)).toHaveAccessibleName(/^Question 1, answered/);
  await goToQuestion(second, 2);
  await answerShownQuestion(second, view.items[1]!);
  await expectAllSaved(second);

  // The first device learns at its next heartbeat at the latest, and stops saving.
  await expect(first.getByRole('heading', { level: 1, name: 'Your exam is open on another device' })).toBeVisible({ timeout: 40_000 });
  await snapshot(first, 'first device locked');
  await first.getByRole('button', { name: 'Continue on this device' }).click();
  await expect(questionHeading(first)).toBeVisible({ timeout: 30_000 });
  await expect(navCell(first, 1)).toHaveAccessibleName(/^Question 1, answered/);
  await expect(navCell(first, 2)).toHaveAccessibleName(/^Question 2, answered/);

  // And the second device is the one locked out now.
  await expect(second.getByRole('heading', { level: 1, name: 'Your exam is open on another device' })).toBeVisible({ timeout: 40_000 });
});

import { NEEDS_DATABASE, attemptRow, closeDatabase, hasDatabase, setDeadlineIn } from './support/db';
import { answerShownQuestion, attemptView, expectAllSaved, goToQuestion, postAsPage, receiptCode, snapshot, startFromHome } from './support/exam';
import { expect, test } from './support/fixtures';

test.skip(!hasDatabase, NEEDS_DATABASE);
test.afterAll(closeDatabase);

test('the server deadline ends the sitting: time up, a receipt, and late answers refused', async ({ pageAs, candidate }) => {
  const page = await pageAs(candidate);
  const attemptId = await startFromHome(page);
  const view = await attemptView(page, attemptId);
  await answerShownQuestion(page, view.items[0]!);
  await expectAllSaved(page);

  // The deadline lives on the server; move it to a few seconds from now and let the page learn it.
  await setDeadlineIn(attemptId, 12);
  await page.reload();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/^Time remaining: \d+ seconds$/, { timeout: 20_000 });

  await expect(page.getByRole('heading', { level: 1, name: /Time is up|Submitted/ })).toBeVisible({ timeout: 45_000 });
  const code = await receiptCode(page);
  await snapshot(page, 'receipt after time ran out');
  expect(code).toMatch(/^RCPT-/);
  await expect(page.getByText('Submitted automatically when time ran out.')).toBeVisible();

  const row = await attemptRow(attemptId);
  expect(row?.status).toBe('submitted');
  expect(row?.submit_reason).toBe('timeout');

  const late = await postAsPage(page, `/attempts/${attemptId}/sync`, {
    answers: [{ itemId: view.items[1]!.id, revision: 1, response: { value: 'late' } }],
  });
  const body = await late.json();
  expect(late.status() === 409 || body.rejected?.some((r: { reason: string }) => r.reason === 'closed')).toBe(true);

  // The answer given in time counts; nothing sent after the deadline does.
  const receipt = await (await page.request.get(`/api/v1/attempts/${attemptId}/receipt`)).json();
  expect(receipt.receiptCode).toBe(code);
  expect(receipt.answeredCount).toBe(1);
});

test('time that runs out offline seals the answers on the device; on reconnect they are held for the examiner', async ({ pageAs, apiAs, candidate }) => {
  const page = await pageAs(candidate);
  const attemptId = await startFromHome(page);
  const view = await attemptView(page, attemptId);

  // A deadline the page knows about, close enough to run out while the device is offline.
  await setDeadlineIn(attemptId, 25);
  await page.reload();
  await answerShownQuestion(page, view.items[0]!);
  await expectAllSaved(page);

  await page.context().setOffline(true);
  await goToQuestion(page, 2);
  await answerShownQuestion(page, view.items[1]!);
  await expect(page.getByRole('heading', { level: 1, name: 'Time is up' })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('1 answer sealed on this device')).toBeVisible();
  await expect(page.getByText(/Waiting for a connection/)).toBeVisible();
  await snapshot(page, 'sealed offline at time up');

  // The server finalized on time with what it held: the answer given in time, not the offline one.
  await expect.poll(async () => (await attemptRow(attemptId))?.submit_reason, { timeout: 20_000 }).toBe('timeout');

  await page.context().setOffline(false);
  await receiptCode(page);
  await expect(page.getByText('1 answer reached Athena after the deadline. Your examiner reviews them before they count.')).toBeVisible();

  const staff = await apiAs('sara');
  const held = await staff.get(`/attempts/exams/${view.examId}/offline-journals`);
  expect(held.status).toBe(200);
  expect(JSON.stringify(held.body)).toContain(candidate.email);
  const receipt = await (await page.request.get(`/api/v1/attempts/${attemptId}/receipt`)).json();
  expect(receipt.answeredCount).toBe(1);
});

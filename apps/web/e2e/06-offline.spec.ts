import {
  ESSAY,
  answerShownQuestion,
  attemptView,
  expectAllSaved,
  goToQuestion,
  openReview,
  paper,
  receiptCode,
  snapshot,
  startFromHome,
} from './support/exam';
import { expect, test } from './support/fixtures';

const answered = (view: Awaited<ReturnType<typeof attemptView>>, itemId: string) =>
  view.answers.some((a) => a.itemId === itemId && a.response != null);

test.describe('answers are kept on the device first', () => {
  test('answers given offline are sent when the connection returns', async ({ pageAs, candidate }) => {
    const page = await pageAs(candidate);
    const attemptId = await startFromHome(page);
    const view = await attemptView(page, attemptId);
    await expectAllSaved(page);

    await page.context().setOffline(true);
    await goToQuestion(page, 1);
    await answerShownQuestion(page, view.items[0]!);
    await goToQuestion(page, 2);
    await answerShownQuestion(page, view.items[1]!);
    await expect(page.getByRole('button', { name: /^Offline\. 2 answers saved on this device/ })).toBeVisible({ timeout: 15_000 });
    await snapshot(page, 'offline with two answers on the device');

    const whileOffline = await attemptView(page, attemptId);
    expect(answered(whileOffline, view.items[0]!.id) || answered(whileOffline, view.items[1]!.id)).toBe(false);

    await page.context().setOffline(false);
    await expectAllSaved(page);
    const after = await attemptView(page, attemptId);
    for (const item of view.items.slice(0, 2)) expect(answered(after, item.id), `item ${item.id} reached the server`).toBe(true);
  });

  test('an answer the server never received survives a reload', async ({ pageAs, candidate }) => {
    const page = await pageAs(candidate);
    const attemptId = await startFromHome(page);
    const view = await attemptView(page, attemptId);
    const essay = view.items.findIndex((i) => i.type === 'long_text') + 1;

    // Every save fails, as on a flaky connection; the answer can only live on the device.
    await page.route('**/api/v1/attempts/*/sync', (route) => route.abort('connectionfailed'));
    await goToQuestion(page, essay);
    await answerShownQuestion(page, view.items[essay - 1]!);
    await expect(page.getByRole('button', { name: /^(Sync failed|Reconnecting)/ })).toBeVisible({ timeout: 15_000 });
    expect(answered(await attemptView(page, attemptId), view.items[essay - 1]!.id)).toBe(false);

    await page.reload();
    await goToQuestion(page, essay);
    await expect(paper(page).getByLabel('Your answer', { exact: true })).toHaveValue(ESSAY);

    await page.unroute('**/api/v1/attempts/*/sync');
    await expectAllSaved(page);
    expect(answered(await attemptView(page, attemptId), view.items[essay - 1]!.id)).toBe(true);
  });

  test('offline answers survive closing the tab and are sent when the exam is reopened', async ({ pageAs, candidate }) => {
    const page = await pageAs(candidate);
    const attemptId = await startFromHome(page);
    const view = await attemptView(page, attemptId);
    await expectAllSaved(page);

    const context = page.context();
    await context.setOffline(true);
    await answerShownQuestion(page, view.items[0]!);
    await expect(page.getByRole('button', { name: /^Offline\. 1 answer saved on this device/ })).toBeVisible({ timeout: 15_000 });
    await page.close();

    await context.setOffline(false);
    const reopened = await context.newPage();
    await reopened.goto(`/attempt/${attemptId}`);
    await expectAllSaved(reopened);
    expect(answered(await attemptView(reopened, attemptId), view.items[0]!.id)).toBe(true);
  });

  test('submitting while offline is refused with a clear message, then works once back online', async ({ pageAs, candidate }) => {
    const page = await pageAs(candidate);
    const attemptId = await startFromHome(page);
    const view = await attemptView(page, attemptId);
    await expectAllSaved(page);

    await page.context().setOffline(true);
    await answerShownQuestion(page, view.items[0]!);
    const sheet = await openReview(page);
    await sheet.getByRole('checkbox', { name: /I’m ready to submit/ }).check();
    await sheet.getByRole('button', { name: 'Submit exam' }).click();
    await expect(sheet.getByRole('alert')).toHaveText(/You’re offline, so your exam can’t be submitted yet/, { timeout: 20_000 });
    await snapshot(page, 'submit refused offline');

    await page.context().setOffline(false);
    // The open sheet hides the header from assistive technology, so read the save pill's text instead of its role.
    await expect(page.getByText(/^All changes saved/)).toBeVisible({ timeout: 20_000 });
    await sheet.getByRole('button', { name: 'Submit exam' }).click();
    await receiptCode(page);
    const receipt = await (await page.request.get(`/api/v1/attempts/${attemptId}/receipt`)).json();
    expect(receipt.answeredCount).toBe(1);
  });
});

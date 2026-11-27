import {
  CODE,
  ESSAY,
  answerShownQuestion,
  attemptView,
  expectAllSaved,
  goToQuestion,
  honorCode,
  navCell,
  openReview,
  paper,
  postAsPage,
  receiptCode,
  snapshot,
  startFromLobby,
  submitFromReview,
  type Receipt,
} from './support/exam';
import { expect, test } from './support/fixtures';

test.describe('a candidate sits the DS Midterm', () => {
  test('answers every question type, survives a reload, flags, reviews and submits once', async ({ pageAs, candidate }) => {
    const page = await pageAs(candidate);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 3, name: 'Data Structures & Algorithms Midterm' })).toBeVisible();
    await page.getByRole('link', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/take\//);

    await test.step('the lobby holds Start until the honor code is accepted', async () => {
      const start = page.getByRole('button', { name: 'Start exam' });
      await expect(start).toBeDisabled();
      await expect(page.locator('#start-reason')).toHaveText('Accept the honor code to begin.');
      // Pressing it anyway (it stays focusable for screen readers) must not start the exam.
      await start.click({ force: true });
      await expect(page).toHaveURL(/\/take\//);
      await honorCode(page).check();
      await expect(start).toBeEnabled();
      await snapshot(page, 'lobby');
    });

    const attemptId = await startFromLobby(page);
    const view = await attemptView(page, attemptId);
    const total = view.items.length;
    const types = new Set(view.items.map((i) => i.type));
    // Section A draws four of eight; Sections B and C fix the remaining seven types on every paper.
    for (const type of ['numeric', 'multiple_choice', 'fill_blanks', 'matching', 'ordering', 'long_text', 'code']) {
      expect(types, `the paper has a ${type} question`).toContain(type);
    }

    // Leave the last question for the review sheet to point at.
    const last = total;
    await test.step('answer every question but the last', async () => {
      for (let n = 1; n < last; n++) {
        await goToQuestion(page, n);
        await answerShownQuestion(page, view.items[n - 1]!);
        await expect(navCell(page, n)).toHaveAccessibleName(new RegExp(`^Question ${n}, answered`));
      }
      await expectAllSaved(page);
      await snapshot(page, 'workspace');
    });

    await test.step('flag a question for review', async () => {
      await goToQuestion(page, 2);
      await paper(page).getByRole('button', { name: 'Flag', exact: true }).click();
      await expect(paper(page).getByRole('button', { name: 'Flagged' })).toHaveAttribute('aria-pressed', 'true');
      await expect(navCell(page, 2)).toHaveAccessibleName(/flagged/);
      await expectAllSaved(page);
    });

    await test.step('a reload keeps every answer and the flag', async () => {
      await page.reload();
      await expect(navCell(page, 1)).toBeVisible({ timeout: 30_000 });
      for (let n = 1; n < last; n++) await expect(navCell(page, n)).toHaveAccessibleName(new RegExp(`^Question ${n}, answered`));
      await expect(navCell(page, last)).toHaveAccessibleName(new RegExp(`^Question ${last}, not answered`));
      await expect(navCell(page, 2)).toHaveAccessibleName(/flagged/);

      const essay = view.items.findIndex((i) => i.type === 'long_text') + 1;
      const code = view.items.findIndex((i) => i.type === 'code') + 1;
      const numeric = view.items.findIndex((i) => i.type === 'numeric') + 1;
      if (essay !== last) {
        await goToQuestion(page, essay);
        await expect(paper(page).getByLabel('Your answer', { exact: true })).toHaveValue(ESSAY);
      }
      if (code !== last) {
        await goToQuestion(page, code);
        await expect(paper(page).getByLabel('Your code')).toHaveValue(CODE);
      }
      if (numeric !== last) {
        await goToQuestion(page, numeric);
        await expect(paper(page).getByLabel(/^Your answer/)).toHaveValue('15');
      }
    });

    await test.step('the server holds every saved answer', async () => {
      const saved = await attemptView(page, attemptId);
      const answered = saved.answers.filter((a) => a.response !== null && a.response !== undefined);
      expect(answered.length).toBe(total - 1);
    });

    await test.step('the review sheet lists the unanswered question', async () => {
      const sheet = await openReview(page);
      const unanswered = sheet.getByRole('list', { name: 'Unanswered' });
      await expect(unanswered.getByRole('button')).toHaveCount(1);
      await expect(unanswered.getByRole('button', { name: `Go to question ${last}` })).toBeVisible();
      await expect(sheet.getByRole('list', { name: 'Flagged for review' }).getByRole('button', { name: 'Go to question 2' })).toBeVisible();
      await expect(sheet.getByText('1 question is still unanswered.')).toBeVisible();
      await snapshot(page, 'review sheet');

      await unanswered.getByRole('button', { name: `Go to question ${last}` }).click();
      await expect(paper(page).getByRole('heading', { level: 2, name: `Question ${last} of ${total}` })).toBeVisible();
      await answerShownQuestion(page, view.items[last - 1]!);
    });

    // Submitted straight after the last answer, without waiting for the autosave: the hand-in must carry it.
    const code = await test.step('submit needs the confirmation, then shows a receipt', async () => {
      const sheet = await openReview(page);
      await expect(sheet.getByRole('list', { name: 'Unanswered' })).toHaveCount(0);
      return submitFromReview(page, sheet);
    });
    expect(code).toMatch(/^RCPT-/);
    await snapshot(page, 'receipt');
    const receiptFigure = (term: string) => page.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
    await expect(receiptFigure('Unanswered')).toHaveText('0');
    await expect(receiptFigure('Flagged')).toHaveText('1');

    await test.step('a second submit returns the same receipt', async () => {
      const again = await postAsPage(page, `/attempts/${attemptId}/submit`, { confirm: true });
      expect(again.status()).toBe(200);
      expect(((await again.json()) as Receipt).receiptCode).toBe(code);
    });

    await test.step('an answer sent after submission is refused', async () => {
      const late = await postAsPage(page, `/attempts/${attemptId}/sync`, {
        answers: [{ itemId: view.items[0]!.id, revision: 99, response: null }],
      });
      const body = await late.json();
      expect(late.status() === 409 || body.rejected?.some((r: { reason: string }) => r.reason === 'closed')).toBe(true);
    });

    await test.step('home lists the exam as awaiting results, and the receipt stays one click away', async () => {
      await page.goto('/dashboard');
      const awaiting = page.getByRole('link', { name: 'Awaiting results' });
      await expect(awaiting).toBeVisible();
      // Cards have loaded: no score (out of the paper's 40 marks) may appear before publication.
      await expect(page.getByText(/\d+(\.\d+)?\s*\/\s*40\b/)).toHaveCount(0);
      await awaiting.click();
      expect(await receiptCode(page)).toBe(code);
    });
  });
});

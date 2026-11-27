import type { Page } from '@playwright/test';
import { examByTitle } from './support/api';
import { EXAMS } from './support/env';
import { answerShownQuestion, attemptView, expectAllSaved, receiptCode, startFromHome } from './support/exam';
import { expect, test } from './support/fixtures';

/** Whole minutes on the candidate's timer, from its spoken label ("Time remaining: 1 hour 9 minutes"). */
async function minutesLeft(page: Page): Promise<number> {
  const label = (await page.getByRole('timer').first().getAttribute('aria-label')) ?? '';
  const hours = Number(/(\d+) hours?/.exec(label)?.[1] ?? 0);
  const minutes = Number(/(\d+) minutes?/.exec(label)?.[1] ?? 0);
  return hours * 60 + minutes;
}

const toast = (page: Page, title: string) => page.locator('[data-sonner-toast]').filter({ hasText: title });

test.describe('live monitoring', () => {
  test('the proctor follows a candidate live, then messages, extends and force submits', async ({ pageAs, apiAs, candidate }) => {
    const registrar = await apiAs('registrar');
    const { id: examId } = await examByTitle(registrar, EXAMS.midterm);

    // The candidate sits the exam in one browser...
    const exam = await pageAs({ email: candidate.email });
    const attemptId = await startFromHome(exam);
    const view = await attemptView(exam, attemptId);

    // ...while the exam's proctor watches the control room in another.
    const monitor = await pageAs('hina');
    await monitor.goto(`/exams/${examId}/monitor`);
    // The socket is up ("Polling" would mean the page fell back to refreshing).
    await expect(monitor.getByRole('status').filter({ hasText: /^(Connected|Live)$/ })).toBeVisible();
    // The roster's progress gauge for this candidate (the phone card list is hidden at this width).
    const answered = monitor.getByLabel(`${candidate.name}: questions answered`, { exact: true }).filter({ visible: true });
    await expect(answered).toHaveAttribute('aria-valuenow', '0');
    const actions = monitor.getByRole('button', { name: `Actions for ${candidate.name}` });

    await test.step('the roster moves as the candidate answers', async () => {
      await answerShownQuestion(exam, view.items[0]!);
      await expectAllSaved(exam);
      // A socket push, well inside the 30-second poll the monitor otherwise relies on.
      await expect(answered).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
    });

    await test.step('a message from the monitor appears in the workspace at once', async () => {
      const body = `Section C is marked out of 12. (${Date.now().toString(36)})`;
      await actions.click();
      await monitor.getByRole('menuitem', { name: 'Message…' }).click();
      const dialog = monitor.getByRole('dialog', { name: `Message ${candidate.name}` });
      await dialog.getByPlaceholder(`Write to ${candidate.name}…`).fill(body);
      await dialog.getByRole('button', { name: /^Send to / }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(exam, 'New announcement')).toContainText(body);
    });

    await test.step('extra time raises the candidate’s timer', async () => {
      const before = await minutesLeft(exam);
      await actions.click();
      await monitor.getByRole('menuitem', { name: 'Extend time…' }).click();
      const dialog = monitor.getByRole('dialog', { name: `More time for ${candidate.name}` });
      await expect(dialog.getByRole('radio', { name: '10 min' })).toBeChecked();
      await dialog.getByPlaceholder('What happened?').fill('Connection problem at the venue');
      await dialog.getByRole('button', { name: 'Add 10 minutes' }).click();
      await expect(dialog).toBeHidden();

      await expect(toast(exam, '10 more minutes')).toBeVisible();
      await expect.poll(() => minutesLeft(exam)).toBeGreaterThanOrEqual(before + 9);
    });

    await test.step('force submit seals the candidate’s screen with a receipt', async () => {
      await actions.click();
      await monitor.getByRole('menuitem', { name: 'Force submit…' }).click();
      const confirm = monitor.getByRole('alertdialog');
      await confirm.getByPlaceholder(/^For example/).fill('Ended by the proctor after a warning');
      await confirm.getByRole('button', { name: 'Submit attempt' }).click();
      await expect(confirm).toBeHidden();

      await receiptCode(exam);
      await expect(exam.getByText('Submitted by your proctor.')).toBeVisible();
      const sealed = await attemptView(exam, attemptId);
      expect(sealed.status).toBe('submitted');
    });
  });
});

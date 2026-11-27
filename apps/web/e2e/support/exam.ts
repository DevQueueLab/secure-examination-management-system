import { expect, test, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from './env';

/**
 * Saves what the candidate sees right now next to the test's results and attaches it to the report, for visual
 * review. Viewport only: full-page captures misplace the fixed sidebar and header.
 */
export async function snapshot(page: Page, name: string) {
  const path = test.info().outputPath(`${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** The parts of the server's attempt view the flows read. */
export interface AttemptItem {
  id: string;
  type: string;
  marks: number;
  workingMarks: number;
  content: Record<string, unknown>;
}
export interface AttemptView {
  id: string;
  examId: string;
  status: string;
  deadlineAt: string;
  items: AttemptItem[];
  answers: { itemId: string; revision: number; response: unknown; flagged?: boolean }[];
}
export interface Receipt {
  receiptCode: string;
  status: string;
  submitReason?: string;
  answeredCount: number;
  itemCount: number;
}

export const ESSAY =
  'A process owns its own address space and resources, while threads share the address space of the process they belong to. ' +
  'Switching between threads is cheaper because no address-space change is needed, but a crash in one thread can bring down the whole process.';
export const CODE = 'def is_palindrome(s):\n    t = "".join(ch.lower() for ch in s if ch.isalnum())\n    return t == t[::-1]\n';

/** The page's own session calls the API, so no second session ever takes the attempt over. */
export async function attemptView(page: Page, attemptId: string): Promise<AttemptView> {
  const res = await page.request.get(`/api/v1/attempts/${attemptId}`);
  expect(res.status(), `GET /attempts/${attemptId}`).toBe(200);
  return res.json();
}

export async function postAsPage(page: Page, path: string, data: unknown = {}) {
  return page.request.post(`/api/v1${path}`, { data, headers: { Origin: BASE_URL } });
}

/** From the candidate home: open the exam's lobby, accept the honor code and start. Returns the attempt id. */
export async function startFromHome(page: Page): Promise<string> {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start' }).first().click();
  await expect(page).toHaveURL(/\/take\//);
  return startFromLobby(page);
}

export function honorCode(page: Page): Locator {
  return page.getByRole('checkbox', { name: /I will complete this examination on my own/ });
}

export async function startFromLobby(page: Page): Promise<string> {
  await honorCode(page).check();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await page.waitForURL(/\/attempt\/[0-9a-f-]{36}/);
  await expect(questionHeading(page)).toBeVisible({ timeout: 30_000 });
  return page.url().split('/attempt/')[1]!.split(/[?#]/)[0]!;
}

export const paper = (page: Page) => page.locator('#paper');
export const navigatorRail = (page: Page) => page.getByRole('complementary', { name: 'Question navigator' });
export const questionHeading = (page: Page) => paper(page).getByRole('heading', { level: 2, name: /^Question \d+ of \d+$/ });
export const savePill = (page: Page) => page.getByRole('button', { name: /^All changes saved/ });

/** A navigator cell, e.g. `navCell(page, 3)` is "Question 3, answered, flagged…". */
export function navCell(page: Page, number: number): Locator {
  return navigatorRail(page).getByRole('button', { name: new RegExp(`^Question ${number},`) });
}

export async function goToQuestion(page: Page, number: number) {
  await navCell(page, number).click();
  await expect(paper(page).getByRole('heading', { level: 2, name: new RegExp(`^Question ${number} of `) })).toBeVisible();
}

/** Answers the question on screen the way a candidate would, whatever its type. */
export async function answerShownQuestion(page: Page, item: AttemptItem) {
  const area = paper(page);
  switch (item.type) {
    case 'single_choice':
      await area.getByRole('group', { name: 'Choose one answer' }).locator('label').first().click();
      break;
    case 'true_false':
      await area.getByRole('group', { name: 'True or false' }).locator('label', { hasText: 'True' }).click();
      break;
    case 'multiple_choice': {
      const options = area.getByRole('group', { name: 'Choose every answer that applies' }).locator('label');
      await options.nth(0).click();
      await options.nth(1).click();
      break;
    }
    case 'numeric':
      await area.getByLabel(/^Your answer/).fill('15');
      break;
    case 'short_text':
      await area.getByLabel('Your answer', { exact: true }).fill('stack');
      break;
    case 'fill_blanks':
      for (const blank of await area.getByRole('textbox', { name: /^Blank \d+/ }).all()) await blank.fill('Dijkstra');
      break;
    case 'matching': {
      const selects = area.getByRole('combobox');
      const count = await selects.count();
      for (let i = 0; i < count; i++) {
        await selects.nth(i).click();
        // The first option is "Not answered"; give each prompt a different answer.
        await page.getByRole('option').nth(i + 1).click();
      }
      break;
    }
    case 'ordering':
      await area.getByRole('button', { name: /^Move down from position 1 of/ }).click();
      break;
    case 'long_text':
      await area.getByLabel('Your answer', { exact: true }).fill(ESSAY);
      break;
    case 'code':
      await area.getByLabel('Your code').fill(CODE);
      break;
    default:
      throw new Error(`no way to answer a ${item.type} question`);
  }
}

export async function expectAllSaved(page: Page) {
  await expect(savePill(page)).toBeVisible({ timeout: 20_000 });
}

export async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Review & submit' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Review and submit' });
  await expect(sheet).toBeVisible();
  // Once the sheet has slid in, its submit button sits wholly on screen.
  await expect(sheet.getByRole('button', { name: 'Submit exam' })).toBeInViewport({ ratio: 1 });
  return sheet;
}

/** Confirms and submits from the review sheet, then waits for the receipt screen. Returns the code shown. */
export async function submitFromReview(page: Page, sheet: Locator): Promise<string> {
  const submit = sheet.getByRole('button', { name: 'Submit exam' });
  await expect(submit).toBeDisabled();
  await sheet.getByRole('checkbox', { name: /I’m ready to submit/ }).check();
  await submit.click();
  return receiptCode(page);
}

/** Waits for the receipt screen and checks it shows exactly the code the server issued. Returns that code. */
export async function receiptCode(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { level: 1, name: 'Submitted' })).toBeVisible({ timeout: 30_000 });
  const attemptId = page.url().split('/attempt/')[1]!.split(/[?#]/)[0]!;
  const res = await page.request.get(`/api/v1/attempts/${attemptId}/receipt`);
  expect(res.status(), 'the server has a receipt').toBe(200);
  const { receiptCode: issued } = (await res.json()) as Receipt;
  expect(issued).toMatch(/^RCPT-/);
  // The code plays a short decoding animation before it settles.
  await expect(page.locator('code').first()).toHaveText(issued);
  return issued;
}

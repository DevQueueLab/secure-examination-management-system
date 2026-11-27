import type { Page } from '@playwright/test';
import { examByTitle, sessionAs } from './support/api';
import { ACCOUNTS, EXAMS } from './support/env';
import { expect, test } from './support/fixtures';

/** Staff endpoints for one exam; another organization must not learn that any of them exist. */
const examEndpoints = (examId: string) => [
  `/exams/${examId}`,
  `/exams/${examId}/enrollments`,
  `/monitoring/exams/${examId}/live`,
  `/grading/exams/${examId}/queue`,
  `/results/exams/${examId}`,
];

async function expectExamHidden(page: Page, examId: string) {
  await page.goto(`/exams/${examId}`);
  await expect(page.getByRole('heading', { name: 'This exam doesn’t exist' })).toBeVisible();
  await expect(page.getByText(EXAMS.midterm)).toHaveCount(0);

  for (const path of examEndpoints(examId)) {
    const res = await page.request.get(`/api/v1${path}`);
    expect(res.status(), path).toBe(404);
  }
}

test.describe('tenant isolation', () => {
  let midtermId: string;
  let riversideId: string;

  test.beforeAll(async () => {
    const registrar = await sessionAs('registrar');
    midtermId = (await examByTitle(registrar, EXAMS.midterm)).id;
    await registrar.dispose();

    // Riverside is seeded suspended; bring it back so its admin can sign in at all.
    const platform = await sessionAs('platformAdmin');
    const list = await platform.get<{ items: { id: string; slug: string }[] }>('/platform/organizations?pageSize=200');
    const riverside = list.body.items.find((org) => org.slug === 'riverside');
    if (!riverside) throw new Error('the seed has no Riverside organization');
    riversideId = riverside.id;
    const reactivated = await platform.post(`/platform/organizations/${riversideId}/reactivate`);
    expect(reactivated.status).toBe(200);
    await platform.dispose();
  });

  test.afterAll(async () => {
    const platform = await sessionAs('platformAdmin');
    await platform.post(`/platform/organizations/${riversideId}/suspend`, { reason: 'Restore the seeded suspension after the isolation check' });
    await platform.dispose();
  });

  test('Riverside’s admin opening a Northfield exam gets not found, in the page and from the API', async ({ pageAs }) => {
    await expectExamHidden(await pageAs({ email: ACCOUNTS.riverside }), midtermId);
  });

  test('CodeSprint’s organizer opening a Northfield exam gets not found too', async ({ pageAs }) => {
    await expectExamHidden(await pageAs('organizer'), midtermId);
  });
});

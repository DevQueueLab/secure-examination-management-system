import { enrollments, examByTitle, signIn, type ApiSession } from './support/api';
import { ACCOUNTS, EXAMS } from './support/env';
import { expect, test } from './support/fixtures';

interface ResultItem {
  itemId: string;
  number: number;
  title: string;
  outcome: string;
  parts: { working: { score: number | null; max: number } | null };
  /** Rubric lines a grader ticked; a working line here means a person marked the working. */
  rubric: { target: 'answer' | 'working' }[];
}

interface Target {
  email: string;
  attemptId: string;
  itemId: string;
  number: number;
  title: string;
  workingScore: number;
  workingMax: number;
  paperScore: number;
}

/**
 * A Mechanics Quiz 3 sitter whose working on some question was marked by a grader with the rubric and still lost
 * marks, with no open dispute about it: the natural case for a grading dispute, and one with a grader to exclude.
 * (A blank working scores zero without any grader, so it cannot show the conflict rule.) Each run uses one up.
 */
async function findDisputableWorking(owner: ApiSession, examId: string): Promise<Target> {
  const demo: string[] = [ACCOUNTS.ali, ACCOUNTS.ayesha];
  const sitters = (await enrollments(owner, examId))
    .filter((e) => e.attempt?.status === 'submitted' && !demo.includes(e.email))
    .sort((a, b) => a.email.localeCompare(b.email));
  for (const sitter of sitters) {
    const attemptId = sitter.attempt!.id;
    const session = await signIn(sitter.email);
    try {
      const context = await session.get(`/disputes/attempts/${attemptId}/context`);
      if (context.status !== 200 || context.body.limits.used >= context.body.limits.max) continue;
      const mine = await session.get(`/results/mine/${attemptId}`);
      const items: ResultItem[] = mine.body.result?.items ?? [];
      for (const item of items) {
        const working = item.parts.working;
        const open = context.body.items.find((i: { id: string; openDispute: unknown }) => i.id === item.itemId)?.openDispute;
        const markedByGrader = item.rubric.some((line) => line.target === 'working');
        if (item.outcome !== 'voided' && working && working.score !== null && working.score < working.max && markedByGrader && !open) {
          return {
            email: sitter.email,
            attemptId,
            itemId: item.itemId,
            number: item.number,
            title: item.title,
            workingScore: working.score,
            workingMax: working.max,
            paperScore: mine.body.result.score,
          };
        }
      }
    } finally {
      await session.dispose();
    }
  }
  throw new Error('No Mechanics Quiz 3 sitter has working marks left to dispute. Re-seed the stack.');
}

test.describe('disputes', () => {
  test('the grader of an answer cannot decide its dispute; a colleague upholds it and the score history shows the change', async ({ pageAs, apiAs }) => {
    test.setTimeout(240_000);
    const owner = await apiAs('omar');
    const grader = await apiAs('bilal');
    const exam = await examByTitle(owner, EXAMS.mechanics);
    const target = await findDisputableWorking(owner, exam.id);
    const stamp = Date.now().toString(36);

    // The candidate raises the dispute from the published result, on the question it is about.
    const candidatePage = await pageAs({ email: target.email });
    await candidatePage.goto(`/results/${target.attemptId}`);
    const question = candidatePage.getByRole('article', { name: new RegExp(`Q${target.number}\\s*${target.title}`) });
    await question.getByRole('link', { name: 'Raise a dispute about this question' }).click();
    await expect(candidatePage).toHaveURL(/\/my-disputes\/new\?attemptId=/);
    await candidatePage.getByRole('radiogroup', { name: 'What went wrong' }).getByRole('radio', { name: /^My answer was marked wrongly/ }).click();
    await expect(candidatePage.getByRole('radio', { name: new RegExp(`^Question ${target.number}: `) })).toBeChecked();
    await candidatePage.getByLabel('Your case').fill(`My working shows every step of the method, but it earned ${target.workingScore} of ${target.workingMax}. (${stamp})`);
    await candidatePage.getByRole('button', { name: 'Submit dispute' }).click();
    await expect(candidatePage).toHaveURL(/\/my-disputes\/[0-9a-f-]{36}$/);
    const disputeId = new URL(candidatePage.url()).pathname.split('/').pop()!;

    // The grader who marked that working sees the dispute but cannot decide it, in the page or through the API.
    const graderPage = await pageAs('bilal');
    await graderPage.goto(`/disputes/${disputeId}`);
    await expect(graderPage.getByText('You graded this answer, so a colleague must decide this dispute.').first()).toBeVisible();
    await expect(graderPage.getByRole('button', { name: 'Decide' })).toBeDisabled();
    const blocked = await grader.post(`/disputes/${disputeId}/resolve`, {
      outcome: 'upheld',
      note: 'Deciding a dispute about my own marking.',
      regrade: { part: 'working', score: target.workingMax },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CONFLICT_OF_INTEREST');

    // The exam owner upholds it and re-marks the working to full marks.
    const note = `Your working shows each step the rubric rewards, so the working now has full marks. (${stamp})`;
    const ownerPage = await pageAs('omar');
    await ownerPage.goto(`/disputes/${disputeId}`);
    await ownerPage.getByRole('button', { name: 'Decide' }).click();
    const dialog = ownerPage.getByRole('dialog', { name: 'Decide this dispute' });
    await dialog.getByRole('radiogroup', { name: 'Outcome' }).getByRole('radio', { name: /^Upheld/ }).click();
    // Re-marking is on by default when the answer has a part a person marks.
    const remark = dialog.getByRole('switch', { name: 'Change the marks' });
    if (!(await remark.isChecked())) await remark.click();
    await expect(remark).toBeChecked();
    const part = dialog.getByRole('radiogroup', { name: 'Part to re-mark' });
    if (await part.isVisible()) await part.getByRole('radio', { name: 'Working' }).click();
    const how = dialog.getByRole('radiogroup', { name: 'How to set the score' });
    if (await how.isVisible()) await how.getByRole('radio', { name: 'Score' }).click();
    await dialog.getByLabel('New working score').fill(String(target.workingMax));
    await dialog.getByLabel('Reason for the candidate').fill(note);
    await dialog.getByRole('button', { name: 'Record decision' }).click();
    await expect(ownerPage.getByText(/Decision recorded/).first()).toBeVisible();

    // The candidate's result carries the new marks, and the score history records the decision with its reason.
    const gained = target.workingMax - target.workingScore;
    const candidate = await signIn(target.email);
    const after = await candidate.get(`/results/mine/${target.attemptId}`);
    expect(after.body.result.score).toBeCloseTo(target.paperScore + gained, 3);
    const history = await candidate.get(`/disputes/attempts/${target.attemptId}/history`);
    expect(JSON.stringify(history.body)).toContain(note);
    await candidate.dispose();

    await candidatePage.goto(`/results/${target.attemptId}`);
    await expect(candidatePage.getByRole('heading', { name: 'Score history' })).toBeVisible();
    await expect(candidatePage.getByText(note)).toBeVisible();
  });
});

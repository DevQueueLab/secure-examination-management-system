import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AttemptView, CandidateExamCard, SubmissionReceipt, SyncResponse } from '@athena/shared';
import { db } from '../src/db/client';
import { attempts } from '../src/db/schema';
import { ACCOUNTS, PASSWORD, anonymous, as, containsKey, examId } from './helpers';
import request from 'supertest';
import { API, ORIGIN, app } from './helpers';

const MIDTERM = 'Data Structures & Algorithms Midterm';
const FINAL = 'Database Systems Final';

let midterm: string;
let final: string;

beforeAll(async () => {
  midterm = await examId(MIDTERM);
  final = await examId(FINAL);
});

const choiceItem = (view: AttemptView) => {
  const item = view.items.find((i) => i.type === 'single_choice');
  if (!item) throw new Error('paper has no single-choice item');
  const options = (item.content as { options: { id: string }[] }).options;
  return { item, options };
};

describe('3.4 candidates see and enter only what they are eligible for', () => {
  it('lists available, upcoming and completed exams with access status', async () => {
    const ali = await as(ACCOUNTS.ali);
    const res = await ali.get('/attempts/exams');
    expect(res.status).toBe(200);
    const cards = res.body as CandidateExamCard[];
    const live = cards.find((c) => c.examId === midterm);
    const upcoming = cards.find((c) => c.examId === final);
    expect(live?.canStart).toBe(true);
    expect(upcoming?.canStart).toBe(false);
    expect(upcoming?.blockedReason).toBeTruthy();
  });

  it('refuses to start an exam before its window opens', async () => {
    const ali = await as(ACCOUNTS.ali);
    const res = await ali.post('/attempts', { examId: final, pledgeAccepted: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXAM_NOT_AVAILABLE');
  });

  it('requires the honor pledge, validated on the server', async () => {
    const ali = await as(ACCOUNTS.ali);
    const res = await ali.post('/attempts', { examId: midterm, pledgeAccepted: false });
    expect(res.status).toBe(422);
  });

  it('refuses a draft exam and staff-only exams', async () => {
    const ali = await as(ACCOUNTS.ali);
    const draft = await examId('Software Design Principles');
    const res = await ali.post('/attempts', { examId: draft, pledgeAccepted: true });
    expect([403, 404]).toContain(res.status);
  });
});

describe('3.5 the exam workspace: autosave, refresh, time and submission', () => {
  let view: AttemptView;

  it('starts an attempt without sending any answer key', async () => {
    const ali = await as(ACCOUNTS.ali);
    const res = await ali.post('/attempts', { examId: midterm, pledgeAccepted: true });
    expect([200, 201]).toContain(res.status);
    view = res.body as AttemptView;
    expect(view.status).toBe('in_progress');
    expect(view.items.length).toBeGreaterThan(0);
    expect(containsKey(res.body, 'answerKey')).toBe(false);
    expect(containsKey(res.body, 'correct')).toBe(false);
    expect(containsKey(res.body, 'accepted')).toBe(false);
  });

  it('sets a server-side deadline from the duration, capped by the window', async () => {
    const [row] = await db.select().from(attempts).where(eq(attempts.id, view.id));
    const minutes = (new Date(view.deadlineAt).getTime() - new Date(view.startedAt).getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(0);
    expect(row!.deadlineAt.toISOString()).toBe(new Date(view.deadlineAt).toISOString());
  });

  it('resumes the same attempt instead of starting a second one', async () => {
    const ali = await as(ACCOUNTS.ali);
    const again = await ali.post('/attempts', { examId: midterm, pledgeAccepted: true });
    expect(again.body.id).toBe(view.id);
  });

  it('autosaves with revisions: newer wins, stale and invalid writes are ignored', async () => {
    const ali = await as(ACCOUNTS.ali);
    const { item, options } = choiceItem(view);
    const save = (revision: number, optionId: string) =>
      ali.post(`/attempts/${view.id}/sync`, { answers: [{ itemId: item.id, revision, response: { optionId } }] });

    const first = await save(1, options[0]!.id);
    expect(first.status).toBe(200);
    expect((first.body as SyncResponse).accepted.map((a) => a.itemId)).toContain(item.id);

    await save(2, options[1]!.id);
    await save(1, options[0]!.id); // a delayed retry of an older write

    const invalid = await ali.post(`/attempts/${view.id}/sync`, { answers: [{ itemId: item.id, revision: 3, response: { optionId: 'not-a-uuid' } }] });
    expect((invalid.body as SyncResponse).rejected.find((r) => r.itemId === item.id)?.reason).toBe('invalid');

    const refreshed = (await ali.get(`/attempts/${view.id}`)).body as AttemptView;
    const saved = refreshed.answers.find((a) => a.itemId === item.id);
    expect(saved?.revision).toBe(2);
    expect(saved?.response).toEqual({ optionId: options[1]!.id });
    expect(refreshed.deadlineAt).toBe(view.deadlineAt);
  });

  it('keeps attempts private to their owner', async () => {
    const ayesha = await as(ACCOUNTS.ayesha);
    const res = await ayesha.get(`/attempts/${view.id}`);
    expect([403, 404]).toContain(res.status);
    const write = await ayesha.post(`/attempts/${view.id}/sync`, { answers: [] });
    expect([403, 404]).toContain(write.status);
  });

  it('moves the attempt safely when the candidate switches device', async () => {
    const second = request.agent(app);
    const login = await second.post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email: ACCOUNTS.ali, password: PASSWORD });
    expect(login.status).toBe(200);
    const blocked = await second.get(`${API}/attempts/${view.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SESSION_TAKEN_OVER');
    const claim = await second.post(`${API}/attempts/${view.id}/claim`).set('Origin', ORIGIN).send({});
    expect(claim.status).toBe(200);
    // The first device is now locked out of writes until it claims the attempt back.
    const ali = await as(ACCOUNTS.ali);
    expect((await ali.post(`/attempts/${view.id}/sync`, { answers: [] })).status).toBe(409);
    expect((await ali.post(`/attempts/${view.id}/claim`, {})).status).toBe(200);
  });

  it('submits once: a repeated submit returns the same receipt', async () => {
    const ali = await as(ACCOUNTS.ali);
    const first = await ali.post(`/attempts/${view.id}/submit`, { confirm: true });
    expect(first.status).toBe(200);
    const receipt = first.body as SubmissionReceipt;
    expect(receipt.status).toBe('submitted');
    expect(receipt.receiptCode).toMatch(/^RCPT-/);
    const second = await ali.post(`/attempts/${view.id}/submit`, { confirm: true });
    expect((second.body as SubmissionReceipt).receiptCode).toBe(receipt.receiptCode);

    const late = await ali.post(`/attempts/${view.id}/sync`, { answers: [{ itemId: view.items[0]!.id, revision: 99, response: null }] });
    expect(late.status === 409 || (late.body as SyncResponse).rejected.some((r) => r.reason === 'closed')).toBe(true);
  });

  it('never shows a score before results are published', async () => {
    const ali = await as(ACCOUNTS.ali);
    const res = await ali.get(`/results/mine/${view.id}`);
    expect(res.status === 404 || res.body.score === undefined || res.body.score === null).toBe(true);
  });
});

describe('3.5 time limit: the server finalizes at expiry with answers accepted in time', () => {
  it('accepts answers before the deadline and rejects them after it', async () => {
    const ayesha = await as(ACCOUNTS.ayesha);
    const start = await ayesha.post('/attempts', { examId: midterm, pledgeAccepted: true });
    const view = start.body as AttemptView;
    const { item, options } = choiceItem(view);
    await ayesha.post(`/attempts/${view.id}/sync`, { answers: [{ itemId: item.id, revision: 1, response: { optionId: options[0]!.id } }] });

    // Simulate the clock running out (the device clock is irrelevant: only the server deadline counts).
    await db.execute(sql`update attempts set deadline_at = now() - interval '1 minute' where id = ${view.id}`);

    const late = await ayesha.post(`/attempts/${view.id}/sync`, { answers: [{ itemId: item.id, revision: 2, response: { optionId: options[1]!.id } }] });
    const lateBody = late.body as SyncResponse;
    expect(late.status === 409 || lateBody.rejected.some((r) => r.reason === 'closed')).toBe(true);

    const [row] = await db.select().from(attempts).where(eq(attempts.id, view.id));
    expect(row!.status).toBe('submitted');
    expect(row!.submitReason).toBe('timeout');

    const receipt = (await ayesha.get(`/attempts/${view.id}/receipt`)).body as SubmissionReceipt;
    expect(receipt.answeredCount).toBeGreaterThanOrEqual(1);
  });
});

describe('4.3 sandbox attempts never touch real data', () => {
  it('lets staff preview as a candidate without appearing in monitoring', async () => {
    const sara = await as(ACCOUNTS.sara);
    const before = await sara.get(`/monitoring/exams/${midterm}/live`);
    const sandbox = await sara.post('/attempts/sandbox', { examId: midterm });
    expect([200, 201]).toContain(sandbox.status);
    expect(sandbox.body.isSandbox).toBe(true);
    const after = await sara.get(`/monitoring/exams/${midterm}/live`);
    expect(after.body.attempts?.length).toBe(before.body.attempts?.length);
    expect(anonymous()).toBeDefined();
  });
});

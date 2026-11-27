import type { ApiSession } from './api';
import type { AttemptItem, AttemptView, Receipt } from './exam';

/** Starts (or resumes) an attempt the way the lobby does: with the honor pledge accepted. */
export async function startAttempt(candidate: ApiSession, examId: string): Promise<AttemptView> {
  const res = await candidate.post<AttemptView>('/attempts', { examId, pledgeAccepted: true });
  if (res.status !== 200 && res.status !== 201) throw new Error(`start attempt: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Saves answers through the autosave endpoint, as the workspace does, and checks every one was accepted. */
export async function saveAnswers(candidate: ApiSession, attemptId: string, answers: { itemId: string; response: Record<string, unknown> }[]) {
  const res = await candidate.post<{ accepted: { itemId: string }[]; rejected: { itemId: string; reason: string }[] }>(`/attempts/${attemptId}/sync`, {
    answers: answers.map((a) => ({ ...a, revision: 1 })),
  });
  if (res.status !== 200 || res.body.rejected.length) throw new Error(`save answers: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function submitAttempt(candidate: ApiSession, attemptId: string): Promise<Receipt> {
  const res = await candidate.post<Receipt>(`/attempts/${attemptId}/submit`, { confirm: true });
  if (res.status !== 200) throw new Error(`submit: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export function itemOfType(view: AttemptView, type: string): AttemptItem {
  const item = view.items.find((i) => i.type === type);
  if (!item) throw new Error(`the paper has no ${type} question`);
  return item;
}

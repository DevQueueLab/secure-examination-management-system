import fs from 'node:fs';
import { request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ACCOUNTS, BASE_URL, EXAMS, PASSWORD, statePath, type Role } from './env';

// Response bodies are asserted field by field in the flows, so they stay loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

/** A signed-in API client that behaves like the browser: same origin, session cookie, Origin header. */
export class ApiSession {
  constructor(
    readonly context: APIRequestContext,
    readonly email: string,
  ) {}

  get<T = Body>(path: string) {
    return this.send<T>('GET', path);
  }
  post<T = Body>(path: string, data?: unknown) {
    return this.send<T>('POST', path, data ?? {});
  }
  put<T = Body>(path: string, data?: unknown) {
    return this.send<T>('PUT', path, data ?? {});
  }
  patch<T = Body>(path: string, data?: unknown) {
    return this.send<T>('PATCH', path, data ?? {});
  }
  delete<T = Body>(path: string) {
    return this.send<T>('DELETE', path);
  }

  async send<T>(method: string, path: string, data?: unknown): Promise<ApiResult<T>> {
    const res = await this.context.fetch(`/api/v1${path}`, { method, data });
    return toResult<T>(res);
  }

  /** Cookies for a browser context, so a page can start already signed in. */
  storageState() {
    return this.context.storageState();
  }

  dispose() {
    return this.context.dispose();
  }
}

async function toResult<T>(res: APIResponse): Promise<ApiResult<T>> {
  const type = res.headers()['content-type'] ?? '';
  const body = type.includes('json') ? await res.json() : await res.body();
  return { status: res.status(), body: body as T, headers: res.headers() };
}

export function newApiContext() {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } });
}

/** Signs in through the public API. Throws with the server's answer when sign-in fails. */
export async function signIn(email: string, password = PASSWORD): Promise<ApiSession> {
  const context = await newApiContext();
  const res = await context.post('/api/v1/auth/login', { data: { email, password } });
  if (res.status() !== 200) {
    const text = await res.text();
    await context.dispose();
    throw new Error(`sign-in failed for ${email}: ${res.status()} ${text}`);
  }
  return new ApiSession(context, email);
}

export const signInAs = (role: Role) => signIn(ACCOUNTS[role]);

/**
 * An API client for a seeded role, reusing the session global setup saved (no new sign-in, so the
 * per-account sign-in limit is never at risk). Falls back to signing in when no session was saved.
 */
export async function sessionAs(role: Role): Promise<ApiSession> {
  if (!fs.existsSync(statePath(role))) return signInAs(role);
  const context = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL }, storageState: statePath(role) });
  return new ApiSession(context, ACCOUNTS[role]);
}

export interface ExamSummary {
  id: string;
  title: string;
  status: string;
}

export async function examByTitle(staff: ApiSession, title: string): Promise<ExamSummary> {
  const res = await staff.get<{ items?: ExamSummary[] } | ExamSummary[]>('/exams');
  const items = Array.isArray(res.body) ? res.body : (res.body.items ?? []);
  const exam = items.find((e) => e.title === title);
  if (!exam) throw new Error(`${staff.email} cannot see an exam titled "${title}"`);
  return exam;
}

export interface Enrollment {
  id: string;
  userId: string;
  name: string;
  email: string;
  attempt: { id: string; status: string; submittedAt: string | null; score: number | null } | null;
}

export async function enrollments(staff: ApiSession, examId: string): Promise<Enrollment[]> {
  const res = await staff.get<{ items: Enrollment[] }>(`/exams/${examId}/enrollments`);
  if (res.status !== 200) throw new Error(`enrollments for ${examId}: ${res.status}`);
  return res.body.items;
}

export interface Candidate {
  email: string;
  name: string;
  userId: string;
}

let counter = 0;

/**
 * A brand-new candidate enrolled on an exam, created the way an administrator would:
 * the registrar adds the person, the person replaces the temporary password, the exam owner enrols them.
 * Each exam-taking flow gets its own account, so flows (and their retries) never share an attempt.
 */
export async function freshCandidate(label: string, examTitle: string = EXAMS.midterm): Promise<Candidate> {
  const stamp = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  const email = `qa.${slug}.${stamp}@student.northfield.edu`;
  const name = `QA ${label} ${stamp.slice(-4)}`;

  const registrar = await sessionAs('registrar');
  try {
    const created = await registrar.post<{ person: { userId: string }; temporaryPassword: string }>('/org/people', {
      name,
      email,
      roleKey: 'candidate',
      cohort: 'QA',
    });
    if (created.status !== 201 && created.status !== 200) throw new Error(`create ${email}: ${created.status} ${JSON.stringify(created.body)}`);
    const { userId } = created.body.person;

    const exam = await examByTitle(registrar, examTitle);
    const enrolled = await registrar.post(`/exams/${exam.id}/enrollments`, { userIds: [userId] });
    if (enrolled.status !== 201 && enrolled.status !== 200) throw new Error(`enrol ${email}: ${enrolled.status}`);

    const person = await signIn(email, created.body.temporaryPassword);
    const changed = await person.post('/auth/me/password', { currentPassword: created.body.temporaryPassword, newPassword: PASSWORD });
    await person.dispose();
    if (changed.status !== 204) throw new Error(`password for ${email}: ${changed.status}`);
    return { email, name, userId };
  } finally {
    await registrar.dispose();
  }
}

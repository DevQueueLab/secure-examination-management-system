import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app';
import { createContainer } from '../src/container';
import { db } from '../src/db/client';
import { exams, users } from '../src/db/schema';

export const ORIGIN = 'http://localhost:3900';
export const PASSWORD = 'Athena@2026';
export const API = '/api/v1';

export const container = createContainer();
export const app = createApp(container, [ORIGIN]);

export const ACCOUNTS = {
  platformAdmin: 'admin@athena.app',
  registrar: 'registrar@northfield.edu',
  sara: 'sara.ahmed@northfield.edu',
  omar: 'omar.farooq@northfield.edu',
  bilal: 'bilal.khan@northfield.edu',
  hina: 'hina.raza@northfield.edu',
  ali: 'ali.hassan@student.northfield.edu',
  ayesha: 'ayesha.malik@student.northfield.edu',
  organizer: 'organizer@codesprint.io',
  judge: 'judge@codesprint.io',
  riverside: 'admin@riverside.edu',
} as const;

export type Client = ReturnType<typeof clientFor>;

/** A browser-like client: keeps the session cookie and sends our Origin on every request. */
function clientFor(agent: ReturnType<typeof request.agent>) {
  return {
    get: (path: string) => agent.get(API + path).set('Origin', ORIGIN),
    post: (path: string, body?: object) => agent.post(API + path).set('Origin', ORIGIN).send(body ?? {}),
    put: (path: string, body?: object) => agent.put(API + path).set('Origin', ORIGIN).send(body ?? {}),
    patch: (path: string, body?: object) => agent.patch(API + path).set('Origin', ORIGIN).send(body ?? {}),
    delete: (path: string) => agent.delete(API + path).set('Origin', ORIGIN),
  };
}

const sessions = new Map<string, Client>();

/** Signs in once per account and reuses the session (the sign-in limiter is per IP and email). */
export async function as(email: string): Promise<Client> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const agent = request.agent(app);
  const res = await agent.post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const client = clientFor(agent);
  sessions.set(email, client);
  return client;
}

export const anonymous = () => clientFor(request.agent(app));

export async function examId(title: string): Promise<string> {
  const [row] = await db.select({ id: exams.id }).from(exams).where(eq(exams.title, title)).limit(1);
  if (!row) throw new Error(`no exam titled ${title}`);
  return row.id;
}

export async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email))).limit(1);
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

/** Recursively finds a key anywhere in a JSON value, to prove secrets never leave the server. */
export function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => containsKey(v, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k === key || containsKey(v, key));
  }
  return false;
}

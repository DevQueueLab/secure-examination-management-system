import { describe, expect, it } from 'vitest';
import { ACCOUNTS, ORIGIN, PASSWORD, anonymous, app, as, examId } from './helpers';
import request from 'supertest';

describe('3.1 authentication', () => {
  it('requires a session for protected routes', async () => {
    const res = await anonymous().get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const unknown = await anonymous().post('/auth/login', { email: 'nobody@northfield.edu', password: 'x'.repeat(10) });
    const wrong = await anonymous().post('/auth/login', { email: ACCOUNTS.ayesha, password: 'not-the-password' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('validates sign-in input with field-level errors', async () => {
    const res = await anonymous().post('/auth/login', { email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toBeDefined();
  });

  it('locks an account after repeated failures, even for the right password', async () => {
    const email = 'competitor3@codesprint.io';
    for (let i = 0; i < 5; i++) await anonymous().post('/auth/login', { email, password: 'wrong-password' });
    const res = await anonymous().post('/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('issues an httpOnly session cookie and ends it on sign-out', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: ACCOUNTS.hina, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    await agent.post('/api/v1/auth/logout').set('Origin', ORIGIN);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('blocks state-changing requests from another origin', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({ email: ACCOUNTS.ali, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('refuses members of a suspended organization', async () => {
    const res = await anonymous().post('/auth/login', { email: ACCOUNTS.riverside, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('3.1 authorization is enforced by the API, not the interface', () => {
  it('denies candidates every staff surface', async () => {
    const ali = await as(ACCOUNTS.ali);
    const midterm = await examId('Data Structures & Algorithms Midterm');
    for (const path of ['/questions', '/exams', `/exams/${midterm}`, `/monitoring/exams/${midterm}/live`, '/org/people', '/platform/organizations']) {
      const res = await ali.get(path);
      expect([403, 404], `${path} returned ${res.status}`).toContain(res.status);
    }
  });

  it('keeps platform administration to platform admins', async () => {
    const registrar = await as(ACCOUNTS.registrar);
    expect((await registrar.get('/platform/organizations')).status).toBe(403);
    const admin = await as(ACCOUNTS.platformAdmin);
    expect((await admin.get('/platform/organizations')).status).toBe(200);
  });

  it('lets an examiner see only the exams they are staff on', async () => {
    const sara = await as(ACCOUNTS.sara);
    const mechanics = await examId('Mechanics Quiz 3');
    expect((await sara.get(`/exams/${mechanics}`)).status).toBe(404);
    const registrar = await as(ACCOUNTS.registrar);
    expect((await registrar.get(`/exams/${mechanics}`)).status).toBe(200);
  });

  it('isolates tenants completely', async () => {
    const judge = await as(ACCOUNTS.judge);
    const midterm = await examId('Data Structures & Algorithms Midterm');
    expect((await judge.get(`/exams/${midterm}`)).status).toBe(404);
    const list = await judge.get('/exams');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('Data Structures');
  });

  it('stops an examiner from managing people', async () => {
    const sara = await as(ACCOUNTS.sara);
    const res = await sara.post('/org/people', { name: 'Test Person', email: 'test.person@northfield.edu', roleKey: 'candidate' });
    expect(res.status).toBe(403);
  });
});

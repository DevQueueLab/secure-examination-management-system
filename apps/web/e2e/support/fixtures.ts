import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { freshCandidate, sessionAs, signIn, signInAs, type ApiSession, type Candidate } from './api';
import { statePath, type Role } from './env';

/** A browser context already signed in: from the saved session for a role, or a fresh sign-in by email. */
export async function contextFor(browser: Browser, who: Role | { email: string }, options: Parameters<Browser['newContext']>[0] = {}) {
  if (typeof who === 'string' && fs.existsSync(statePath(who))) {
    return browser.newContext({ ...options, storageState: statePath(who) });
  }
  const session = typeof who === 'string' ? await signInAs(who) : await signIn(who.email);
  const storageState = await session.storageState();
  await session.dispose();
  return browser.newContext({ ...options, storageState });
}

interface Fixtures {
  /** Opens a page signed in as a seeded role (or any account by email). Contexts close after the test. */
  pageAs: (who: Role | { email: string }) => Promise<Page>;
  /** An API client signed in as a seeded role, disposed after the test. */
  apiAs: (role: Role) => Promise<ApiSession>;
  /** A brand-new candidate enrolled on the DS Midterm, unique to this test (and to each retry). */
  candidate: Candidate;
}

export const test = base.extend<Fixtures>({
  pageAs: async ({ browser, contextOptions }, provide) => {
    const opened: BrowserContext[] = [];
    await provide(async (who) => {
      const context = await contextFor(browser, who, contextOptions);
      opened.push(context);
      return context.newPage();
    });
    for (const context of opened) await context.close();
  },
  apiAs: async ({}, provide) => {
    const sessions: ApiSession[] = [];
    await provide(async (role) => {
      const session = await sessionAs(role);
      sessions.push(session);
      return session;
    });
    for (const session of sessions) await session.dispose();
  },
  candidate: async ({}, provide, testInfo) => {
    const label = path.basename(testInfo.file, '.spec.ts').replace(/^\d+-/, '');
    await provide(await freshCandidate(label));
  },
});

export { expect };

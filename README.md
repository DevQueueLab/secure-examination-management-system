# Athena

Athena is a multi-tenant platform for running secure online examinations. One deployment hosts many institutions and competition organizers, each with its own people, roles, question bank and exams. Examiners assemble papers from a versioned question bank, candidates sit them in a browser workspace that keeps working when the network drops, proctors watch attempts live, graders mark written answers against rubrics, and results are published with signed reports that anyone can verify. The server decides time, grading and access; the browser only holds work until the server accepts it.

**Live:** https://athena.devqueue.co

## Demo accounts

Every account uses the password **`Athena@2026`**. The sign-in page lists the first ten accounts and signs in with one click. All people and organizations are fictional.

| Role | Email | Organization | What it shows |
| --- | --- | --- | --- |
| Platform admin | `admin@athena.app` | Platform | Onboard, suspend and reactivate tenants; platform audit |
| Organization admin | `registrar@northfield.edu` | Northfield Institute of Technology | People, roles and permissions, imports, audit log, settings; oversight of every exam |
| Examiner | `sara.ahmed@northfield.edu` | Northfield | Owns the live DS Midterm, a scheduled final and a draft: authoring, publishing, monitoring, fairness, integrity |
| Examiner | `omar.farooq@northfield.edu` | Northfield | Owns Mechanics Quiz 3 (completed, results published): results, analytics, disputes, remedies |
| Grader | `bilal.khan@northfield.edu` | Northfield | Grader on the midterm and the quiz: rubric grading, an appeal waiting for a second reviewer |
| Proctor | `hina.raza@northfield.edu` | Northfield | Proctor on the live midterm: roster, announcements, clarifications, extensions, indicators |
| Candidate | `ali.hassan@student.northfield.edu` | Northfield and CodeSprint League | The live midterm (not started), a published result, a dispute under review, a second organization |
| Candidate | `ayesha.malik@student.northfield.edu` | Northfield | A published result with an upheld dispute and its score history |
| Organization admin | `organizer@codesprint.io` | CodeSprint League (competition) | A competition tenant with its own competitors and judge |
| Examiner (competition judge) | `judge@codesprint.io` | CodeSprint League | Owns the take-home qualifier, with competitors mid-sitting |
| Organization admin, suspended tenant | `admin@riverside.edu` | Riverside College | Sign-in is refused because the tenant is suspended (not listed on the sign-in page) |

## Guided demo

**Candidate (Ali Hassan).**
1. On *My exams*, open **Data Structures & Algorithms Midterm** (live). The lobby shows the window, the time limit and the integrity charter. Accept the pledge and start.
2. Answer a few questions and flag one. Open the scratchpad and the calculator from the toolbar, and change the theme, font or navigator position in the workspace preferences.
3. Turn the network off (browser DevTools, Network, Offline) and keep answering: the save status shows answers kept on this device. Turn it back on and they sync. Changing the computer's clock does not change the timer.
4. Submit and note the receipt code.
5. Under *Results*, open **Mechanics Quiz 3**: marks per question and per topic, score history, and the PDF report with its verification code and QR code. Open the verification link in a private window.
6. Under *My disputes*, his dispute about his working is under review. Use the organization switcher to move to CodeSprint League, where the take-home qualifier is open.

**Examiner (Dr. Sara Ahmed).**
1. *Exams*, **DS Midterm**, *Monitor*: the live roster with each candidate's progress, connectivity and indicators.
2. *Integrity*: the essay pasted in one large insert. Play the authorship replay.
3. *Fairness*: Section A draws 4 of 8 questions; the report compares random and balanced papers.
4. *Results*: one candidate's time ran out while she was offline. Her two newer answers are held, with the score either way; accept or reject them. Publication stays blocked until then.
5. *Question bank*, *New question*: ten question types, "show your working" and parameterized numeric questions. Open the draft **Software Design Principles**, run the publish review and preview it as a candidate (sandbox).

**Examiner (Omar Farooq).** Open **Mechanics Quiz 3**.
1. *Results*: the publication checklist, versions and the exam report. *Analytics*: item statistics and plain-language insights.
2. *Disputes*: decide Ali's dispute with a written reason, preview a class-wide remedy, and check the grade ledger. The appeal on the momentum question is not his to decide: he made the original decision.
3. *Integrity*: the similarity pair with the same uncommon wrong answers and near-identical working.

**Grader (Bilal Khan).** *Grading*: written answers in an anonymous queue, scored against the rubric from the keyboard. *Disputes*: the appeal Omar cannot take.

**Proctor (Hina Raza).** **DS Midterm**, *Monitor*: send an announcement, extend a candidate's time and review an indicator. Ask a clarification from a candidate's workspace in a second browser, then answer it here.

**Organization admin (Imran Qureshi).** *People*: add a person, change a role, reset a password, and run a CSV import as a dry run to see row errors. *Roles*: the permission matrix and custom roles. *Audit log* and *Settings*. *Exams* lists every exam in the tenant.

**Platform admin (Zara Sheikh).** *Organizations*: onboard an institution or a competition (it gets its system roles and a first admin with a temporary password), and suspend or reactivate one; Riverside College is suspended. *Platform audit*.

**Competition tenant.** `organizer@codesprint.io` manages competitors grouped by team. `judge@codesprint.io` watches the **CodeSprint Qualifier 2026**, a 24-hour take-home round in a week-long window.

**Live activity.** Right after the demo data is re-seeded, the midterm's monitor shows twelve seeded candidates mid-exam. They started 4 to 20 minutes before the seed with a 60-minute limit, so the deadline sweep submits them within the hour. The qualifier's six seeded competitors stay mid-sitting for about 23 hours after a re-seed. To create live activity at any time, sign in as a candidate who has not started in a second browser or a private window (Ali or Ayesha for the midterm; Ali, `competitor7@codesprint.io` or `competitor8@codesprint.io` for the qualifier) and start the exam while staff watch *Monitor*.

## Innovations

Each item names the challenge in the brief it answers and where the code lives.

### 5.3 Failure-resilient examinations

- **Server-authoritative timing.** The server fixes each attempt's deadline at start, as min(start + duration × accommodation multiplier + extra minutes, window close), and enforces it on every write. The workspace counts down from the server time carried by every response plus the browser's monotonic clock, so changing the device clock changes nothing, and a sweep every 5 seconds submits expired attempts even when the browser is closed. `apps/api/src/modules/attempts/attempt.policy.ts`, `attempt.jobs.ts`, `apps/web/src/features/workspace/sync/clock.ts`
- **Offline-first workspace with a sealed journal.** Every change goes to an IndexedDB journal first and syncs over plain HTTPS with a per-question revision, so a retried save is applied once and an older one never overwrites a newer one. If time runs out offline, the server submits the attempt on time with what it holds; the browser seals its journal with a SHA-256 hash chain and uploads it on reconnect, within the exam's grace period (15 minutes by default). Newer answers in it are held for an examiner, who sees the score either way before accepting or rejecting them; the decision is audited, and results cannot be published while answers are held. `apps/web/src/features/workspace/sync/`, `apps/api/src/modules/attempts/offline-journal.service.ts`
- **Outage compensation.** The API writes a heartbeat every 10 seconds. When it starts after a gap of more than 30 seconds, every attempt whose clock was running gets the lost time back, up to 30 minutes and even past the window close, recorded on the attempt's timeline and in the audit log and pushed live to the candidate and staff. Deadline checks wait until this has run. `apps/api/src/modules/attempts/attempt.jobs.ts`
- **One active device.** Opening the attempt elsewhere takes it over; the old device is told at once and its writes are refused. `apps/api/src/modules/attempts/attempt.service.ts`
- *Trade-off:* answers that reach the server after the deadline never count automatically. A candidate who lost the connection waits for a human decision, and nobody gains time.

### 5.2 Fair randomized papers

- **Balanced paper assembly.** Pool sections draw N of M questions. Each question's expected score blends its difficulty label (easy 0.8, medium 0.6, hard 0.4) with observed results, weighted as ten prior attempts. A seeded draw, stratified by label, is then improved by swaps within the pool and at equal marks until the paper's expected score is within a tolerance of the target (3 % of total marks by default). Ties between useful swaps are broken at random, so papers stay varied. `apps/api/src/domain/paper/`
- **Fairness report.** Before publication it simulates 400 balanced and 400 random papers (50 to 2,000 on request) and compares their spread of expected scores, pairwise overlap and question exposure. After the window closes it audits predicted against observed difficulty per paper, and the examiner can recalibrate the bank from the results (audited). `apps/api/src/modules/fairness/`, `apps/web/src/features/fairness/`
- *Trade-off:* balancing narrows the set of possible papers; the report's overlap and exposure figures show how much variation remains.

### 5.4 Trust and dispute resolution

- **Hash-chained grade ledger.** Every score change appends a row with actor, reason, and previous and new scores. Each row's hash is an HMAC, keyed with a server secret, over canonical JSON that includes the previous row's hash, and a database trigger rejects UPDATE and DELETE. The Ledger view on the exam's Disputes tab draws recent entries as linked blocks, newest first, and Verify chain has the server walk the whole ledger again and shows its verdict: every entry intact, or the first broken one. Candidates see their own score history. `apps/api/src/domain/ledger/ledger.ts`, `apps/api/src/db/sql/001_grade_ledger_guard.sql`, `apps/web/src/features/disputes/components/ledger-explorer.tsx`
- **Signed result reports with public verification.** Each issued PDF carries a verification code and a QR code. The report data is signed with Ed25519, and the public page `/verify/<code>` shows validity, the signature check, organization, exam, issue date, score and a masked candidate name; a report replaced by a newer result version shows as superseded. The verify endpoints are rate limited (30 a minute) and publish the public key at `/api/v1/public/verify-key`. `apps/api/src/modules/reports/`, `apps/web/src/app/verify/[code]/`
- **Disputes and class-wide remedies.** A candidate disputes a question or the whole attempt; the evidence (answer, rubric, timeline) is frozen when the dispute is raised and sealed with an HMAC. Nobody decides a dispute about an answer they graded, the single appeal goes to someone other than the original decider, and every decision needs a written reason of at least 10 characters that the candidate reads. A flawed question is fixed for everyone at once (accept alternative answers, full marks for all, or drop it), with an impact preview and one transaction across every affected attempt; a remedy never lowers anyone's score. `apps/api/src/modules/disputes/`
- *Trade-off:* a remedy that would take marks from anyone, such as dropping a question some candidates earned marks on, is refused, so class-wide fixes only raise or keep scores; full marks for everyone is the fallback.

### 5.1 Integrity without surveillance

- **Integrity indicators.** No camera, microphone or screen recording; the web app's Permissions-Policy turns off the camera and microphone. The workspace records focus loss, fullscreen exits, copy, paste, context-menu, print and multiple-display signals as indicators with a review priority. A reviewer records an outcome (no concern, follow up, escalated), audited, and no indicator changes a score or submits an attempt. `apps/web/src/features/workspace/lib/integrity.ts`, `apps/web/src/features/monitoring/components/indicator-review.tsx`
- **Authorship replay.** The answer box records how each written answer was composed: typed, pasted, or inserted in one burst of 40 or more characters without a paste event. Staff with integrity-review permission replay the composition with pasted and burst spans marked, and each viewing is audited. `packages/shared/src/integrity.ts`, `apps/web/src/features/integrity/`
- **Similarity analytics.** Pairs of candidates who share uncommon wrong answers (given by at most 15 % of respondents, weighted by rarity) are ranked by z-score against all other pairs, and written answers are compared with character 5-gram Jaccard similarity after removing text every candidate was given, with matching passages highlighted. When pairs are listed, a constellation draws candidates as stars joined by those pairs, the line thicker for more uncommon shared wrong answers and dashed where only the wording overlaps. `apps/api/src/domain/integrity/similarity.ts`, `apps/web/src/features/integrity/components/similarity-constellation.tsx`
- *Trade-off:* indicators can be caused innocently (unstable Wi-Fi, assistive technology), so they are context for a human reviewer, never evidence on their own.

### 5.5 Participant-defined: paper-leak tracing

Live papers leak into group chats during the exam window, and the usual response, a retest, punishes every honest candidate. With the exam's watermark setting on (the default), every question stem a candidate sees carries an invisible zero-width fingerprint of that attempt's code, copied question text carries it too, and the code also appears as a faint on-screen watermark. The Leak Tracer decodes pasted text, or a code typed from a screenshot, back to the attempt. When the marks are gone, variant forensics uses per-paper numbers, option order and question draw to say which papers fit, never who shared them. `packages/shared/src/integrity.ts`, `apps/api/src/domain/integrity/leak.ts`, `apps/web/src/features/integrity/components/leak-tracer.tsx`

### Across the platform

- **Live monitoring.** A roster over Socket.IO, with HTTP polling every 10 seconds while the socket is down, shows progress, connectivity, round-trip time and indicators. Staff send announcements with read counts, answer clarifications privately or for everyone, and extend time or force-submit with a recorded reason. When at least 30 % of the candidates in progress (and at least three) drop within the same two minutes, the monitor offers one extension for exactly those candidates. `apps/api/src/modules/monitoring/`, `apps/web/src/features/monitoring/`
- **Hall display.** A projector view for the exam room, opened from the monitor and needing the same access: the paper's name, a large countdown to the window's close, how many are writing, have submitted and have not started, and the latest announcement to everyone, with no candidate named. `apps/web/src/features/monitoring/hall/`
- **Multi-tenancy with RBAC.** One person can hold a membership, with a role, in several organizations and switch between them. Organization admins edit role permissions and create custom roles, and staff are also assigned to each exam as owner, co-examiner, grader or proctor. A suspended tenant loses access on its members' next request. `packages/shared/src/permissions.ts`, `apps/api/src/middleware/guards.ts`, `apps/api/src/modules/exams/exam-access.ts`
- **Day at a glance.** The staff home (for anyone with audit permission) and the platform overview draw today's audit events on a 24-hour timeline, grouped as exams and integrity, results published, and administration, refreshed every minute and linked to the full audit log. `apps/web/src/features/admin/day-glance/`
- **Command palette and shortcuts.** ⌘K or Ctrl+K opens a palette for navigation, with recent pages, a theme toggle and the tour; `?` opens a keyboard-shortcuts sheet, and g then h, e, q or g goes to Home, Exams, Question bank or Grading when that page is in the person's navigation. `apps/web/src/components/shell/command-palette.tsx`
- **Guided tour.** On a first signed-in visit, once per person per browser and never during an exam, a small card offers a tour for the person's role (candidate, examiner, grader, proctor, organization admin or platform admin); it can be replayed from the user menu or ⌘K. `apps/web/src/features/tour/`
- **Profile photos and documents.** A photo added in Profile & preferences is cropped to a square and re-encoded as a 256 px WebP in the browser, which also drops location data. It then appears in the user menu, People and the live monitor roster, where proctors use it to confirm who is sitting the exam. Documents (identity document, accommodation request, other) can be PDF, JPEG, PNG or WebP, up to 5 MB each and ten per person. The server identifies the type from the file's bytes, never its name, stores a SHA-256, and serves a document only to its owner and that organization's admins, as an attachment under a sandboxing Content Security Policy; anyone else gets not found. Uploads are limited to 20 per 10 minutes per person, and admin downloads are audited. `apps/api/src/modules/files/`, `apps/web/src/features/profile/`
- **Pagination.** People, the question bank, exams, an exam's candidates, the audit logs and platform organizations page on the server in a stable order, with a unique tiebreaker so pages never overlap, behind one shared pager. The page is kept in the URL, so reload and Back keep it, and a new search starts again at page 1. `apps/web/src/components/ui/pagination.tsx`

## Brief coverage

**Core workflow (§3).**
- *3.1 Authentication and authorization:* server-side sessions, permission guards on every route, exam-level staff assignments; examiners see only exams they are staff on.
- *3.2 Examination management:* a wizard for title, instructions, window, duration, total marks and settings; phases draft, scheduled, live, completed and archived, derived from server time; a publish review that blocks invalid papers; questions in a section reorder by dragging, with Move up and Move down in each row's menu for keyboard users; timing and structure lock once a candidate has started, except that the window can still be extended.
- *3.3 Question management:* ten types (single choice, multiple choice, true/false, numeric with tolerance and per-candidate parameters, short text, fill in the blanks, matching, ordering, long text, code), categories, difficulty, versions pinned by each exam, question and option shuffling per attempt, partial credit and negative marking, and an optional "show your working" part with method marks; on screens 1280 px and wider, a Live preview button in the question editor opens a docked panel that shows the candidate's view as the author types.
- *3.4 Candidate management:* enrollment one by one or by import, cohorts, accommodations (time multiplier, extra minutes); candidates see available, upcoming and completed exams, and the server enforces eligibility and the window.
- *3.5 Examination interface:* navigator with answered, partly answered and flagged states, autosave, resume after a refresh or crash, review before submit, idempotent submission with an HMAC receipt code; Focus mode (Shift+F, Esc to leave) hides the navigator and tools, leaving the paper and a slim bar with the title, save state, timer and Review & submit.
- *3.6 Monitoring:* see *Live monitoring* above; indicators are labelled as context, never as violations.
- *3.7 Grading:* objective items auto-graded under the exam's scheme; written answers graded against rubrics, anonymously by default and from the keyboard; typed scores outside the part's range are refused; a rubric edit re-scores every answer that used it.
- *3.8 Results and analytics:* a pre-publication checklist (ungraded parts, attempts in progress, held offline answers; overriding needs a written reason), publication and unpublication as versions, candidate results with per-topic breakdown, and exam summaries from submitted, non-sandbox attempts only.

**Secondary features (§4).**
- *4.1 Network-aware interface:* the save status shows saved, saving, offline (with the number of answers kept on the device), reconnecting, or sync failed with the retry countdown, plus the round-trip time; the connection counts as unstable above 1.5 s or after repeated failures. `apps/web/src/features/workspace/components/sync-pill.tsx`
- *4.2 PDF reports:* a candidate result report and an exam summary report, rendered on the server with @react-pdf/renderer. A candidate gets only their own, after publication; staff need report permission on the exam. `apps/api/src/modules/reports/pdf/`
- *4.3 Exam sandbox:* "preview as candidate" runs the same workspace candidates use, in any phase, including drafts, shows the auto-graded score at the end, and is excluded from results, statistics, monitoring and analytics. `apps/api/src/db/scopes.ts`
- *4.4 Bulk import:* people (up to 1,000 rows), exam candidates (500) and questions (500) from CSV or JSON, with a dry run that lists row-level errors before anything is written. `apps/api/src/modules/org/people-import.service.ts`, `apps/api/src/modules/exams/enrollment-import.ts`, `apps/api/src/modules/questions/question-import.ts`
- *4.5 Question analytics:* difficulty, discrimination, point-biserial, distractor analysis, skip rate, time spent and KR-20 or Cronbach's alpha, with plain-language insights such as a possible miskey or a dead distractor; below five graded answers a question is only marked "too few graded answers to judge". `apps/api/src/domain/analytics/`
- *4.6 Verifiable reports:* see *Signed result reports* above. A candidate whose published result is at or above the pass mark can also open a certificate from the result page, printed as one A4 landscape page, with the report's verification code, verify URL and QR code; if no code exists yet, the candidate can issue one from the certificate. `apps/web/src/features/results/certificate/`
- *4.7 Customizable workspace:* theme (system, light, dark, sepia, high contrast), font (sans, serif, a readable face), size, line spacing, paged or scrolling layout, navigator position (left, right, bottom, hidden), timer (always, minimal, last five minutes), reduced motion, word count and confirm-before-submit, saved to the profile. `packages/shared/src/preferences.ts`
- *4.8 Digital scratchpad:* drawing pages with stylus pressure, a highlighter, a notes page and a calculator inside the workspace, autosaved with the attempt; pages can be attached to a question's working, and graders see only attached pages. `apps/web/src/features/workspace/tools/`

The reasoning behind these choices, the trade-offs and the alternatives considered are in [docs/](docs/).

## Architecture

```
Browser ──HTTPS / WSS──▶ Cloudflare ──▶ OpenLiteSpeed (TLS, host) ──▶ Caddy gateway (127.0.0.1:4900)
                                                                        ├─ /api/*, /socket.io/* ─▶ api :4901 ─▶ PostgreSQL 18
                                                                        └─ everything else ──────▶ web :3900
```

- **Stack.** TypeScript throughout. Web: Next.js 16 (App Router), React 19, TanStack Query, Tailwind CSS 4, Radix primitives, Motion. API: Node 24, Express 5, Socket.IO 4, Drizzle ORM on PostgreSQL 18, zod 4, @react-pdf/renderer, pino. Monorepo: pnpm workspaces and Turborepo.
- **Layout.**
  ```
  apps/api         Express API, Socket.IO, background jobs, Drizzle schema, migrations and seed
    src/modules    one folder per feature: routes (HTTP only) and services (rules, transactions)
    src/domain     pure rules: question types, grading, paper assembly, ledger, integrity, analytics
    test           end-to-end API scenarios
  apps/web         Next.js app: src/app (routes), src/features (one folder per feature), src/components
    e2e            Playwright UI flows
  packages/shared  zod contracts, permission keys, question-type schemas, exam phase, integrity primitives
  docker           Dockerfile (api and web images), Caddyfile, OpenLiteSpeed vhost
  docs             requirements analysis and technical analysis
  ```
- **Request path.** Cloudflare proxies the host. OpenLiteSpeed terminates TLS, redirects plain HTTP and passes WebSocket upgrades on `/socket.io/`. Caddy, the only container with a published port (loopback only), takes the visitor address from `CF-Connecting-IP`, sends `/api` and `/socket.io` to the API and everything else to the web app, so the browser sees one origin and the session cookie stays first-party.
- **API layering.** Routes parse input with zod (`apps/api/src/lib/validate.ts`) and call services; services hold the rules and transactions; Drizzle does data access. Every error leaves through one handler with one shape: `{ error: { code, message, fields?, requestId } }`.
- **Question types** are strategies behind one interface (validate, prepare the candidate view, grade) in a registry (`apps/api/src/domain/question-types/registry.ts`), so adding a type does not touch the attempt engine.
- **Data integrity.** Each attempt stores a snapshot of its questions, marks, marking scheme and answer key at start; a partial unique index allows one non-sandbox attempt per candidate per exam; answer writes are revisioned upserts; finalization locks the attempt row (`SELECT … FOR UPDATE`) and is idempotent; marks are exact `numeric` values and instants are `timestamptz`.

## Security

- **Sessions.** A random 256-bit token in an `httpOnly`, `SameSite=Lax`, host-only cookie (`Secure` in production); the database stores only its SHA-256 hash. Sessions expire (12 hours by default), sign-out revokes at once, and a suspended user, membership or tenant loses access on the next request.
- **Passwords.** Argon2id with OWASP's profile (19 MiB, 2 iterations). Sign-in is limited to 10 tries a minute per IP and email, five consecutive failures lock the account for 15 minutes, and an unknown email costs the same hashing work as a wrong password.
- **CSRF.** Cookies are `SameSite=Lax`, and the API rejects any state-changing request whose `Origin` header names another origin (`apps/api/src/middleware/origin-check.ts`).
- **Authorization.** Roles are sets of permission keys (`packages/shared/src/permissions.ts`); every route checks them in middleware (`apps/api/src/middleware/guards.ts`), and services check exam assignments. The interface reads the same keys only to decide what to show.
- **Tenant scoping.** The active organization comes from the session's membership, services filter by it, and a resource in another tenant, or an exam the caller is not staff on, is reported as not found (`apps/api/src/modules/exams/exam-access.ts`).
- **Rate limits.** Besides sign-in, a ceiling of 1,200 API requests a minute per session (per IP when signed out), so a hall of candidates behind one NAT address is not throttled as one.
- **Headers.** The web app sends a Content Security Policy (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a Permissions-Policy that turns off the camera, microphone and geolocation. The API adds helmet's headers and `Cache-Control: no-store` on every response.
- **Answer keys** are stored apart from candidate-visible content and never sent to a candidate during an attempt; parameterized numeric answers are computed on the server.
- **Audit log.** Sign-ins and failed sign-ins, people and role changes, tenant onboarding and suspension, exam and result publication, interventions, offline-answer decisions, grading, remedies, disputes and report downloads are recorded with actor, organization, target and time (`apps/api/src/modules/audit/audit.service.ts`). Organization admins read it at `/audit`, platform admins at `/platform/audit`.

## Running locally

Prerequisites: Node 24, pnpm 11 and Docker (for PostgreSQL).

```bash
pnpm install
pnpm db:up                                   # PostgreSQL 18 on 127.0.0.1:5433
cp apps/api/.env.example apps/api/.env
pnpm db:push                                 # create the schema from the Drizzle definitions
pnpm db:seed                                 # demo data; wipes the database and installs the ledger trigger
pnpm dev                                     # web on http://localhost:3900, API on http://localhost:4901
```

The web app forwards `/api` to the API in development, so open http://localhost:3900. Locally the schema is pushed directly; in production the API applies the versioned migrations in `apps/api/drizzle` and the ledger trigger SQL when it starts.

## Tests

- **Unit tests:** `pnpm test` runs Vitest in `apps/api` and `packages/shared`: marking rules for every question type, attempt timing and receipts, paper assembly and the fairness maths, the ledger chain, rubric scoring, item statistics, monitoring analysis, indicators, similarity, leak tracing, and the shared provenance and fingerprint primitives.
- **API end-to-end scenarios:** `pnpm --filter @athena/api test:e2e` drives the app over HTTP through access control across roles and tenants (`apps/api/test/01-access-control.e2e.test.ts`) and the attempt lifecycle (`02-attempt-lifecycle.e2e.test.ts`). It needs the PostgreSQL from `pnpm db:up`, and drops and recreates its own database, `athena_e2e`, applies the production migrations and loads the seed, so the development database is left alone.
- **UI flows:** `pnpm --filter @athena/web test:ui` runs the Playwright suite in `apps/web/e2e`, one file per scenario (candidate sittings, access control, time expiry, offline saving, device takeover, two open tabs, monitoring, grading and publication, disputes), in the installed Google Chrome. It never starts servers: run it against a running, seeded stack at `E2E_BASE_URL` (default http://localhost:3900), and set `E2E_DATABASE_URL` for the flows that move a deadline. The flows start and submit attempts, so use a local stack and re-seed afterwards.

## Deployment

The production stack is one Docker Compose project (`docker-compose.yml`) with four services: PostgreSQL 18, the API, the web app and a Caddy gateway. `docker/Dockerfile` builds both application images from one cached dependency install; they run as an unprivileged user, every container has a memory limit and rotated logs, and PostgreSQL and the API have health checks. Only the gateway publishes a port, on `127.0.0.1:4900`. On the host, OpenLiteSpeed terminates TLS for Cloudflare and proxies to it (`docker/openlitespeed.vhost.conf`).

```bash
cp .env.example .env                         # APP_ORIGIN, POSTGRES_PASSWORD, LEDGER_SECRET
docker compose up -d --build                 # the API applies migrations before it starts serving
docker compose run --rm api node dist/seed.js    # optional: load the demo data (wipes the database)
```

## Documentation

- [Requirements analysis](docs/01-requirements-analysis.md): case study, the requirement catalogue with acceptance criteria, and how each ambiguity in the brief was resolved.
- [Technical analysis](docs/02-technical-analysis.md): constraints, technology choices, risks, quality attributes, architecture and database design.

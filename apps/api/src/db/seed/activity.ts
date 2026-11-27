/**
 * Realistic exam activity, created through the real attempt engine with an injected clock: every paper,
 * answer, autosave, receipt, auto-grade, ledger entry and integrity event below is genuine engine output, so
 * grading, results, analytics, disputes and integrity all work on actual submission data.
 *
 * - Mechanics Quiz 3 (completed): 22 sittings two days ago with ability-varied answers, working graded by
 *   Bilal with the rubric, results published, and question calibration (observedP/N) from those results.
 *   Two candidates share uncommon wrong answers and near-identical working (similarity fixture).
 * - DS Midterm (live): three submitted, twelve in progress with partial answers and integrity indicators
 *   (focus loss, a ~600 character paste into the essay), and one whose time ran out while offline: two newer
 *   answers from the device's journal are held for an examiner's decision. Ali and Ayesha have not started.
 * - CodeSprint Qualifier (live, take-home): 24 hours per competitor inside a week-long window. Six competitors started
 *   10 to 50 minutes before the seed and are at different stages, so the monitor shows work in progress for about a
 *   day after seeding. Ali and two others have not started.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  answerChangeSchema,
  ProvenanceRecorder,
  startAttemptSchema,
  submitAttemptSchema,
  syncRequestSchema,
  type AnswerChange,
  type AnswerProvenance,
  type Difficulty,
  type Permission,
  type QuestionType,
} from '@athena/shared';
import { env } from '../../config/env';
import { recomputeAttempt } from '../../domain/grading/attempt-score';
import { appendLedger } from '../../domain/ledger/ledger';
import { createRng, round3, type Rng } from '../../domain/rng';
import type { AuditEntry } from '../../modules/audit/audit.service';
import { canonicalJson } from '../../modules/attempts/attempt.policy';
import { AttemptService } from '../../modules/attempts/attempt.service';
import { OfflineJournalService } from '../../modules/attempts/offline-journal.service';
import { Realtime } from '../../realtime/realtime';
import type { TenantAuthContext } from '../../types/auth';
import type { Executor } from '../client';
import { db } from '../client';
import {
  answers,
  attemptItems,
  attempts,
  auditLogs,
  examQuestions,
  exams,
  examSections,
  memberships,
  notifications,
  organizations,
  questions,
  roles,
  rubricItems,
  users,
} from '../schema';
import { SEED_QUESTIONS } from './questions.data';

type Exam = typeof exams.$inferSelect;
type User = typeof users.$inferSelect;
type Json = Record<string, unknown>;

interface ActivityContext {
  dsMidterm: Exam;
  physicsQuiz: Exam;
  qualifier: Exam;
  students: User[];
  ali: User;
  ayesha: User;
  staff: { sara: User; omar: User; bilal: User; hina: User };
}

const MINUTE = 60_000;
const at = (base: Date | number, minutes: number) =>
  new Date(new Date(base).getTime() + minutes * MINUTE);
const fmt = (n: number) => String(Math.round(n * 100) / 100);

// ------------------------------------------------------------------------------------------------ engine

/** A movable clock: the engine reads time only from here, so sittings happen at their real past times. */
class SeedClock {
  private t = Date.now();
  readonly now = () => new Date(this.t);
  set(when: Date) {
    this.t = when.getTime();
  }
}

const clock = new SeedClock();
const realtime = new Realtime();

/** Audit rows stamped with the seed clock, written on the same executor as the change they describe. */
const auditOn = (executor: Executor) => ({
  record: async (entry: AuditEntry, tx: Executor = executor) => {
    await tx.insert(auditLogs).values({
      ...entry,
      organizationId: entry.organizationId ?? null,
      actorId: entry.actorId ?? null,
      metadata: entry.metadata ?? {},
      createdAt: clock.now(),
    });
  },
});
const engineOn = (executor: Executor) =>
  new AttemptService({
    db: executor,
    audit: auditOn(executor),
    realtime,
    receiptSecret: env.LEDGER_SECRET,
    now: clock.now,
  });
const audit = auditOn(db);
const engine = engineOn(db);

/** The session a request would carry, built from the real membership and role. */
async function sessionFor(user: User, organizationId: string): Promise<TenantAuthContext> {
  const [m] = await db
    .select({
      id: memberships.id,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      permissions: roles.permissions,
      org: organizations,
    })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!m) throw new Error(`${user.email} has no membership in ${organizationId}`);
  return {
    sessionId: randomUUID(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin,
      mustChangePassword: false,
      preferences: user.preferences,
    },
    organization: {
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      type: m.org.type,
      status: m.org.status,
    },
    membership: { id: m.id, roleId: m.roleId, roleKey: m.roleKey, roleName: m.roleName },
    permissions: new Set(m.permissions as Permission[]),
  };
}

// ------------------------------------------------------------------------------------------------ sittings

interface SeedItem {
  id: string;
  ref: string;
  difficulty: Difficulty;
  type: QuestionType;
  marks: number;
  workingMarks: number;
  content: Json;
  answerKey: Json;
  values: Record<string, number>;
}

interface Change {
  item: SeedItem;
  response: Json | null;
  working?: { text: string; scratchPages: string[] } | null;
  provenance?: AnswerProvenance;
  flagged?: boolean;
  /** How good the shown working is, so the grader's rubric choices match the text. */
  quality?: Quality;
}

interface SeedEvent {
  type:
    | 'focus_lost'
    | 'focus_returned'
    | 'paste'
    | 'copy_attempt'
    | 'went_offline'
    | 'came_online'
    | 'multiple_displays'
    | 'fullscreen_exited';
  payload?: Json;
}

const DEVICES = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    platform: 'Windows',
    screen: '1920x1080',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    platform: 'macOS',
    screen: '1512x982',
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    platform: 'Linux',
    screen: '1366x768',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
    platform: 'Windows',
    screen: '1600x900',
  },
];

/** One candidate sitting one exam, driven through the engine exactly like the browser would. */
class Sitting {
  private readonly revisions = new Map<string, number>();
  private constructor(
    private readonly engine: AttemptService,
    readonly auth: TenantAuthContext,
    readonly attemptId: string,
    readonly items: SeedItem[],
  ) {}

  /** `on` is the executor the whole sitting runs on: the database, or a transaction that holds the sitting. */
  static async begin(
    user: User,
    exam: Exam,
    when: Date,
    rng: Rng,
    refs: Map<string, string>,
    on: Executor = db,
  ): Promise<Sitting> {
    clock.set(when);
    const sittingEngine = on === db ? engine : engineOn(on);
    const auth = await sessionFor(user, exam.organizationId);
    const view = await sittingEngine.start(
      auth,
      startAttemptSchema.parse({
        examId: exam.id,
        pledgeAccepted: true,
        clientInfo: { ...rng.pick(DEVICES), timezone: 'Asia/Karachi' },
      }),
    );
    const rows = await on
      .select({
        id: attemptItems.id,
        questionId: attemptItems.questionId,
        type: attemptItems.type,
        marks: attemptItems.marks,
        workingMarks: attemptItems.workingMarks,
        content: attemptItems.content,
        answerKey: attemptItems.answerKey,
        variant: attemptItems.variant,
      })
      .from(attemptItems)
      .where(eq(attemptItems.attemptId, view.id))
      .orderBy(asc(attemptItems.position));
    const items = rows.map((r) => {
      const ref = refs.get(r.questionId) ?? 'unknown';
      return {
        id: r.id,
        ref,
        difficulty: SEED_QUESTIONS.find((q) => q.ref === ref)?.difficulty ?? 'medium',
        type: r.type,
        marks: r.marks,
        workingMarks: r.workingMarks,
        content: r.content,
        answerKey: r.answerKey,
        values: ((r.variant as { values?: Record<string, number> }).values ?? {}) as Record<
          string,
          number
        >,
      };
    });
    return new Sitting(sittingEngine, auth, view.id, items);
  }

  item(ref: string): SeedItem | undefined {
    return this.items.find((i) => i.ref === ref);
  }

  /** The next revision of one answer, as the browser records it. */
  private change(c: Change, when: Date) {
    const revision = (this.revisions.get(c.item.id) ?? 0) + 1;
    this.revisions.set(c.item.id, revision);
    return {
      itemId: c.item.id,
      revision,
      response: c.response,
      ...(c.working !== undefined ? { working: c.working } : {}),
      ...(c.provenance ? { provenance: c.provenance } : {}),
      ...(c.flagged !== undefined ? { flagged: c.flagged } : {}),
      timeSpentMs: 40_000 + revision * 25_000,
      changedAt: when.toISOString(),
    };
  }

  /** A change saved only on the device while it is offline (an offline journal entry). */
  journalEntry(c: Change, when: Date): AnswerChange {
    return answerChangeSchema.parse(this.change(c, when));
  }

  /** The deadline sweep reaching this attempt. */
  async expire(when: Date) {
    clock.set(when);
    return this.engine.finalize(this.attemptId, 'timeout');
  }

  private payload(changes: Change[], events: SeedEvent[], when: Date) {
    return {
      answers: changes.map((c) => this.change(c, when)),
      events: events.map((e, i) => ({
        type: e.type,
        clientTs: new Date(when.getTime() - (events.length - i) * 4_000).toISOString(),
        payload: e.payload ?? {},
      })),
      viewed: changes.map((c) => c.item.id),
      rttMs: 40 + Math.round(Math.random() * 160),
    };
  }

  async save(when: Date, changes: Change[], events: SeedEvent[] = []) {
    clock.set(when);
    const response = await this.engine.sync(
      this.auth,
      this.attemptId,
      syncRequestSchema.parse(this.payload(changes, events, when)),
    );
    if (response.rejected.length)
      throw new Error(`seed sync rejected: ${JSON.stringify(response.rejected)}`);
  }

  async submit(when: Date, changes: Change[] = []) {
    clock.set(when);
    return this.engine.submit(
      this.auth,
      this.attemptId,
      submitAttemptSchema.parse({ ...this.payload(changes, [], when), confirm: true }),
    );
  }
}

// ------------------------------------------------------------------------------------------------ answers

type Outcome = 'correct' | 'partial' | 'wrong';
type Quality = 'full' | 'partial' | 'weak' | 'blank';

const DIFFICULTY_SHIFT: Record<Difficulty, number> = { easy: 0.12, medium: 0, hard: -0.2 };

function drawOutcome(rng: Rng, ability: number, difficulty: Difficulty): Outcome {
  const p = Math.min(0.97, Math.max(0.05, ability + DIFFICULTY_SHIFT[difficulty]));
  const u = rng.next();
  if (u < p) return 'correct';
  return u < p + (1 - p) * 0.35 ? 'partial' : 'wrong';
}

/** The wrong option most candidates fall for (a real misconception), per question. */
const COMMON_WRONG_OPTION: Record<string, string> = {
  'phy-newton': 'o4', // 20 m/s²: multiplied instead of divided
  'calc-integral': 'o4', // 12: forgot to divide by 3
  'ds-binsearch': 'o3',
  'ds-bfs': 'o1',
  'ds-heap-parent': 'o1',
  'ds-rb-height': 'o1',
  'ds-trie': 'o4',
};

/** Typical wrong working for parameterized numeric questions, evaluated on the candidate's own variant. */
const MISCONCEPTION: Record<string, (v: Record<string, number>) => number> = {
  'phy-accel': (v) => v.v! * v.t!,
  'phy-freefall': (v) => 2 * 9.8 * v.h!,
  'calc-derivative': (v) => 3 * v.a! * v.a! + 2 * v.a!,
  'alg-tree-nodes': (v) => 2 ** v.h!,
};

const FILL_WRONG: Record<string, Record<string, string>> = {
  'alg-dijkstra': { b1: 'cyclic', b2: 'Prim' },
};

function numericValue(item: SeedItem, outcome: Outcome, rng: Rng): string {
  const answer = item.answerKey.answer as number;
  if (outcome === 'correct') return fmt(answer);
  // Slightly off: a rounding or arithmetic slip outside the tolerance.
  if (outcome === 'partial') return fmt(answer * (1 + rng.pick([-0.12, -0.07, 0.06, 0.1])));
  const wrong = MISCONCEPTION[item.ref]?.(item.values);
  return fmt(wrong !== undefined && wrong !== answer ? wrong : answer * 2);
}

function objectiveResponse(item: SeedItem, outcome: Outcome, rng: Rng): Json {
  const key = item.answerKey;
  const optionIds = ((item.content.options as { id: string }[] | undefined) ?? []).map((o) => o.id);
  switch (item.type) {
    case 'single_choice': {
      if (outcome === 'correct') return { optionId: key.correct };
      const common = COMMON_WRONG_OPTION[item.ref];
      return {
        optionId:
          common && rng.next() < 0.7
            ? common
            : rng.pick(optionIds.filter((id) => id !== key.correct)),
      };
    }
    case 'true_false':
      return { value: outcome === 'correct' ? key.correct : !key.correct };
    case 'multiple_choice': {
      const correct = key.correct as string[];
      const wrong = optionIds.filter((id) => !correct.includes(id));
      if (outcome === 'correct') return { optionIds: [...correct] };
      if (outcome === 'partial')
        return {
          optionIds: rng.next() < 0.5 ? correct.slice(0, -1) : [...correct, rng.pick(wrong)],
        };
      return { optionIds: [correct[0]!, ...rng.shuffle(wrong).slice(0, 2)] };
    }
    case 'numeric':
      return { value: numericValue(item, outcome, rng) };
    case 'short_text':
      return {
        text:
          outcome === 'correct'
            ? rng.pick(['stack', 'Stack', 'a stack'])
            : rng.pick(['queue', 'heap', 'deque']),
      };
    case 'fill_blanks': {
      const blanks = key.blanks as Record<string, string[]>;
      const ids = Object.keys(blanks);
      const right = outcome === 'correct' ? ids.length : outcome === 'partial' ? 1 : 0;
      return {
        blanks: Object.fromEntries(
          ids.map((id, i) => [
            id,
            i < right ? blanks[id]![0]! : (FILL_WRONG[item.ref]?.[id] ?? 'not sure'),
          ]),
        ),
      };
    }
    case 'matching': {
      const pairs = key.pairs as Record<string, string>;
      const prompts = Object.keys(pairs);
      if (outcome === 'correct') return { pairs: { ...pairs } };
      if (outcome === 'partial') {
        const [p1, p2] = rng.shuffle(prompts);
        return { pairs: { ...pairs, [p1!]: pairs[p2!]!, [p2!]: pairs[p1!]! } };
      }
      return {
        pairs: Object.fromEntries(
          prompts.map((p, i) => [p, pairs[prompts[(i + 1) % prompts.length]!]!]),
        ),
      };
    }
    case 'ordering': {
      const order = [...(key.order as string[])];
      if (outcome === 'correct') return { order };
      const i = rng.int(order.length - 1);
      [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
      if (outcome === 'wrong')
        [order[0], order[order.length - 1]] = [order[order.length - 1]!, order[0]!];
      return { order };
    }
    default:
      throw new Error(`no objective response for ${item.type}`);
  }
}

const WEAK_WORKING = [
  'Used the formula from the lecture.',
  'I applied the standard equation.',
  'Worked it out on paper.',
  'Same method as the tutorial question.',
];

/** "Show your working" text by quality, written with the candidate's own numbers. */
function workingText(item: SeedItem, quality: Quality, rng: Rng): string {
  const v = item.values;
  const answer = item.answerKey.answer as number;
  const texts: Record<string, Record<Exclude<Quality, 'blank'>, string>> = {
    'phy-accel': {
      full: `Using a = (v - u) / t with u = 0 because the car starts from rest. a = (${v.v} - 0) / ${v.t} = ${fmt(answer)} m/s^2.`,
      partial: `a = v / t = ${v.v} / ${v.t}`,
      weak: rng.pick(['Acceleration is speed and time.', ...WEAK_WORKING]),
    },
    'phy-freefall': {
      full: `v^2 = u^2 + 2gh and u = 0, so v = sqrt(2 x 9.8 x ${v.h}) = sqrt(${fmt(2 * 9.8 * v.h!)}) = ${fmt(answer)} m/s.`,
      partial: `v^2 = u^2 + 2gh = 2 x 9.8 x ${v.h} = ${fmt(2 * 9.8 * v.h!)}`,
      weak: rng.pick(['Used the falling object equation.', ...WEAK_WORKING]),
    },
    'calc-derivative': {
      full: `Power rule: f'(x) = 6x + 2. At x = ${v.a}: f'(${v.a}) = 6(${v.a}) + 2 = ${fmt(answer)}.`,
      partial: `f'(x) = 6x + 2`,
      weak: rng.pick(['Differentiate and put the value in.', ...WEAK_WORKING]),
    },
    'alg-tree-nodes': {
      full: `Level k has at most 2^k nodes, so the total is 2^0 + 2^1 + ... + 2^${v.h} = 2^${v.h! + 1} - 1 = ${fmt(answer)}.`,
      partial: `Each level doubles: 1, 2, 4, ... up to 2^${v.h} on the last level.`,
      weak: rng.pick(['Counted the nodes in the tree.', ...WEAK_WORKING]),
    },
  };
  return quality === 'blank' ? '' : (texts[item.ref]?.[quality] ?? rng.pick(WEAK_WORKING));
}

function workingQualityFor(outcome: Outcome, rng: Rng): Quality {
  const u = rng.next();
  if (outcome === 'correct') return u < 0.75 ? 'full' : u < 0.95 ? 'partial' : 'blank';
  return u < 0.45 ? 'partial' : u < 0.8 ? 'weak' : 'blank';
}

/** Drives a ProvenanceRecorder through realistic typing: short chunks, pauses and the odd corrected typo. */
function typed(
  text: string,
  rng: Rng,
  recorder = new ProvenanceRecorder(),
  state = { text: '', t: 0 },
) {
  for (let i = 0; i < text.length;) {
    const size = 6 + rng.int(22);
    const chunk = text.slice(i, i + size);
    if (rng.next() < 0.1 && state.text.length > 10) {
      recorder.record(state.text, `${state.text}xq`, { now: (state.t += 300) });
      recorder.record(`${state.text}xq`, state.text, { now: (state.t += 700) });
    }
    recorder.record(state.text, state.text + chunk, { now: (state.t += 900 + rng.int(3200)) });
    state.text += chunk;
    i += size;
  }
  return { recorder, state };
}

const typedProvenance = (text: string, rng: Rng) => typed(text, rng).recorder.snapshot();

// ------------------------------------------------------------------------------------------------ texts

const ESSAYS = [
  'A process is a program in execution with its own address space, open files and other resources managed by the operating system. A thread is a path of execution inside a process: threads of one process share its memory and files, but each has its own stack, registers and program counter. Threads are preferable for a web server that handles many requests at once, because creating a thread is cheaper than creating a process and threads can share a cache. The risk is race conditions: two threads updating shared data without a lock can corrupt it, and careless locking can deadlock.',
  'A process has a separate memory space and is isolated from other processes, so a crash in one does not affect the others. Threads live inside a process and share the same heap, which makes communication between them fast but less safe. Each thread keeps its own stack. I would use threads in a GUI program so the interface stays responsive while a background thread downloads a file. The main risk is data races on shared variables, which need mutexes.',
  'Process is a running program and a thread is a smaller part of a process. Threads share memory so they are faster to create. A browser uses threads for tabs. Threads can have problems when they use the same variable at the same time.',
  'Processes do not share memory, threads do. Threads are lighter. Use threads for a server. Risk: deadlock.',
];

/** The answer pasted into the DS Midterm essay (the reason the attempt is flagged for review). */
const PASTED_ESSAY =
  'A process is an instance of a computer program that is being executed by one or many threads. It contains the program code and its activity, and each process has its own virtual address space, executable code, open handles to system objects, a security context, a unique process identifier and environment variables. A thread of execution is the smallest sequence of programmed instructions that can be managed independently by a scheduler; multiple threads can exist within one process, executing concurrently and sharing resources such as memory. Threads are preferable in a server handling many concurrent clients, while race conditions remain the main risk.';

const CODE_ANSWERS = [
  'def is_palindrome(s: str) -> bool:\n    i, j = 0, len(s) - 1\n    while i < j:\n        if not s[i].isalnum():\n            i += 1\n        elif not s[j].isalnum():\n            j -= 1\n        elif s[i].lower() != s[j].lower():\n            return False\n        else:\n            i += 1\n            j -= 1\n    return True\n',
  "def is_palindrome(s: str) -> bool:\n    cleaned = ''.join(c.lower() for c in s if c.isalnum())\n    return cleaned == cleaned[::-1]\n",
  'def is_palindrome(s: str) -> bool:\n    return s == s[::-1]\n',
];

// ------------------------------------------------------------------------------------------------ helpers

async function questionRefs(organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: questions.id, title: questions.title })
    .from(questions)
    .where(eq(questions.organizationId, organizationId));
  return new Map(
    rows.map((r) => [r.id, SEED_QUESTIONS.find((q) => q.title === r.title)?.ref ?? 'unknown']),
  );
}

function answerChange(
  item: SeedItem,
  outcome: Outcome,
  rng: Rng,
  scriptedQuality?: Quality,
): Change {
  const response = objectiveResponse(item, outcome, rng);
  if (item.workingMarks === 0) return { item, response };
  const quality = scriptedQuality ?? workingQualityFor(outcome, rng);
  const text = workingText(item, quality, rng);
  return {
    item,
    response,
    quality,
    working: { text, scratchPages: [] },
    ...(text ? { provenance: typedProvenance(text, rng) } : {}),
  };
}

function writtenChange(item: SeedItem, text: string, rng: Rng): Change {
  const response = item.type === 'code' ? { code: text } : { text };
  return { item, response, provenance: typedProvenance(text, rng) };
}

/** Bilal grades the shown working of every submitted Mechanics attempt with the exam's working rubric. */
async function gradeWorking(
  examId: string,
  organizationId: string,
  grader: User,
  gradedAt: Date,
  qualityOf: Map<string, Quality>,
) {
  const rubric = await db
    .select()
    .from(rubricItems)
    .where(and(eq(rubricItems.examId, examId), eq(rubricItems.target, 'working')))
    .orderBy(asc(rubricItems.position));
  const pending = await db
    .select({ answer: answers, item: attemptItems })
    .from(answers)
    .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
    .innerJoin(attempts, eq(attempts.id, answers.attemptId))
    .where(
      and(
        eq(attempts.examId, examId),
        eq(attempts.status, 'submitted'),
        eq(attempts.isSandbox, false),
      ),
    );
  const byAttempt = new Map<string, typeof pending>();
  for (const row of pending) {
    if (row.item.workingMarks === 0 || row.answer.workingScore !== null) continue;
    byAttempt.set(row.answer.attemptId, [...(byAttempt.get(row.answer.attemptId) ?? []), row]);
  }
  for (const [attemptId, rows] of byAttempt) {
    await db.transaction(async (tx) => {
      for (const { answer, item } of rows) {
        const items = rubric.filter((r) => r.questionId === item.questionId);
        const quality = qualityOf.get(answer.id) ?? 'weak';
        const selected =
          quality === 'full' ? items : quality === 'partial' ? items.slice(0, 1) : [];
        const score = round3(
          Math.min(
            item.workingMarks,
            Math.max(
              0,
              selected.reduce((s, r) => s + r.points, 0),
            ),
          ),
        );
        await tx
          .update(answers)
          .set({
            workingScore: score,
            workingAdjustment: 0,
            rubricItemIds: selected.map((r) => r.id),
            scoreStatus: 'manual',
            gradedBy: grader.id,
            gradedAt,
          })
          .where(eq(answers.id, answer.id));
        await appendLedger(tx, {
          organizationId,
          examId,
          attemptId,
          answerId: answer.id,
          action: 'manual_grade',
          actorId: grader.id,
          previousScore: null,
          newScore: score,
          reason: null,
          metadata: {
            part: 'working',
            rubricItemIds: selected.map((r) => r.id),
            adjustment: 0,
            explicit: false,
            clamped: false,
          },
        });
      }
      await recomputeAttempt(tx, attemptId);
    });
  }
}

/** Calibration for the fairness engine from real results: mean answer-score fraction per question. */
async function calibrateFromResults(examId: string) {
  const rows = await db
    .select({
      questionId: attemptItems.questionId,
      marks: attemptItems.marks,
      auto: answers.autoScore,
      manual: answers.manualScore,
    })
    .from(answers)
    .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
    .innerJoin(attempts, eq(attempts.id, answers.attemptId))
    .where(
      and(
        eq(attempts.examId, examId),
        eq(attempts.status, 'submitted'),
        eq(attempts.isSandbox, false),
      ),
    );
  const stats = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const earned = r.auto ?? r.manual;
    if (earned === null || r.marks <= 0) continue;
    const s = stats.get(r.questionId) ?? { sum: 0, n: 0 };
    s.sum += Math.min(1, Math.max(0, earned / r.marks));
    s.n++;
    stats.set(r.questionId, s);
  }
  for (const [id, s] of stats) {
    await db
      .update(questions)
      .set({ observedP: Math.round((s.sum / s.n) * 10_000) / 10_000, observedN: s.n })
      .where(eq(questions.id, id));
  }
}

// ------------------------------------------------------------------------------------------------ Mechanics Quiz 3

type Script = Record<string, { outcome: Outcome; quality?: Quality; response?: Json }>;

/** Ali lands around 83% (one slip on free fall), Ayesha around 91%. */
const ALI_SCRIPT: Script = {
  'phy-newton': { outcome: 'correct' },
  'phy-accel': { outcome: 'correct', quality: 'full' },
  'phy-freefall': { outcome: 'wrong', quality: 'partial' },
  'phy-units': { outcome: 'correct' },
  'phy-momentum-tf': { outcome: 'correct' },
  'calc-derivative': { outcome: 'correct', quality: 'full' },
  'calc-integral': { outcome: 'correct' },
};
const AYESHA_SCRIPT: Script = {
  'phy-newton': { outcome: 'correct' },
  'phy-accel': { outcome: 'correct', quality: 'full' },
  'phy-freefall': { outcome: 'correct', quality: 'full' },
  'phy-units': { outcome: 'partial', response: { pairs: { o1: 'a1', o2: 'a4', o3: 'a3' } } },
  'phy-momentum-tf': { outcome: 'correct' },
  'calc-derivative': { outcome: 'correct', quality: 'partial' },
  'calc-integral': { outcome: 'correct' },
};

/** Two candidates who worked together: the same uncommon wrong answers, even on their different numeric variants. */
const COLLUSION_SCRIPT: Script = {
  'phy-newton': { outcome: 'wrong', response: { optionId: 'o3' } }, // 12 m/s²: added force and mass
  'phy-units': { outcome: 'wrong', response: { pairs: { o1: 'a1', o2: 'a2', o3: 'a4' } } }, // power in pascals
  'calc-integral': { outcome: 'wrong', response: { optionId: 'o1' } }, // 4
  'calc-derivative': { outcome: 'wrong', quality: 'weak', response: { value: '17.5' } },
  'phy-freefall': { outcome: 'wrong', quality: 'weak', response: { value: '7.35' } },
};
const COLLUDED_WORKING = [
  (v: Record<string, number>) =>
    `First we know the car starts from rest so u = 0. Then acceleration = change in velocity / time taken = (${v.v} - 0) / ${v.t} which gives ${fmt(v.v! / v.t!)} m/s^2 as the answer.`,
  (v: Record<string, number>) =>
    `First we know the car starts from rest, so u = 0. Then acceleration = change in velocity / time taken = (${v.v} - 0)/${v.t} which gives ${fmt(v.v! / v.t!)} m/s^2 as answer.`,
];

async function seedMechanics(ctx: ActivityContext, refs: Map<string, string>) {
  const exam = ctx.physicsQuiz;
  const rng = createRng('seed:mechanics');
  const sitters = ctx.students.slice(0, 22); // two enrolled students never sat the quiz
  const colluders = [ctx.students[6]!, ctx.students[9]!];
  const qualityOf = new Map<string, Quality>(); // answer id -> working quality, for the grader

  for (const [index, student] of sitters.entries()) {
    const ability =
      student.id === ctx.ali.id
        ? 0.8
        : student.id === ctx.ayesha.id
          ? 0.92
          : 0.35 + rng.next() * 0.6;
    const script =
      student.id === ctx.ali.id
        ? ALI_SCRIPT
        : student.id === ctx.ayesha.id
          ? AYESHA_SCRIPT
          : colluders.includes(student)
            ? COLLUSION_SCRIPT
            : {};
    // Sittings spread through the 24-hour window; the colluders start within a minute of each other.
    const startAt = colluders.includes(student)
      ? at(exam.windowOpensAt, 300 + colluders.indexOf(student))
      : at(exam.windowOpensAt, 30 + index * 55 + rng.int(25));

    // One transaction per sitting, so the attempt is only ever committed as submitted. Its deadline is days in
    // the past: committed in progress, a running API's deadline sweep would finalize it mid-sitting as a timeout.
    await db.transaction(async (tx) => {
      const sitting = await Sitting.begin(student, exam, startAt, rng, refs, tx);

      const changes = sitting.items.map((item) => {
        const scripted = script[item.ref];
        const outcome = scripted?.outcome ?? drawOutcome(rng, ability, item.difficulty);
        const change = answerChange(item, outcome, rng, scripted?.quality);
        if (scripted?.response) change.response = scripted.response;
        if (item.ref === 'phy-accel' && colluders.includes(student)) {
          const text = COLLUDED_WORKING[colluders.indexOf(student)]!(item.values);
          Object.assign(change, {
            quality: 'full',
            working: { text, scratchPages: [] },
            provenance: typedProvenance(text, rng),
          });
        }
        return change;
      });
      if (rng.next() < 0.3) changes[rng.int(changes.length)]!.flagged = true;

      await sitting.save(at(startAt, 6), changes.slice(0, 3));
      await sitting.save(
        at(startAt, 14),
        changes.slice(3, 5),
        rng.next() < 0.2
          ? [
              { type: 'focus_lost', payload: { durationMs: 8_000 + rng.int(20_000) } },
              { type: 'focus_returned' },
            ]
          : [],
      );
      const receipt = await sitting.submit(at(startAt, 21 + rng.int(7)), changes.slice(5));
      if (receipt.submitReason !== 'candidate')
        throw new Error(`${student.email}: Mechanics sitting ended as ${receipt.submitReason}`);

      const stored = await tx
        .select({ id: answers.id, itemId: answers.attemptItemId })
        .from(answers)
        .where(eq(answers.attemptId, sitting.attemptId));
      for (const change of changes) {
        const row = stored.find((r) => r.itemId === change.item.id);
        if (row && change.quality) qualityOf.set(row.id, change.quality);
      }
    });
  }

  const gradedAt = at(exam.windowClosesAt, 5 * 60);
  clock.set(gradedAt);
  await gradeWorking(exam.id, exam.organizationId, ctx.staff.bilal, gradedAt, qualityOf);

  // Results published by the exam owner the day after the window closed.
  const publishedAt = at(exam.windowClosesAt, 24 * 60);
  const recipients = await db
    .select({ attemptId: attempts.id, userId: attempts.userId })
    .from(attempts)
    .where(
      and(
        eq(attempts.examId, exam.id),
        eq(attempts.isSandbox, false),
        eq(attempts.status, 'submitted'),
      ),
    );
  await db.transaction(async (tx) => {
    await tx
      .update(exams)
      .set({
        resultsStatus: 'published',
        resultsVersion: 1,
        resultsPublishedAt: publishedAt,
        resultsPublishedBy: ctx.staff.omar.id,
      })
      .where(eq(exams.id, exam.id));
    await appendLedger(tx, {
      organizationId: exam.organizationId,
      examId: exam.id,
      action: 'results_published',
      actorId: ctx.staff.omar.id,
      reason: null,
      metadata: { resultsVersion: 1, candidates: recipients.length, forced: false, blockers: [] },
    });
    await tx.insert(notifications).values(
      recipients.map((r) => ({
        userId: r.userId,
        organizationId: exam.organizationId,
        kind: 'results_published',
        title: `Results are out: ${exam.title}`,
        body: 'Your score and feedback are ready.',
        link: `/results/${r.attemptId}`,
        createdAt: publishedAt,
      })),
    );
  });
  clock.set(publishedAt);
  await audit.record({
    organizationId: exam.organizationId,
    actorId: ctx.staff.omar.id,
    action: 'results.published',
    entityType: 'exam',
    entityId: exam.id,
    summary: `Published results for ${exam.title}`,
    metadata: { resultsVersion: 1, candidates: recipients.length },
  });
  await calibrateFromResults(exam.id);
}

// ------------------------------------------------------------------------------------------------ DS Midterm (live)

/** Calibration from last term's offering, so the pool is balanced on observed difficulty, not only labels. */
const POOL_HISTORY: Record<string, { p: number; n: number }> = {
  'ds-binsearch': { p: 0.86, n: 48 },
  'ds-bfs': { p: 0.78, n: 52 },
  'ds-heap-parent': { p: 0.55, n: 40 },
  'ds-hash-tf': { p: 0.63, n: 45 },
  'ds-avl-tf': { p: 0.81, n: 50 },
  'ds-lifo': { p: 0.92, n: 47 },
  'ds-rb-height': { p: 0.31, n: 38 },
  'ds-trie': { p: 0.47, n: 36 },
};

async function calibratePools(examId: string, refs: Map<string, string>) {
  const poolQuestions = await db
    .select({ questionId: examQuestions.questionId })
    .from(examQuestions)
    .innerJoin(examSections, eq(examSections.id, examQuestions.sectionId))
    .where(and(eq(examQuestions.examId, examId), isNotNull(examSections.drawCount)));
  for (const { questionId } of poolQuestions) {
    const history = POOL_HISTORY[refs.get(questionId) ?? ''];
    if (history)
      await db
        .update(questions)
        .set({ observedP: history.p, observedN: history.n })
        .where(eq(questions.id, questionId));
  }
}

async function seedMidterm(ctx: ActivityContext, refs: Map<string, string>) {
  const exam = ctx.dsMidterm;
  const rng = createRng('seed:midterm');
  const now = Date.now();
  await calibratePools(exam.id, refs);
  const others = ctx.students.filter((s) => s.id !== ctx.ali.id && s.id !== ctx.ayesha.id);
  const finished = others.slice(0, 3);
  const working = others.slice(3, 15);
  const timedOutOffline = others[15]!; // the remaining six have not started yet
  const paster = working[6]!; // not one of the Mechanics pair: each fixture tells its own story

  const answerAll = (sitting: Sitting, ability: number, upTo: number) =>
    sitting.items.slice(0, upTo).map((item, i) => {
      if (item.type === 'long_text')
        return writtenChange(
          item,
          ESSAYS[Math.min(ESSAYS.length - 1, Math.floor((1 - ability) * 4 + rng.next()))]!,
          rng,
        );
      if (item.type === 'code')
        return writtenChange(item, CODE_ANSWERS[ability > 0.75 ? 0 : ability > 0.55 ? 1 : 2]!, rng);
      const change = answerChange(item, drawOutcome(rng, ability, item.difficulty), rng);
      if (i % 5 === 2 && rng.next() < 0.4) change.flagged = true;
      return change;
    });

  for (const [i, student] of finished.entries()) {
    const startAt = at(now, -29 + i * 2);
    const sitting = await Sitting.begin(student, exam, startAt, rng, refs);
    const changes = answerAll(sitting, 0.6 + rng.next() * 0.35, sitting.items.length);
    await sitting.save(at(startAt, 5), changes.slice(0, 4));
    await sitting.save(
      at(startAt, 11),
      changes.slice(4, 9),
      i === 1
        ? [{ type: 'focus_lost', payload: { durationMs: 12_000 } }, { type: 'focus_returned' }]
        : [],
    );
    await sitting.submit(at(startAt, 19 + i), changes.slice(9));
  }

  for (const [i, student] of working.entries()) {
    const minutesIn = 4 + ((i * 7) % 17); // started 4 to 20 minutes ago
    const startAt = at(now, -minutesIn);
    const sitting = await Sitting.begin(student, exam, startAt, rng, refs);
    const ability = 0.4 + rng.next() * 0.55;
    const reached = Math.min(
      sitting.items.length,
      2 + Math.floor((minutesIn / 20) * (sitting.items.length - 2) * (0.6 + rng.next() * 0.5)),
    );
    // The paster's essay is written below, through a paste.
    const changes = answerAll(sitting, ability, reached).filter(
      (c) => student.id !== paster.id || c.item.type !== 'long_text',
    );
    const events: SeedEvent[] = [];
    if (i % 3 === 0)
      events.push(
        { type: 'focus_lost', payload: { durationMs: 6_000 + rng.int(40_000) } },
        { type: 'focus_returned' },
      );
    if (i === 7)
      events.push(
        { type: 'went_offline' },
        { type: 'came_online', payload: { offlineMs: 48_000 } },
      );
    if (i === 9) events.push({ type: 'multiple_displays', payload: { screens: 2 } });
    const half = Math.ceil(changes.length / 2);
    await sitting.save(at(startAt, Math.max(1, minutesIn / 3)), changes.slice(0, half));
    await sitting.save(at(startAt, Math.max(2, minutesIn - 1)), changes.slice(half), events);

    if (student.id === paster.id) {
      // Types a short opening, leaves the exam window, then pastes a polished 600-character answer.
      const essay = sitting.item('os-process-thread')!;
      const intro = 'Processes and threads both run code but they differ in what they share. ';
      const { recorder, state } = typed(intro, rng);
      recorder.record(state.text, state.text + PASTED_ESSAY, {
        pasted: true,
        now: (state.t += 52_000),
      });
      state.text += PASTED_ESSAY;
      typed(' In short, threads are lighter.', rng, recorder, state);
      await sitting.save(
        at(startAt, minutesIn - 0.5),
        [{ item: essay, response: { text: state.text }, provenance: recorder.snapshot() }],
        [
          { type: 'focus_lost', payload: { durationMs: 51_000 } },
          { type: 'focus_returned' },
          { type: 'paste', payload: { length: PASTED_ESSAY.length, itemId: essay.id } },
        ],
      );
    }
  }

  await seedHeldJournal(exam, timedOutOffline, refs, now);
}

/** The SHA-256 chain the browser computes over a sealed journal (see the web's sync/hash-chain.ts). */
function journalChain(attemptId: string, sealedAt: string, entries: AnswerChange[]): string {
  const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');
  return entries.reduce(
    (hash, entry) => sha256(`${hash}|${canonicalJson(entry)}`),
    sha256(`${attemptId}|${sealedAt}`),
  );
}

/**
 * IC-5.3 fixture. The candidate's connection dropped nine minutes before her deadline. Her browser kept saving
 * locally, sealed the journal when the countdown reached zero, and uploaded it on reconnecting four minutes
 * later, within the grace period. The server had already submitted the attempt on time with what it held, so
 * the two newer answers wait for an examiner; until then the results checklist blocks publication.
 */
async function seedHeldJournal(exam: Exam, student: User, refs: Map<string, string>, now: number) {
  const rng = createRng('seed:offline-journal');
  const startAt = at(now, -82);
  const deadline = at(startAt, exam.durationMinutes);
  const lastSave = at(deadline, -9);

  // One transaction: the deadline is already past, so a running API's sweep must never see it in progress.
  await db.transaction(async (tx) => {
    const sitting = await Sitting.begin(student, exam, startAt, rng, refs, tx);
    const corrected = sitting.items.find(
      (i) => i.type === 'single_choice' || i.type === 'true_false',
    );
    const lateNumeric = sitting.item('alg-tree-nodes');
    if (!corrected || !lateNumeric) throw new Error('offline journal fixture: questions missing');

    const online = sitting.items
      .filter((item) => item.id !== lateNumeric.id)
      .map((item) => {
        if (item.type === 'long_text') return writtenChange(item, ESSAYS[1]!, rng);
        if (item.type === 'code') return writtenChange(item, CODE_ANSWERS[1]!, rng);
        const outcome =
          item.id === corrected.id ? 'wrong' : drawOutcome(rng, 0.72, item.difficulty);
        return answerChange(item, outcome, rng);
      });
    await sitting.save(at(startAt, 9), online.slice(0, 4));
    await sitting.save(at(startAt, 26), online.slice(4, 8));
    await sitting.save(lastSave, online.slice(8)); // the last save that reached the server

    // Offline from here on: the device keeps each change in its local journal.
    const entries = [
      sitting.journalEntry(
        { item: corrected, response: objectiveResponse(corrected, 'correct', rng) },
        at(deadline, -6),
      ),
      sitting.journalEntry(answerChange(lateNumeric, 'correct', rng, 'full'), at(deadline, -2)),
    ];
    const sealedAt = new Date(deadline.getTime() + 600).toISOString();
    const expired = await sitting.expire(new Date(deadline.getTime() + 3_000));
    if (expired.submitReason !== 'timeout')
      throw new Error(`offline journal fixture: attempt ended as ${expired.submitReason}`);

    clock.set(at(deadline, 4));
    const journal = new OfflineJournalService({
      db: tx,
      audit: auditOn(tx),
      realtime,
      now: clock.now,
    });
    const { held } = await journal.submit(sitting.auth, sitting.attemptId, {
      sealedAt,
      lastServerSync: lastSave.toISOString(),
      answers: entries,
      chain: journalChain(sitting.attemptId, sealedAt, entries),
    });
    if (held !== entries.length)
      throw new Error(`offline journal fixture: ${held} of ${entries.length} answers held`);
  });
}

// ------------------------------------------------------------------------------------------------ Qualifier (live)

/** One return to the take-home paper: minutes after starting, and what was answered then. */
interface QualifierVisit {
  minutesIn: number;
  /** Warm-up questions answered on this visit, in paper order. */
  warmUp?: number;
  /** Challenge questions answered on this visit. */
  refs?: string[];
  events?: SeedEvent[];
}

const PALINDROME = 'alg-palindrome';
const CHALLENGE_REFS = ['alg-complexity-match', 'alg-dijkstra', PALINDROME];

/**
 * Competitors on the take-home round, each at their own stage. Every deadline is 24 hours after its start, so
 * the earliest (50 minutes before the seed) still lies more than 23 hours after it.
 */
const QUALIFIER_SITTINGS: {
  email: string;
  startedMinutesAgo: number;
  ability: number;
  /** The code answer, and whether it arrives in one paste rather than typed. */
  code?: { answer: string; pasted: boolean };
  visits: QualifierVisit[];
}[] = [
  {
    email: 'competitor1@codesprint.io',
    startedMinutesAgo: 50,
    ability: 0.85,
    code: { answer: CODE_ANSWERS[0]!, pasted: false },
    visits: [
      { minutesIn: 6, warmUp: 3 },
      { minutesIn: 18, refs: ['alg-complexity-match', 'alg-dijkstra'] },
      { minutesIn: 41, refs: [PALINDROME] },
    ],
  },
  {
    email: 'competitor2@codesprint.io',
    startedMinutesAgo: 44,
    ability: 0.7,
    code: { answer: CODE_ANSWERS[1]!, pasted: true },
    visits: [
      { minutesIn: 9, warmUp: 3 },
      { minutesIn: 35, refs: ['alg-complexity-match', PALINDROME] },
    ],
  },
  {
    email: 'competitor3@codesprint.io',
    startedMinutesAgo: 37,
    ability: 0.6,
    visits: [
      {
        minutesIn: 7,
        warmUp: 2,
        events: [{ type: 'went_offline' }, { type: 'came_online', payload: { offlineMs: 95_000 } }],
      },
      { minutesIn: 30, warmUp: 1, refs: ['alg-dijkstra'] },
    ],
  },
  {
    email: 'competitor4@codesprint.io',
    startedMinutesAgo: 28,
    ability: 0.75,
    visits: [
      {
        minutesIn: 14,
        warmUp: 3,
        refs: ['alg-complexity-match'],
        events: [
          { type: 'focus_lost', payload: { durationMs: 74_000 } },
          { type: 'focus_returned' },
        ],
      },
    ],
  },
  {
    email: 'competitor5@codesprint.io',
    startedMinutesAgo: 19,
    ability: 0.5,
    visits: [{ minutesIn: 8, warmUp: 2 }],
  },
  {
    email: 'competitor6@codesprint.io',
    startedMinutesAgo: 10,
    ability: 0.65,
    visits: [{ minutesIn: 4, warmUp: 1 }],
  },
];

/** Types the signature line, then pastes the body in one go: the indicator a take-home round is watched for. */
function pastedCode(item: SeedItem, code: string, rng: Rng): { change: Change; event: SeedEvent } {
  const cut = code.indexOf('\n') + 1;
  const { recorder, state } = typed(code.slice(0, cut), rng);
  recorder.record(state.text, code, { pasted: true, now: (state.t += 38_000) });
  return {
    change: { item, response: { code }, provenance: recorder.snapshot() },
    event: { type: 'paste', payload: { length: code.length - cut, itemId: item.id } },
  };
}

async function seedQualifier(ctx: ActivityContext) {
  const exam = ctx.qualifier;
  const rng = createRng('seed:qualifier');
  const refs = await questionRefs(exam.organizationId);
  const competitors = await db
    .select()
    .from(users)
    .where(
      inArray(
        users.email,
        QUALIFIER_SITTINGS.map((s) => s.email),
      ),
    );
  const byEmail = new Map(competitors.map((u) => [u.email, u]));
  const now = Date.now();

  for (const plan of QUALIFIER_SITTINGS) {
    const user = byEmail.get(plan.email);
    if (!user) throw new Error(`qualifier fixture: ${plan.email} is missing`);
    const startAt = at(now, -plan.startedMinutesAgo);
    const sitting = await Sitting.begin(user, exam, startAt, rng, refs);
    const warmUp = sitting.items.filter((item) => !CHALLENGE_REFS.includes(item.ref));
    let answered = 0;
    for (const visit of plan.visits) {
      const challenge = (visit.refs ?? []).map((ref) => {
        const item = sitting.item(ref);
        if (!item) throw new Error(`qualifier fixture: ${ref} is not on the paper`);
        return item;
      });
      const events = [...(visit.events ?? [])];
      const changes = [
        ...warmUp.slice(answered, (answered += visit.warmUp ?? 0)),
        ...challenge,
      ].map((item): Change => {
        if (item.type !== 'code')
          return answerChange(item, drawOutcome(rng, plan.ability, item.difficulty), rng);
        if (!plan.code) throw new Error(`qualifier fixture: no code answer for ${plan.email}`);
        if (!plan.code.pasted) return writtenChange(item, plan.code.answer, rng);
        const { change, event } = pastedCode(item, plan.code.answer, rng);
        events.push(event);
        return change;
      });
      await sitting.save(at(startAt, visit.minutesIn), changes, events);
    }
  }
}

// ------------------------------------------------------------------------------------------------ entry

export async function seedActivity(ctx: ActivityContext): Promise<void> {
  const northfieldRefs = await questionRefs(ctx.physicsQuiz.organizationId);
  await seedMechanics(ctx, northfieldRefs);
  await seedMidterm(ctx, northfieldRefs);
  await seedQualifier(ctx);
  clock.set(new Date());
}

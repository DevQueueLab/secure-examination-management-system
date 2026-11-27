/**
 * Demo data: fictional tenants, people for every role, a question bank covering every type and exams in
 * every lifecycle phase. Run with `pnpm db:seed`. Destroys existing data.
 */
import { sql } from 'drizzle-orm';
import { DEFAULT_EXAM_SETTINGS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, examSettingsSchema, type ExamStaffRole, type SystemRoleKey } from '@athena/shared';
import { db, pool } from '../client';
import {
  examEnrollments,
  examQuestions,
  exams,
  examSections,
  examStaff,
  memberships,
  organizations,
  questionCategories,
  questions,
  questionVersions,
  roles,
  rubricItems,
  users,
} from '../schema';
import { hashPassword } from '../../modules/auth/password';
import { questionType } from '../../domain/question-types/registry';
import { applySqlFiles } from '../migrate';
import { SEED_QUESTIONS } from './questions.data';
import { seedActivity } from './activity';
import { seedDisputes } from './disputes';

export const DEMO_PASSWORD = 'Athena@2026';
const minutes = (n: number) => new Date(Date.now() + n * 60_000);
/** Live exams stay open for three days, so the demo data is still live whenever the evaluation happens. */
const LIVE_WINDOW_MINUTES = 60 * 24 * 3;

const FIRST = ['Ali', 'Ayesha', 'Hamza', 'Fatima', 'Usman', 'Zainab', 'Saad', 'Maryam', 'Hassan', 'Noor', 'Bilal', 'Iqra', 'Danish', 'Hira', 'Talha', 'Sana', 'Fahad', 'Amna', 'Raza', 'Mahnoor', 'Shayan', 'Laiba', 'Arham', 'Eman'];
const LAST = ['Hassan', 'Malik', 'Siddiqui', 'Butt', 'Chaudhry', 'Sheikh', 'Qureshi', 'Javed', 'Iqbal', 'Rana', 'Mirza', 'Aslam'];

async function reset() {
  const { rows } = await pool.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
  const tables = rows.map((r) => `"${r.tablename}"`).filter((t) => t !== '"__drizzle_migrations"');
  if (tables.length) await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  // The ledger guard blocks TRUNCATE? No: triggers are row-level UPDATE/DELETE only; TRUNCATE is allowed for resets.
  await reset();
  await applySqlFiles(new URL('../sql', import.meta.url).pathname).catch(() => applySqlFiles('src/db/sql'));
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const mkUser = async (email: string, name: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db.insert(users).values({ email, name, passwordHash, ...extra }).returning();
    return u!;
  };

  // ---------- platform ----------
  const platformAdmin = await mkUser('admin@athena.app', 'Zara Sheikh', { isPlatformAdmin: true });

  // ---------- tenants ----------
  const mkOrg = async (name: string, slug: string, type: 'institution' | 'competition', contactEmail: string, accentColor: string) => {
    const [org] = await db.insert(organizations).values({ name, slug, type, contactEmail, branding: { accentColor }, createdBy: platformAdmin.id }).returning();
    const roleIds = {} as Record<SystemRoleKey, string>;
    for (const key of SYSTEM_ROLE_KEYS) {
      const def = SYSTEM_ROLES[key];
      const [r] = await db.insert(roles).values({ organizationId: org!.id, key, name: def.name, description: def.description, permissions: def.permissions, isSystem: true }).returning();
      roleIds[key] = r!.id;
    }
    return { org: org!, roleIds };
  };
  const northfield = await mkOrg('Northfield Institute of Technology', 'northfield', 'institution', 'registrar@northfield.edu', '#0E7C66');
  const codesprint = await mkOrg('CodeSprint League', 'codesprint', 'competition', 'organizer@codesprint.io', '#FF9F0A');
  // A suspended tenant shows that suspension cuts access immediately.
  const riverside = await mkOrg('Riverside College', 'riverside', 'institution', 'admin@riverside.edu', '#30D158');
  await db.execute(sql`update organizations set status = 'suspended' where id = ${riverside.org.id}`);

  const join = (userId: string, tenant: typeof northfield, role: SystemRoleKey, extra: { externalId?: string; cohort?: string } = {}) =>
    db.insert(memberships).values({ userId, organizationId: tenant.org.id, roleId: tenant.roleIds[role], ...extra });

  const riversideAdmin = await mkUser('admin@riverside.edu', 'Nadia Rehman');
  await join(riversideAdmin.id, riverside, 'org_admin');

  const registrar = await mkUser('registrar@northfield.edu', 'Imran Qureshi');
  await join(registrar.id, northfield, 'org_admin');
  const sara = await mkUser('sara.ahmed@northfield.edu', 'Dr. Sara Ahmed');
  await join(sara.id, northfield, 'examiner');
  const omar = await mkUser('omar.farooq@northfield.edu', 'Omar Farooq');
  await join(omar.id, northfield, 'examiner');
  const bilal = await mkUser('bilal.khan@northfield.edu', 'Bilal Khan');
  await join(bilal.id, northfield, 'grader');
  const hina = await mkUser('hina.raza@northfield.edu', 'Hina Raza');
  await join(hina.id, northfield, 'proctor');

  const students: (typeof users.$inferSelect)[] = [];
  const ali = await mkUser('ali.hassan@student.northfield.edu', 'Ali Hassan');
  const ayesha = await mkUser('ayesha.malik@student.northfield.edu', 'Ayesha Malik');
  students.push(ali, ayesha);
  for (let i = 2; i < 24; i++) {
    const first = FIRST[i]!;
    const last = LAST[i % LAST.length]!;
    students.push(await mkUser(`${first.toLowerCase()}.${last.toLowerCase()}${i}@student.northfield.edu`, `${first} ${last}`));
  }
  for (const [i, s] of students.entries()) {
    await join(s.id, northfield, 'candidate', { externalId: `FA24-BCS-${String(i + 1).padStart(3, '0')}`, cohort: i % 2 === 0 ? 'BCS-5A' : 'BCS-5B' });
  }

  const organizer = await mkUser('organizer@codesprint.io', 'Usman Tariq');
  await join(organizer.id, codesprint, 'org_admin');
  const judge = await mkUser('judge@codesprint.io', 'Mehwish Ali');
  await join(judge.id, codesprint, 'examiner');
  // Ali competes in CodeSprint too: one identity, two tenants (org switcher).
  await join(ali.id, codesprint, 'candidate', { externalId: 'CS-2026-0042', cohort: 'Team Byte' });
  const competitors = [ali];
  for (let i = 0; i < 8; i++) {
    const u = await mkUser(`competitor${i + 1}@codesprint.io`, `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i + 3) % LAST.length]}`);
    await join(u.id, codesprint, 'candidate', { externalId: `CS-2026-${String(100 + i)}`, cohort: `Team ${['Alpha', 'Beta', 'Gamma', 'Delta'][i % 4]}` });
    competitors.push(u);
  }

  // ---------- question bank ----------
  const bank = new Map<string, { id: string; versionId: string; marks: number; type: string; category: string }>();
  const categoryIds = new Map<string, string>();
  const insertBank = async (tenantId: string, authorId: string, list = SEED_QUESTIONS) => {
    for (const q of list) {
      const catKey = `${tenantId}:${q.category}`;
      if (!categoryIds.has(catKey)) {
        const [c] = await db.insert(questionCategories).values({ organizationId: tenantId, name: q.category }).returning();
        categoryIds.set(catKey, c!.id);
      }
      const { content, key } = questionType(q.type).validateDraft(q.content, q.key);
      const [row] = await db
        .insert(questions)
        .values({ organizationId: tenantId, categoryId: categoryIds.get(catKey), type: q.type, difficulty: q.difficulty, title: q.title, tags: q.tags ?? [], defaultMarks: q.marks, createdBy: authorId, updatedBy: authorId })
        .returning();
      const [v] = await db.insert(questionVersions).values({ questionId: row!.id, version: 1, content, answerKey: key, createdBy: authorId }).returning();
      bank.set(`${tenantId}:${q.ref}`, { id: row!.id, versionId: v!.id, marks: q.marks, type: q.type, category: q.category });
    }
  };
  await insertBank(northfield.org.id, sara.id);
  await insertBank(codesprint.org.id, judge.id, SEED_QUESTIONS.filter((q) => ['Algorithms', 'Data Structures'].includes(q.category)));

  // ---------- exams ----------
  type SectionSpec = { title: string; instructions?: string; draw?: number; refs: string[] };
  const mkExam = async (spec: {
    tenant: typeof northfield;
    title: string;
    code: string;
    description: string;
    instructions: string;
    status: 'draft' | 'published';
    opens: Date;
    closes: Date;
    duration: number;
    owner: string;
    staff?: { userId: string; role: ExamStaffRole }[];
    sections: SectionSpec[];
    settings?: Partial<typeof DEFAULT_EXAM_SETTINGS>;
    candidates: string[];
  }) => {
    const tenantId = spec.tenant.org.id;
    let total = 0;
    for (const s of spec.sections) {
      const marksEach = s.refs.map((r) => bank.get(`${tenantId}:${r}`)!.marks);
      total += s.draw ? marksEach[0]! * s.draw : marksEach.reduce((a, b) => a + b, 0);
    }
    const settings = examSettingsSchema.parse({ ...DEFAULT_EXAM_SETTINGS, ...spec.settings });
    const [exam] = await db
      .insert(exams)
      .values({
        organizationId: tenantId,
        title: spec.title,
        code: spec.code,
        description: spec.description,
        instructions: spec.instructions,
        status: spec.status,
        windowOpensAt: spec.opens,
        windowClosesAt: spec.closes,
        durationMinutes: spec.duration,
        totalMarks: total,
        settings,
        createdBy: spec.owner,
        publishedAt: spec.status === 'published' ? minutes(-60 * 24) : null,
        publishedBy: spec.status === 'published' ? spec.owner : null,
      })
      .returning();
    await db.insert(examStaff).values([{ examId: exam!.id, userId: spec.owner, role: 'owner' }, ...(spec.staff ?? []).map((s) => ({ examId: exam!.id, ...s }))]);
    for (const [si, s] of spec.sections.entries()) {
      const [section] = await db.insert(examSections).values({ examId: exam!.id, title: s.title, instructions: s.instructions, position: si, drawCount: s.draw ?? null }).returning();
      for (const [qi, ref] of s.refs.entries()) {
        const q = bank.get(`${tenantId}:${ref}`)!;
        await db.insert(examQuestions).values({ examId: exam!.id, sectionId: section!.id, questionId: q.id, questionVersionId: q.versionId, marks: q.marks, position: qi });
        const seedQ = SEED_QUESTIONS.find((x) => x.ref === ref)!;
        for (const [ri, item] of (seedQ.rubric ?? []).entries()) {
          await db.insert(rubricItems).values({ examId: exam!.id, questionId: q.id, target: item.target ?? 'answer', label: item.label, description: item.description, points: item.points, position: ri });
        }
      }
    }
    if (spec.candidates.length) {
      await db.insert(examEnrollments).values(spec.candidates.map((userId) => ({ examId: exam!.id, userId, enrolledBy: spec.owner })));
    }
    return exam!;
  };

  const dsMidterm = await mkExam({
    tenant: northfield,
    title: 'Data Structures & Algorithms Midterm',
    code: 'CS-201',
    description: 'Midterm covering complexity, trees, heaps, graphs and sorting.',
    instructions:
      '- You have **60 minutes** once you start. The timer is kept by the server, so it keeps running if you close the tab.\n- Section A draws 4 questions from a balanced pool, so your paper differs from your neighbour\'s but has the same difficulty.\n- Your answers save automatically, even offline. Keep working if your connection drops.\n- Show your working where asked: method marks are awarded separately.\n- The calculator and scratchpad are in the toolbar.',
    status: 'published',
    opens: minutes(-90),
    closes: minutes(LIVE_WINDOW_MINUTES),
    duration: 60,
    owner: sara.id,
    staff: [{ userId: bilal.id, role: 'grader' }, { userId: hina.id, role: 'proctor' }],
    sections: [
      { title: 'Section A: Fundamentals', instructions: 'Four questions drawn from a difficulty-balanced pool.', draw: 4, refs: ['ds-binsearch', 'ds-bfs', 'ds-heap-parent', 'ds-hash-tf', 'ds-avl-tf', 'ds-lifo', 'ds-rb-height', 'ds-trie'] },
      { title: 'Section B: Problem solving', refs: ['alg-tree-nodes', 'alg-stable', 'alg-dijkstra', 'alg-complexity-match', 'alg-growth-order'] },
      { title: 'Section C: Written', refs: ['os-process-thread', 'alg-palindrome'] },
    ],
    settings: { integrity: { ...DEFAULT_EXAM_SETTINGS.integrity, requireFullscreen: false, detectFocusLoss: true, watermark: true, honorCode: 'I will complete this examination on my own, without help from other people or AI tools, and I will not share its contents.' } },
    candidates: students.map((s) => s.id),
  });

  const physicsQuiz = await mkExam({
    tenant: northfield,
    title: 'Mechanics Quiz 3',
    code: 'PHY-101',
    description: 'Kinematics, forces and energy. Results are published.',
    instructions: 'Answer every question. Numeric answers are accepted within the stated tolerance. Show your working for method marks.',
    status: 'published',
    opens: minutes(-60 * 24 * 3),
    closes: minutes(-60 * 24 * 2),
    duration: 30,
    owner: omar.id,
    staff: [{ userId: bilal.id, role: 'grader' }],
    sections: [{ title: 'Mechanics', refs: ['phy-newton', 'phy-accel', 'phy-freefall', 'phy-units', 'phy-momentum-tf', 'calc-derivative', 'calc-integral'] }],
    settings: { results: { ...DEFAULT_EXAM_SETTINGS.results, showCorrectAnswers: true } },
    candidates: students.map((s) => s.id),
  });

  await mkExam({
    tenant: northfield,
    title: 'Database Systems Final',
    code: 'CS-305',
    description: 'Normalization, transactions, indexing and SQL.',
    instructions: 'Closed book. The exam opens at the scheduled time; you cannot enter earlier.',
    status: 'published',
    opens: minutes(60 * 24 * 5),
    closes: minutes(60 * 24 * 5 + 180),
    duration: 90,
    owner: sara.id,
    sections: [
      { title: 'Concepts', refs: ['db-3nf', 'db-acid', 'db-keys', 'db-distinct'] },
      { title: 'Applied', refs: ['db-second-salary', 'db-index-essay'] },
    ],
    candidates: students.map((s) => s.id),
  });

  await mkExam({
    tenant: northfield,
    title: 'Software Design Principles',
    code: 'SE-210',
    description: 'Draft: still being assembled.',
    instructions: 'Answer all questions.',
    status: 'draft',
    opens: minutes(60 * 24 * 7),
    closes: minutes(60 * 24 * 7 + 120),
    duration: 45,
    owner: sara.id,
    sections: [{ title: 'Design', refs: ['se-patterns', 'se-resilience'] }],
    candidates: [],
  });

  const qualifier = await mkExam({
    tenant: codesprint,
    title: 'CodeSprint Qualifier 2026',
    code: 'QUAL-26',
    description: 'Take-home online qualifier for the national finals.',
    instructions:
      '- A take-home round: you have **24 hours** from when you start, and the window closes a week after it opens.\n- Your answers save as you go, so you can leave and come back as often as you like. The timer keeps running while you are away.\n- Top 30% qualify. Ties are broken by submission time.',
    status: 'published',
    // Take-home: 24 hours per competitor inside a week-long window, so seeded sittings stay live for about a day.
    opens: minutes(-60 * 24),
    closes: minutes(60 * 24 * 6),
    duration: 60 * 24,
    owner: judge.id,
    sections: [
      { title: 'Warm-up', draw: 3, refs: ['ds-binsearch', 'ds-bfs', 'ds-heap-parent', 'ds-hash-tf', 'ds-avl-tf', 'ds-rb-height'] },
      { title: 'Challenge', refs: ['alg-complexity-match', 'alg-dijkstra', 'alg-palindrome'] },
    ],
    candidates: competitors.map((c) => c.id),
  });

  await seedActivity({ dsMidterm, physicsQuiz, qualifier, students, ali, ayesha, staff: { sara, omar, bilal, hina } });
  await seedDisputes({ exam: physicsQuiz, ali, ayesha, omar });

  console.log(`Seeded. Every demo account uses the password ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

/**
 * Dispute demo on Mechanics Quiz 3, created through the real services so every score change is in the
 * hash-chained ledger and every dispute carries sealed, frozen evidence:
 *
 * - a question fixed for everyone: Newton's second law also accepts the answer a misprint led to, which
 *   resolves the dispute that reported it;
 * - Ayesha's dispute about her working, upheld with a re-mark and a written reason she can read;
 * - Ali's dispute about his working, assigned to Omar and under review, to decide live;
 * - an appeal against a "not upheld" decision, waiting for a reviewer other than the one who decided.
 *
 * Runs after the activity seed. Skips itself when the exam already has disputes or remedies, so running it
 * twice changes nothing.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Permission } from '@athena/shared';
import { createContainer } from '../../container';
import { DisputesService } from '../../modules/disputes/disputes.service';
import { RemediesService } from '../../modules/disputes/remedies.service';
import { loadExamStructure, type ExamQuestionInfo } from '../../modules/grading/exam-structure';
import type { TenantAuthContext } from '../../types/auth';
import { db } from '../client';
import { answers, attemptItems, attempts, disputes, memberships, organizations, remedies, roles, users } from '../schema';

type UserRow = typeof users.$inferSelect;

export interface DisputeSeedContext {
  exam: { id: string; organizationId: string };
  ali: UserRow;
  ayesha: UserRow;
  omar: UserRow;
}

/** The session a request would carry, from the user's real membership and role. */
async function sessionFor(user: UserRow, organizationId: string): Promise<TenantAuthContext> {
  const [m] = await db
    .select({ id: memberships.id, roleId: roles.id, roleKey: roles.key, roleName: roles.name, permissions: roles.permissions, org: organizations })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!m) throw new Error(`${user.email} has no membership in ${organizationId}`);
  return {
    sessionId: randomUUID(),
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin, mustChangePassword: false, preferences: {} },
    organization: { id: m.org.id, name: m.org.name, slug: m.org.slug, type: m.org.type, status: m.org.status },
    membership: { id: m.id, roleId: m.roleId, roleKey: m.roleKey, roleName: m.roleName },
    permissions: new Set(m.permissions as Permission[]),
  };
}

/** Every marked answer to one question on this exam, with who gave it and what the candidate wrote. */
async function answersTo(examId: string, questionId: string) {
  return db
    .select({
      attemptId: attempts.id,
      userId: attempts.userId,
      itemId: attemptItems.id,
      marks: attemptItems.marks,
      workingMarks: attemptItems.workingMarks,
      response: answers.response,
      working: answers.working,
      autoScore: answers.autoScore,
      workingScore: answers.workingScore,
      grader: users.name,
    })
    .from(answers)
    .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
    .innerJoin(attempts, eq(attempts.id, answers.attemptId))
    .leftJoin(users, eq(users.id, answers.gradedBy))
    .where(and(eq(attempts.examId, examId), eq(attempts.isSandbox, false), eq(attempts.status, 'submitted'), eq(attemptItems.questionId, questionId), isNull(attemptItems.voidReason)))
    .orderBy(asc(attempts.startedAt));
}

type Answer = Awaited<ReturnType<typeof answersTo>>[number];

/** A working part that lost marks: the natural subject of a grading dispute. */
const workingShort = (a: Answer | undefined) => !!a && Number(a.workingMarks) > 0 && a.workingScore !== null && Number(a.workingScore) < Number(a.workingMarks);
const optionOf = (a: Answer) => (a.response as { optionId?: string } | null)?.optionId ?? null;
const valueOf = (a: Answer) => {
  const v = (a.response as { value?: unknown } | null)?.value;
  return v === undefined || v === null || v === '' ? null : String(v);
};
const workingOf = (a: Answer) => (a.working as { text?: string } | null)?.text ?? '';
const answerRight = (a: Answer) => a.autoScore !== null && Number(a.autoScore) >= Number(a.marks);

/** The candidate's first working part that lost marks, preferring the named question. */
async function workingDispute(examId: string, structure: ExamQuestionInfo[], userId: string, prefer: RegExp) {
  const ordered = [...structure.filter((q) => prefer.test(q.title)), ...structure.filter((q) => !prefer.test(q.title))].filter((q) => q.workingMarks > 0);
  for (const q of ordered) {
    const mine = (await answersTo(examId, q.questionId)).find((a) => a.userId === userId);
    if (workingShort(mine)) return { question: q, answer: mine!, preferred: prefer.test(q.title) };
  }
  return null;
}

export async function seedDisputes(ctx: DisputeSeedContext): Promise<void> {
  const { exam } = ctx;
  const [d] = await db.select({ n: count() }).from(disputes).where(eq(disputes.examId, exam.id));
  const [r] = await db.select({ n: count() }).from(remedies).where(eq(remedies.examId, exam.id));
  if ((d?.n ?? 0) > 0 || (r?.n ?? 0) > 0) {
    console.log('Dispute demo already present on this exam; skipped.');
    return;
  }

  const c = createContainer();
  const disputesSvc = new DisputesService(c);
  const remediesSvc = new RemediesService(c);
  const omar = await sessionFor(ctx.omar, exam.organizationId);
  const asCandidate = async (userId: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    return sessionFor(u!, exam.organizationId);
  };
  const structure = await loadExamStructure(db, exam.id);
  const demoCandidates = [ctx.ali.id, ctx.ayesha.id];

  // 1. Newton's second law: the projected copy misprinted the force, so the answer it led to also counts.
  const newton = structure.find((q) => q.type === 'single_choice' && /newton/i.test(q.title));
  if (newton) {
    const options = ((newton.content.options ?? []) as { id: string; text: string }[]).filter(Boolean);
    const misprint = options.find((o) => o.text.startsWith('12'));
    const holders = misprint ? (await answersTo(exam.id, newton.questionId)).filter((a) => optionOf(a) === misprint.id && Number(a.autoScore) === 0) : [];
    if (misprint && holders.length) {
      const reporter = holders.find((h) => !demoCandidates.includes(h.userId)) ?? holders[0]!;
      const reporterSession = await asCandidate(reporter.userId);
      const raised = await disputesSvc.raise(reporterSession, {
        attemptId: reporter.attemptId,
        attemptItemId: reporter.itemId,
        category: 'ambiguous_question',
        description:
          'The projector in our hall showed the force as 24 N, not 10 N. With 24 N on a 2 kg mass the acceleration is 12 m/s², which is what I answered. Students who read the printed paper saw 10 N.',
      });
      const out = await remediesSvc.apply(omar, exam.id, {
        questionId: newton.questionId,
        type: 'accept_alternatives',
        payload: { optionIds: [misprint.id] },
        reason: `The projected copy showed the force as 24 N instead of 10 N. For candidates who worked from it, ${misprint.text} is the right answer, so both answers now earn the marks.`,
        disputeId: raised.dispute.id,
        dryRun: false,
      });
      console.log(`  ${newton.label} also accepts ${misprint.text}: ${out.gains.count} candidates gained; ${reporterSession.user.email} raised the dispute it answers.`);
    } else {
      console.warn(`  Skipped the ${newton.label} remedy: nobody chose the misprinted answer in this activity data.`);
    }
  } else {
    console.warn("  Skipped the remedy: the exam has no single-choice Newton's second law question.");
  }

  // 2. Ayesha: her working was marked down; upheld with a re-mark and a reason she can read.
  const ayeshaCase = await workingDispute(exam.id, structure, ctx.ayesha.id, /derivative/i);
  if (ayeshaCase) {
    const { question, answer } = ayeshaCase;
    const max = Number(answer.workingMarks);
    const value = valueOf(answer);
    // The derivative case reads from her actual paper: the derivative written, the right final answer.
    const specific = ayeshaCase.preferred && /6x\s*\+\s*2/.test(workingOf(answer)) && answerRight(answer) && value !== null;
    const raised = await disputesSvc.raise(await sessionFor(ctx.ayesha, exam.organizationId), {
      attemptId: answer.attemptId,
      attemptItemId: answer.itemId,
      category: 'grading_error',
      description: specific
        ? `I wrote the derivative, f′(x) = 6x + 2, and my final answer of ${value} is correct. Substituting the point is the only step between the two, so the right answer shows I did it. I think the second method mark should count.`
        : `My working sets out the method and my final answer is correct, but only ${answer.workingScore} of the ${max} working marks was given. I think a step was missed when it was marked.`,
    });
    await disputesSvc.resolve(omar, raised.dispute.id, {
      outcome: 'upheld',
      note: specific
        ? `Your working gives the derivative, and your correct answer of ${value} shows the substitution was done. The rubric gives this mark for substituting correctly, not for writing a separate line, so your working now has ${max} of ${max}.`
        : `Your working sets out the method and your correct answer shows the remaining step was done. The rubric gives this mark for doing the step correctly, so your working on ${question.title} now has full marks.`,
      regrade: { part: 'working', score: max },
    });
    console.log(`  Ayesha: dispute on ${question.label} upheld with a re-mark.`);
  } else {
    console.warn('  Skipped Ayesha’s upheld dispute: none of her working parts lost marks in this activity data.');
  }

  // 3. Ali: his working was marked down; assigned to Omar and under review, to decide live.
  const aliCase = await workingDispute(exam.id, structure, ctx.ali.id, /free-fall/i);
  if (aliCase) {
    const { question, answer } = aliCase;
    const max = Number(answer.workingMarks);
    // The free-fall case reads from his actual paper: the formula and substitution written, no square root.
    const aliValue = valueOf(answer);
    const aliSpecific = aliCase.preferred && /2gh/.test(workingOf(answer)) && aliValue !== null;
    const raised = await disputesSvc.raise(await sessionFor(ctx.ali, exam.organizationId), {
      attemptId: answer.attemptId,
      attemptItemId: answer.itemId,
      category: 'grading_error',
      description: aliSpecific
        ? `My working sets up v² = u² + 2gh with u = 0 and substitutes the numbers correctly to get ${aliValue}. I wrote ${aliValue} instead of taking the square root, which is one slip at the very end. The method is all there, so I think the working deserves both marks, not one.`
        : `My working shows each step of the method, but it was given ${answer.workingScore} of ${max}. I think the working deserves full marks.`,
    });
    const id = raised.dispute.id;
    await disputesSvc.assign(omar, id, { assigneeId: ctx.omar.id });
    await disputesSvc.setStatus(omar, id, { status: 'under_review' });
    await disputesSvc.addMessage(omar, id, { body: 'Thanks, Ali. I am checking your working against the rubric and will reply here with a written decision.' });
    await disputesSvc.addMessage(omar, id, {
      body: `Working was marked ${answer.workingScore} of ${max}${answer.grader ? ` by ${answer.grader}` : ''}. Checking each rubric line against what is written before deciding.`,
      internal: true,
    });
    console.log(`  Ali: dispute on ${question.label} under review, assigned to Omar.`);
  } else {
    console.warn('  Skipped Ali’s open dispute: none of his working parts lost marks in this activity data.');
  }

  // 4. An appeal in progress: "not upheld" on the momentum statement, appealed by the candidate.
  const momentum = structure.find((q) => q.type === 'true_false' && /momentum/i.test(q.title));
  if (momentum) {
    const [wrong] = (await answersTo(exam.id, momentum.questionId)).filter((a) => Number(a.autoScore) === 0 && !demoCandidates.includes(a.userId));
    if (wrong) {
      const candidate = await asCandidate(wrong.userId);
      const raised = await disputesSvc.raise(candidate, {
        attemptId: wrong.attemptId,
        attemptItemId: wrong.itemId,
        category: 'ambiguous_question',
        description:
          'The statement says kinetic energy “is not conserved”, but after a perfectly inelastic collision the joined objects keep moving, so some kinetic energy remains. Read that way the statement is false, which is what I answered.',
      });
      await disputesSvc.resolve(omar, raised.dispute.id, {
        outcome: 'rejected',
        note: 'In physics, “not conserved” means the total kinetic energy after the collision differs from the total before. That is always true in a perfectly inelastic collision, even though some kinetic energy remains, so the statement is true as written and the original mark stands.',
      });
      await disputesSvc.appeal(candidate, raised.dispute.id, {
        reason: 'The reply gives the textbook meaning, but the sentence never says “total”. “Kinetic energy is not conserved” can reasonably be read as “none of it remains”. I would like a different reviewer to look at the wording.',
      });
      console.log(`  Appeal waiting on ${momentum.label} from ${candidate.user.name} (${candidate.user.email}).`);
    } else {
      console.warn(`  Skipped the appeal: nobody besides Ali and Ayesha got ${momentum.label} wrong.`);
    }
  }

  const [made] = await db.select({ n: count() }).from(disputes).where(eq(disputes.examId, exam.id));
  console.log(`Dispute demo seeded: ${made?.n ?? 0} disputes on the exam.`);
}

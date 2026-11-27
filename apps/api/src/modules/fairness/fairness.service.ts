import { and, desc, eq, inArray } from 'drizzle-orm';
import { DIFFICULTY_PRIOR, examPhase, isAutoGraded, type ExamPhase } from '@athena/shared';
import type { Container } from '../../container';
import type { Executor } from '../../db/client';
import { answers, attemptItems, attempts, auditLogs, questions, users, type exams } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { estimateP, simulatePapers } from '../../domain/paper';
import { ConflictError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { loadExamPaper, toPaperInput } from '../attempts/exam-paper.repository';
import { loadExamForStaff } from '../exams/exam-access';
import { EXAMINER_ROLES, loadExamStructure, settingsOf } from '../grading/exam-structure';
import {
  ACHIEVABLE_SHARE,
  distinctPapers,
  needsRecalibration,
  observedItemP,
  observedPaperPercent,
  RECALIBRATION_MIN_N,
  RECALIBRATION_THRESHOLD,
  round,
  spreadOf,
  type GradedObservation,
  type ItemP,
  type PaperItem,
} from './fairness.math';
import { buildSimulationReport, engineCalibration, summarizeAssembly, type QuestionMeta } from './fairness.report';
import type {
  AuditItem,
  FairnessAuditReport,
  FairnessExamRef,
  FairnessSimulationReport,
  RecalibrationChange,
  RecalibrationResult,
} from './fairness.types';

type ExamRow = typeof exams.$inferSelect;

export const RECALIBRATED_ACTION = 'fairness.recalibrated';
const CLOSED_PHASES: ExamPhase[] = ['completed', 'archived'];

export interface Actor {
  auth: TenantAuthContext;
  ip?: string | null;
}

function examRef(exam: ExamRow): FairnessExamRef {
  const settings = settingsOf(exam);
  return {
    id: exam.id,
    title: exam.title,
    phase: examPhase(exam),
    balanceDifficulty: settings.fairness.balanceDifficulty,
    tolerancePercent: settings.fairness.tolerancePercent,
  };
}

/**
 * Fairness evidence for randomized papers (IC-5.2). The paper engine (domain/paper) does the assembly and the
 * Monte Carlo runs; this service loads an exam's real sections, pools and calibration, and audits finished exams
 * against their real results. Examiners (exams.manage) on the exam's staff only; admins see every exam.
 */
export class FairnessService {
  constructor(private readonly c: Container) {}

  /** Balanced vs random assembly of this exam's real paper definition, `runs` papers each. */
  async simulation(auth: TenantAuthContext, examId: string, runs: number): Promise<FairnessSimulationReport> {
    const exam = await loadExamForStaff(this.c.db, auth, examId, EXAMINER_ROLES);
    const settings = settingsOf(exam);
    const [sections, structure] = await Promise.all([loadExamPaper(this.c.db, exam.id), loadExamStructure(this.c.db, exam.id)]);
    const base = { exam: examRef(exam), generatedAt: new Date().toISOString() };
    const questionCount = sections.reduce((n, s) => n + s.questions.length, 0);
    const input = toPaperInput(sections, settings);
    const balanced = simulatePapers(input, runs, true);
    const random = simulatePapers(input, runs, false);

    if (questionCount === 0) {
      const empty = summarizeAssembly(balanced);
      return {
        ...base,
        runs,
        hasQuestions: false,
        hasPools: false,
        pools: [],
        questionsPerPaper: 0,
        totalMarks: 0,
        targetPercent: 0,
        balanced: empty,
        random: empty,
        histogram: { binWidth: 1, bins: [] },
        tolerance: {
          configuredPercent: settings.fairness.tolerancePercent,
          achievable: true,
          holdsAtPercent: 0,
          holdsForShare: ACHIEVABLE_SHARE,
          balancedShare: 1,
          randomShare: 1,
        },
        exposure: [],
        calibration: engineCalibration(),
      };
    }

    const difficultyOf = new Map(sections.flatMap((s) => s.questions.map((q) => [q.questionId, q.difficulty] as const)));
    const meta = new Map<string, QuestionMeta>(
      structure.map((q) => [
        q.questionId,
        { questionId: q.questionId, label: q.label, title: q.title, type: q.type, difficulty: difficultyOf.get(q.questionId) ?? 'medium', sectionTitle: q.sectionTitle },
      ]),
    );
    return {
      ...base,
      hasQuestions: true,
      ...buildSimulationReport({
        sections,
        sectionTitles: new Map(sections.map((s) => [s.id, s.title])),
        questions: meta,
        balanced,
        random,
      }),
    };
  }

  /** Post-exam audit: predicted vs observed paper difficulty and questions whose calibration is off. */
  async audit(auth: TenantAuthContext, examId: string): Promise<FairnessAuditReport> {
    const exam = await loadExamForStaff(this.c.db, auth, examId, EXAMINER_ROLES);
    const ref = examRef(exam);
    const structure = await loadExamStructure(this.c.db, exam.id);
    const bank = await this.bankCalibration(this.c.db, auth, structure.map((q) => q.questionId));
    const lastRecalibration = await this.lastRecalibration(auth, exam.id);

    const base: FairnessAuditReport = {
      exam: ref,
      generatedAt: new Date().toISOString(),
      state: 'ready',
      message: null,
      submittedAttempts: 0,
      gradedAnswers: 0,
      papers: { count: 0, distinct: 0, predicted: null, observed: null, points: [] },
      items: [],
      thresholds: { delta: RECALIBRATION_THRESHOLD, minN: RECALIBRATION_MIN_N },
      candidates: 0,
      lastRecalibration,
    };
    if (!CLOSED_PHASES.includes(ref.phase)) {
      return {
        ...base,
        state: 'not_completed',
        message: 'The audit compares each paper with candidates’ results, so it opens once the exam window closes.',
      };
    }

    const { observations, papers } = await this.realResults(this.c.db, exam.id);
    const pByQuestion = observedItemP(observations);
    const graded = observations.filter((o) => o.score !== null).length;
    if (papers.length === 0 || graded === 0) {
      return {
        ...base,
        state: 'no_results',
        submittedAttempts: papers.length,
        message: papers.length === 0 ? 'No candidate submitted this exam, so there is nothing to compare yet.' : 'Answers are still waiting to be graded.',
      };
    }

    const points = papers.map((p) => ({
      attemptId: p.attemptId,
      predictedPercent: p.paperExpected === null ? null : round(p.paperExpected * 100),
      observedPercent: observedPaperPercent(p.items, pByQuestion),
    }));
    const predicted = points.map((p) => p.predictedPercent).filter((v): v is number => v !== null);
    const observed = points.map((p) => p.observedPercent).filter((v): v is number => v !== null);

    const items: AuditItem[] = structure.map((q) => {
      const b = bank.get(q.questionId);
      const difficulty = b?.difficulty ?? 'medium';
      const estimate = estimateP({ difficulty, observedP: b?.observedP ?? null, observedN: b?.observedN ?? 0 });
      const obs = pByQuestion.get(q.questionId);
      const delta = obs ? round(obs.p - estimate, 4) : null;
      return {
        questionId: q.questionId,
        label: q.label,
        title: q.title,
        type: q.type,
        difficulty,
        sectionTitle: q.sectionTitle,
        marks: q.marks,
        n: obs?.n ?? 0,
        observedP: obs?.p ?? null,
        labelPrior: DIFFICULTY_PRIOR[difficulty],
        estimateP: round(estimate, 4),
        bank: { observedP: b?.observedP ?? null, observedN: b?.observedN ?? 0 },
        delta,
        recalibrate: !!obs && needsRecalibration(obs.p, estimate, obs.n),
      };
    });

    return {
      ...base,
      submittedAttempts: papers.length,
      gradedAnswers: graded,
      papers: {
        count: papers.length,
        distinct: distinctPapers(papers.map((p) => p.items)),
        predicted: predicted.length ? spreadOf(predicted) : null,
        observed: observed.length ? spreadOf(observed) : null,
        points,
      },
      items,
      candidates: items.filter((i) => i.recalibrate).length,
    };
  }

  /**
   * Writes this exam's observed difficulty back to the bank: observedP / observedN are overwritten with the
   * exam's real results (plain replacement, so running it twice changes nothing), in one transaction with an
   * audit entry. Only after the window closes: recalibrating mid-exam would change how later papers balance.
   */
  async recalibrate(actor: Actor, examId: string): Promise<RecalibrationResult> {
    const { auth } = actor;
    const exam = await loadExamForStaff(this.c.db, auth, examId, EXAMINER_ROLES);
    if (!CLOSED_PHASES.includes(examPhase(exam))) {
      throw new ConflictError('Recalibrate once the exam window has closed. Changing difficulty estimates mid-exam would change how later papers are balanced.');
    }
    const { observations } = await this.realResults(this.c.db, exam.id);
    const pByQuestion = observedItemP(observations);
    if (pByQuestion.size === 0) throw new ConflictError('There are no graded results to learn from yet.');

    const at = new Date();
    const changes = await this.c.db.transaction(async (tx) => {
      const current = await tx
        .select({ id: questions.id, title: questions.title, observedP: questions.observedP, observedN: questions.observedN })
        .from(questions)
        .where(and(eq(questions.organizationId, auth.organization.id), inArray(questions.id, [...pByQuestion.keys()])));
      const out: RecalibrationChange[] = [];
      for (const q of current) {
        const next: ItemP = pByQuestion.get(q.id)!;
        await tx.update(questions).set({ observedP: next.p, observedN: next.n }).where(eq(questions.id, q.id));
        out.push({ questionId: q.id, title: q.title, previousP: q.observedP, previousN: q.observedN, p: next.p, n: next.n });
      }
      await this.c.audit.record(
        {
          organizationId: auth.organization.id,
          actorId: auth.user.id,
          action: RECALIBRATED_ACTION,
          entityType: 'exam',
          entityId: exam.id,
          summary: `Recalibrated ${out.length} question${out.length === 1 ? '' : 's'} from the results of ${exam.title}`,
          metadata: { questions: out.map(({ title: _t, ...c }) => c) },
          ip: actor.ip ?? null,
        },
        tx,
      );
      return out;
    });
    return { examId: exam.id, updated: changes.length, changes, at: at.toISOString() };
  }

  // ---------------------------------------------------------------------------------------------------------

  /**
   * Real, submitted attempts with their papers and graded answer parts. Answer part = auto score for objective
   * types (unanswered = 0) or the grader's score for written ones (null while ungraded); method marks excluded.
   */
  private async realResults(db: Executor, examId: string) {
    const submitted = await db
      .select({ id: attempts.id, paperExpected: attempts.paperExpected })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted')));
    if (submitted.length === 0) return { observations: [] as GradedObservation[], papers: [] };

    const rows = await db
      .select({
        attemptId: attemptItems.attemptId,
        questionId: attemptItems.questionId,
        type: attemptItems.type,
        marks: attemptItems.marks,
        voidReason: attemptItems.voidReason,
        autoScore: answers.autoScore,
        manualScore: answers.manualScore,
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .leftJoin(answers, eq(answers.attemptItemId, attemptItems.id))
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted')));

    const observations: GradedObservation[] = [];
    const itemsByAttempt = new Map<string, PaperItem[]>();
    for (const r of rows) {
      if (r.voidReason !== null) continue;
      const score = isAutoGraded(r.type) ? (r.autoScore ?? 0) : (r.manualScore ?? null);
      observations.push({ attemptId: r.attemptId, questionId: r.questionId, marks: r.marks, score });
      const list = itemsByAttempt.get(r.attemptId) ?? [];
      list.push({ questionId: r.questionId, marks: r.marks });
      itemsByAttempt.set(r.attemptId, list);
    }
    const papers = submitted.map((a) => ({ attemptId: a.id, paperExpected: a.paperExpected, items: itemsByAttempt.get(a.id) ?? [] }));
    return { observations, papers };
  }

  private async bankCalibration(db: Executor, auth: TenantAuthContext, ids: string[]) {
    if (ids.length === 0) return new Map<string, { difficulty: 'easy' | 'medium' | 'hard'; observedP: number | null; observedN: number }>();
    const rows = await db
      .select({ id: questions.id, difficulty: questions.difficulty, observedP: questions.observedP, observedN: questions.observedN })
      .from(questions)
      .where(and(eq(questions.organizationId, auth.organization.id), inArray(questions.id, ids)));
    return new Map(rows.map((r) => [r.id, { difficulty: r.difficulty, observedP: r.observedP, observedN: r.observedN }]));
  }

  private async lastRecalibration(auth: TenantAuthContext, examId: string): Promise<FairnessAuditReport['lastRecalibration']> {
    const [row] = await this.c.db
      .select({ at: auditLogs.createdAt, by: users.name, metadata: auditLogs.metadata })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(
        and(
          eq(auditLogs.organizationId, auth.organization.id),
          eq(auditLogs.action, RECALIBRATED_ACTION),
          eq(auditLogs.entityType, 'exam'),
          eq(auditLogs.entityId, examId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    if (!row) return null;
    const list = Array.isArray(row.metadata?.questions) ? (row.metadata.questions as unknown[]) : [];
    return { at: row.at.toISOString(), by: row.by ?? null, questions: list.length };
  }
}

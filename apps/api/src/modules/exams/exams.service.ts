import { and, asc, count, desc, eq, gt, ilike, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DEFAULT_EXAM_SETTINGS, examPhase, type ExamPhase, type ExamStaffRole, type Paginated } from '@athena/shared';
import type { Database } from '../../db/client';
import { attempts, examQuestions, exams, examSections, examStaff, examEnrollments, rubricItems } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { AppError, ConflictError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { stableStringify } from '../questions/question-draft';
import { likePattern } from '../questions/questions.service';
import { loadExamForStaff } from './exam-access';
import { EDITOR_ROLES } from './exam-roles';
import { computePaper, reviewErrorFields, reviewExam } from './exam-review';
import { LOCKED_FIELDS, LOCKED_SETTINGS, mergeSettings } from './exam-settings-merge';
import { assertStillPublishable, loadSnapshot, lockExam, realAttemptCount, reviewInput, startedMessage, type ExamRow } from './exam-snapshot';
import type { ExamStaffService } from './exam-staff.service';
import { timingIssues, type createExamSchema, type listExamsSchema, type updateExamSchema } from './exams.schemas';

type CreateInput = z.infer<typeof createExamSchema>;
type UpdateInput = z.infer<typeof updateExamSchema>;
type ListQuery = z.infer<typeof listExamsSchema>;


export type NextActionKey = 'add_questions' | 'fix_issues' | 'review_publish' | 'enroll' | 'preview' | 'monitor' | 'grade' | 'publish_results' | 'analytics';
export interface NextAction {
  key: NextActionKey;
  label: string;
}

const PHASE_SQL = (now: Date) =>
  sql<ExamPhase>`case when ${exams.status} = 'draft' then 'draft' when ${exams.status} = 'archived' then 'archived' when ${exams.windowOpensAt} > ${now} then 'scheduled' when ${exams.windowClosesAt} > ${now} then 'ongoing' else 'completed' end`;

function phaseWhere(phase: ExamPhase, now: Date): SQL {
  switch (phase) {
    case 'draft':
      return eq(exams.status, 'draft');
    case 'archived':
      return eq(exams.status, 'archived');
    case 'scheduled':
      return and(eq(exams.status, 'published'), gt(exams.windowOpensAt, now))!;
    case 'ongoing':
      return and(eq(exams.status, 'published'), lte(exams.windowOpensAt, now), gt(exams.windowClosesAt, now))!;
    case 'completed':
      return and(eq(exams.status, 'published'), lte(exams.windowClosesAt, now))!;
  }
}

/** The one thing worth doing next for an exam, derived from its phase and counts (the UI maps keys to links). */
export function nextActionFor(e: {
  phase: ExamPhase;
  questionCount: number;
  computedTotal: number;
  totalMarks: number;
  enrolled: number;
  pendingGrading: number;
  resultsStatus: 'unpublished' | 'published';
}): NextAction | null {
  switch (e.phase) {
    case 'draft':
      if (e.questionCount === 0) return { key: 'add_questions', label: 'Add questions' };
      if (e.computedTotal !== e.totalMarks) return { key: 'fix_issues', label: 'Fix the marks total' };
      return { key: 'review_publish', label: 'Review & publish' };
    case 'scheduled':
      return e.enrolled === 0 ? { key: 'enroll', label: 'Enroll candidates' } : { key: 'preview', label: 'Preview as candidate' };
    case 'ongoing':
      return { key: 'monitor', label: 'Monitor live' };
    case 'completed':
      if (e.pendingGrading > 0) return { key: 'grade', label: `Grade ${e.pendingGrading} script${e.pendingGrading === 1 ? '' : 's'}` };
      if (e.resultsStatus === 'unpublished') return { key: 'publish_results', label: 'Publish results' };
      return { key: 'analytics', label: 'View analytics' };
    case 'archived':
      return null;
  }
}

/**
 * Exam lifecycle: create, configure, review, publish, unpublish, archive and duplicate. Every read and write
 * goes through loadExamForStaff, so tenants and non-staff examiners only ever see "not found".
 */
export class ExamService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly staff: ExamStaffService,
  ) {}

  async list(auth: TenantAuthContext, query: ListQuery): Promise<Paginated<ExamListItem> & { phaseCounts: Record<ExamPhase | 'all', number> }> {
    const orgId = auth.organization.id;
    const now = new Date();
    const scope: (SQL | undefined)[] = [eq(exams.organizationId, orgId)];
    if (!auth.permissions.has('exams.view_all')) {
      scope.push(sql`exists (select 1 from ${examStaff} where ${examStaff.examId} = ${exams.id} and ${examStaff.userId} = ${auth.user.id})`);
    }
    if (query.q) {
      const p = likePattern(query.q);
      scope.push(or(ilike(exams.title, p), ilike(exams.code, p)));
    }
    const phase = PHASE_SQL(now);
    const countsRows = await this.db
      .select({ phase, n: count() })
      .from(exams)
      .where(and(...scope))
      // Grouped by position: the phase expression carries parameters, so repeating it would not match.
      .groupBy(sql`1`);
    const phaseCounts = { all: 0, draft: 0, scheduled: 0, ongoing: 0, completed: 0, archived: 0 } as Record<ExamPhase | 'all', number>;
    for (const r of countsRows) {
      phaseCounts[r.phase] = Number(r.n);
      phaseCounts.all += Number(r.n);
    }
    // Archived exams are hidden unless asked for.
    const where = and(...scope, query.phase ? phaseWhere(query.phase, now) : ne(exams.status, 'archived'));
    const rank = sql`case ${phase} when 'ongoing' then 0 when 'scheduled' then 1 when 'draft' then 2 when 'completed' then 3 else 4 end`;
    const rows = await this.db
      .select({
        exam: exams,
        myRole: sql<ExamStaffRole | null>`(select ${examStaff.role} from ${examStaff} where ${examStaff.examId} = ${exams.id} and ${examStaff.userId} = ${auth.user.id})`,
      })
      .from(exams)
      .where(where)
      .orderBy(asc(rank), sql`case when ${phase} = 'scheduled' then ${exams.windowOpensAt} end asc`, desc(exams.windowOpensAt), desc(exams.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [totalRow] = await this.db.select({ n: count() }).from(exams).where(where);

    const ids = rows.map((r) => r.exam.id);
    const stats = await this.listStats(ids);
    const items = rows.map(({ exam, myRole }) => {
      const s = stats.get(exam.id)!;
      const p = examPhase(exam, now);
      return {
        id: exam.id,
        title: exam.title,
        code: exam.code,
        description: exam.description,
        status: exam.status,
        phase: p,
        resultsStatus: exam.resultsStatus,
        windowOpensAt: exam.windowOpensAt,
        windowClosesAt: exam.windowClosesAt,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        computedTotal: s.computedTotal,
        publishedAt: exam.publishedAt,
        updatedAt: exam.updatedAt,
        myRole,
        counts: { questions: s.questions, sections: s.sections, enrolled: s.enrolled, inProgress: s.inProgress, submitted: s.submitted, pendingGrading: s.pendingGrading },
        nextAction: nextActionFor({ phase: p, questionCount: s.questions, computedTotal: s.computedTotal, totalMarks: exam.totalMarks, enrolled: s.enrolled, pendingGrading: s.pendingGrading, resultsStatus: exam.resultsStatus }),
      };
    });
    return { items, total: Number(totalRow?.n ?? 0), page: query.page, pageSize: query.pageSize, phaseCounts };
  }

  /** Counts for a page of exams in a handful of grouped queries (no N+1). */
  private async listStats(ids: string[]) {
    const out = new Map<string, { questions: number; sections: number; enrolled: number; inProgress: number; submitted: number; pendingGrading: number; computedTotal: number }>();
    for (const id of ids) out.set(id, { questions: 0, sections: 0, enrolled: 0, inProgress: 0, submitted: 0, pendingGrading: 0, computedTotal: 0 });
    if (ids.length === 0) return out;
    const sections = await this.db.select({ id: examSections.id, examId: examSections.examId, title: examSections.title, position: examSections.position, drawCount: examSections.drawCount }).from(examSections).where(inArray(examSections.examId, ids));
    const items = await this.db.select({ examId: examQuestions.examId, sectionId: examQuestions.sectionId, marks: examQuestions.marks }).from(examQuestions).where(inArray(examQuestions.examId, ids));
    const enrolled = await this.db
      .select({ examId: examEnrollments.examId, n: count() })
      .from(examEnrollments)
      .where(and(inArray(examEnrollments.examId, ids), eq(examEnrollments.status, 'enrolled')))
      .groupBy(examEnrollments.examId);
    const att = await this.db
      .select({
        examId: attempts.examId,
        inProgress: sql<number>`count(*) filter (where ${attempts.status} = 'in_progress')`.mapWith(Number),
        submitted: sql<number>`count(*) filter (where ${attempts.status} = 'submitted')`.mapWith(Number),
        pendingGrading: sql<number>`count(*) filter (where ${attempts.status} = 'submitted' and ${attempts.gradingStatus} <> 'complete')`.mapWith(Number),
      })
      .from(attempts)
      .where(and(inArray(attempts.examId, ids), realAttempts))
      .groupBy(attempts.examId);
    for (const id of ids) {
      const s = out.get(id)!;
      const secs = sections.filter((x) => x.examId === id);
      const its = items.filter((x) => x.examId === id);
      s.sections = secs.length;
      s.questions = its.length;
      s.computedTotal = computePaper(secs, its.map((i) => ({ ...i, workingMarks: 0 }))).computedTotal;
    }
    for (const r of enrolled) out.get(r.examId)!.enrolled = Number(r.n);
    for (const r of att) Object.assign(out.get(r.examId)!, { inProgress: r.inProgress, submitted: r.submitted, pendingGrading: r.pendingGrading });
    return out;
  }

  async get(auth: TenantAuthContext, examId: string) {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const snap = await loadSnapshot(this.db, exam);
    const review = reviewExam(reviewInput(snap));
    const staff = await this.staff.list(examId);
    const myRole = staff.find((s) => s.userId === auth.user.id)?.role ?? null;
    const isEditor = auth.permissions.has('exams.view_all') || (myRole !== null && EDITOR_ROLES.includes(myRole));
    const [pending] = await this.db
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.examId, examId), realAttempts, eq(attempts.status, 'submitted'), ne(attempts.gradingStatus, 'complete')));
    const phase = examPhase(exam);
    const locked = snap.attempts.total > 0;
    const paperBySection = new Map(review.paper.sections.map((s) => [s.id, s]));

    return {
      id: exam.id,
      title: exam.title,
      code: exam.code,
      description: exam.description,
      instructions: exam.instructions,
      status: exam.status,
      phase,
      resultsStatus: exam.resultsStatus,
      windowOpensAt: exam.windowOpensAt,
      windowClosesAt: exam.windowClosesAt,
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      settings: exam.settings,
      publishedAt: exam.publishedAt,
      archivedAt: exam.archivedAt,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      myRole,
      can: {
        edit: isEditor && auth.permissions.has('exams.manage') && exam.status !== 'archived',
        publish: isEditor && auth.permissions.has('exams.publish'),
        manageCandidates: isEditor && auth.permissions.has('candidates.manage') && exam.status !== 'archived',
        manageStaff: isEditor && auth.permissions.has('exams.manage') && exam.status !== 'archived',
        duplicate: auth.permissions.has('exams.create'),
        archive: isEditor && auth.permissions.has('exams.manage') && exam.status !== 'archived',
      },
      sections: snap.sections.map((s) => ({
        id: s.id,
        title: s.title,
        instructions: s.instructions,
        position: s.position,
        drawCount: s.drawCount,
        paper: paperBySection.get(s.id) ?? null,
        questions: snap.items
          .filter((i) => i.sectionId === s.id)
          .map((i) => ({
            id: i.id,
            questionId: i.questionId,
            questionVersionId: i.questionVersionId,
            title: i.title,
            type: i.type,
            difficulty: i.difficulty,
            marks: i.marks,
            workingMarks: i.workingMarks,
            position: i.position,
            pinnedVersion: i.pinnedVersion,
            latestVersion: i.latestVersion,
            bankStatus: i.bankStatus,
            leaked: i.leaked,
            observedP: i.observedP,
            stem: i.stem,
            rubricCount: i.rubric.answer + i.rubric.working,
            rubric: i.rubric,
          })),
      })),
      staff,
      counts: {
        questions: snap.items.length,
        sections: snap.sections.length,
        enrolled: snap.enrolledCount,
        attempts: snap.attempts,
        pendingGrading: Number(pending?.n ?? 0),
      },
      review,
      locks: {
        locked,
        realAttempts: snap.attempts.total,
        reason: locked ? startedMessage(snap.attempts.total) : exam.status === 'archived' ? 'Archived exams are read-only.' : null,
        fields: locked ? [...LOCKED_FIELDS, ...LOCKED_SETTINGS.map((k) => `settings.${k}`)] : [],
        /** After the first attempt the window may only be extended. */
        windowClosesAt: locked ? 'extend_only' : 'free',
      },
      nextAction: nextActionFor({
        phase,
        questionCount: snap.items.length,
        computedTotal: review.paper.computedTotal,
        totalMarks: exam.totalMarks,
        enrolled: snap.enrolledCount,
        pendingGrading: Number(pending?.n ?? 0),
        resultsStatus: exam.resultsStatus,
      }),
    };
  }

  async review(auth: TenantAuthContext, examId: string) {
    const exam = await loadExamForStaff(this.db, auth, examId);
    return reviewExam(reviewInput(await loadSnapshot(this.db, exam)));
  }

  async create(auth: TenantAuthContext, input: CreateInput) {
    const orgId = auth.organization.id;
    const timing = timingIssues(input);
    if (Object.keys(timing).length) throw new ValidationError(Object.values(timing)[0], timing);
    const settings = mergeSettings(DEFAULT_EXAM_SETTINGS, input.settings);
    const id = await this.db.transaction(async (tx) => {
      const [exam] = await tx
        .insert(exams)
        .values({
          organizationId: orgId,
          title: input.title,
          code: input.code ?? null,
          description: input.description ?? null,
          instructions: input.instructions ?? '',
          status: 'draft',
          windowOpensAt: input.windowOpensAt,
          windowClosesAt: input.windowClosesAt,
          durationMinutes: input.durationMinutes,
          totalMarks: input.totalMarks,
          settings,
          createdBy: auth.user.id,
        })
        .returning({ id: exams.id });
      await tx.insert(examStaff).values({ examId: exam!.id, userId: auth.user.id, role: 'owner' });
      // A first section, so questions can be added straight away.
      await tx.insert(examSections).values({ examId: exam!.id, title: 'Section A', position: 0 });
      await this.audit.record({ organizationId: orgId, actorId: auth.user.id, action: 'exam.created', entityType: 'exam', entityId: exam!.id, summary: `Created exam "${input.title}"` }, tx);
      return exam!.id;
    });
    return this.get(auth, id);
  }

  async update(auth: TenantAuthContext, examId: string, patch: UpdateInput) {
    await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    await this.db.transaction(async (tx) => {
      const exam = await lockExam(tx, examId);
      if (exam.status === 'archived') throw new ConflictError('Archived exams are read-only. Duplicate it to reuse it.', 'EXAM_ARCHIVED');
      const next = {
        title: patch.title ?? exam.title,
        code: patch.code === undefined ? exam.code : patch.code,
        description: patch.description === undefined ? exam.description : patch.description,
        instructions: patch.instructions ?? exam.instructions,
        windowOpensAt: patch.windowOpensAt ?? exam.windowOpensAt,
        windowClosesAt: patch.windowClosesAt ?? exam.windowClosesAt,
        durationMinutes: patch.durationMinutes ?? exam.durationMinutes,
        totalMarks: patch.totalMarks ?? exam.totalMarks,
        settings: patch.settings ? mergeSettings(exam.settings, patch.settings) : exam.settings,
      };
      const timing = timingIssues(next);
      if (Object.keys(timing).length) throw new ValidationError(Object.values(timing)[0], timing);

      const differs = (a: unknown, b: unknown) => stableStringify(a) !== stableStringify(b);
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => differs(exam[k], next[k]));
      if (changed.length === 0) return;

      const started = await realAttemptCount(tx, examId);
      if (started > 0) {
        const blocked: Record<string, string> = {};
        const lock = 'Locked because candidates have started';
        if (differs(exam.windowOpensAt, next.windowOpensAt)) blocked.windowOpensAt = lock;
        if (differs(exam.durationMinutes, next.durationMinutes)) blocked.durationMinutes = lock;
        if (differs(exam.totalMarks, next.totalMarks)) blocked.totalMarks = lock;
        if (next.windowClosesAt.getTime() < exam.windowClosesAt.getTime()) blocked.windowClosesAt = 'The window can only be extended once candidates have started';
        for (const k of LOCKED_SETTINGS) if (differs(exam.settings[k], next.settings[k])) blocked[`settings.${k}`] = lock;
        if (Object.keys(blocked).length) throw new AppError(409, 'EXAM_LOCKED', startedMessage(started), blocked);
      }

      await tx.update(exams).set(next).where(eq(exams.id, examId));
      const structural = changed.some((k) => ['windowOpensAt', 'windowClosesAt', 'durationMinutes', 'totalMarks'].includes(k));
      if (exam.status === 'published' && structural) await assertStillPublishable(tx, examId);
      await this.audit.record(
        { organizationId: exam.organizationId, actorId: auth.user.id, action: 'exam.updated', entityType: 'exam', entityId: examId, summary: `Updated ${changed.join(', ')} of "${next.title}"`, metadata: { changed } },
        tx,
      );
    });
    return this.get(auth, examId);
  }

  async publish(auth: TenantAuthContext, examId: string) {
    await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    await this.db.transaction(async (tx) => {
      const exam = await lockExam(tx, examId);
      if (exam.status === 'published') throw new ConflictError('This exam is already published.');
      if (exam.status === 'archived') throw new ConflictError('Archived exams cannot be published. Duplicate it instead.', 'EXAM_ARCHIVED');
      const review = reviewExam(reviewInput(await loadSnapshot(tx, exam)));
      if (!review.canPublish) {
        const n = review.errors.length;
        throw new AppError(422, 'EXAM_NOT_READY', `This exam can't be published yet: ${n} issue${n === 1 ? '' : 's'} to fix. ${review.errors[0]!.message}`, reviewErrorFields(review));
      }
      await tx.update(exams).set({ status: 'published', publishedAt: new Date(), publishedBy: auth.user.id }).where(eq(exams.id, examId));
      await this.audit.record(
        {
          organizationId: exam.organizationId,
          actorId: auth.user.id,
          action: 'exam.published',
          entityType: 'exam',
          entityId: examId,
          summary: `Published "${exam.title}"`,
          metadata: { warnings: review.warnings.map((w) => w.code), totalMarks: exam.totalMarks, questions: review.paper.questionCount },
        },
        tx,
      );
    });
    return this.get(auth, examId);
  }

  async unpublish(auth: TenantAuthContext, examId: string) {
    await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    await this.db.transaction(async (tx) => {
      const exam = await lockExam(tx, examId);
      if (exam.status !== 'published') throw new ConflictError('Only published exams can be unpublished.');
      const started = await realAttemptCount(tx, examId);
      if (started > 0) {
        throw new AppError(409, 'EXAM_LOCKED', `${started} candidate${started === 1 ? ' has' : 's have'} already started, so this exam can't return to draft. Extend the window or archive it after it closes.`);
      }
      await tx.update(exams).set({ status: 'draft', publishedAt: null, publishedBy: null }).where(eq(exams.id, examId));
      await this.audit.record({ organizationId: exam.organizationId, actorId: auth.user.id, action: 'exam.unpublished', entityType: 'exam', entityId: examId, summary: `Unpublished "${exam.title}"` }, tx);
    });
    return this.get(auth, examId);
  }

  async archive(auth: TenantAuthContext, examId: string) {
    await loadExamForStaff(this.db, auth, examId, EDITOR_ROLES);
    await this.db.transaction(async (tx) => {
      const exam = await lockExam(tx, examId);
      if (exam.status === 'archived') throw new ConflictError('This exam is already archived.');
      const [active] = await tx
        .select({ n: count() })
        .from(attempts)
        .where(and(eq(attempts.examId, examId), realAttempts, inArray(attempts.status, ['in_progress', 'awaiting_sync'])));
      const n = Number(active?.n ?? 0);
      if (n > 0) throw new ConflictError(`${n} candidate${n === 1 ? ' is' : 's are'} still writing or syncing. Archive the exam after they finish.`, 'EXAM_ACTIVE');
      await tx.update(exams).set({ status: 'archived', archivedAt: new Date() }).where(eq(exams.id, examId));
      await this.audit.record({ organizationId: exam.organizationId, actorId: auth.user.id, action: 'exam.archived', entityType: 'exam', entityId: examId, summary: `Archived "${exam.title}"` }, tx);
    });
    return this.get(auth, examId);
  }

  /**
   * Copies sections, pinned questions, marks, rubrics and settings into a new draft owned by the caller.
   * Candidates and staff are not copied. A window in the past moves to the same time next week.
   */
  async duplicate(auth: TenantAuthContext, examId: string) {
    const source = await loadExamForStaff(this.db, auth, examId);
    const newId = await this.db.transaction(async (tx) => {
      const { opens, closes } = shiftedWindow(source);
      const [copy] = await tx
        .insert(exams)
        .values({
          organizationId: source.organizationId,
          title: `${source.title.slice(0, 190)} (copy)`,
          code: source.code,
          description: source.description,
          instructions: source.instructions,
          status: 'draft',
          windowOpensAt: opens,
          windowClosesAt: closes,
          durationMinutes: source.durationMinutes,
          totalMarks: source.totalMarks,
          settings: source.settings,
          createdBy: auth.user.id,
        })
        .returning({ id: exams.id });
      const id = copy!.id;
      await tx.insert(examStaff).values({ examId: id, userId: auth.user.id, role: 'owner' });
      const sections = await tx.select().from(examSections).where(eq(examSections.examId, examId));
      const sectionMap = new Map<string, string>();
      for (const s of sections) {
        const [ns] = await tx.insert(examSections).values({ examId: id, title: s.title, instructions: s.instructions, position: s.position, drawCount: s.drawCount }).returning({ id: examSections.id });
        sectionMap.set(s.id, ns!.id);
      }
      const items = await tx.select().from(examQuestions).where(eq(examQuestions.examId, examId));
      if (items.length) {
        await tx.insert(examQuestions).values(
          items.map((i) => ({ examId: id, sectionId: sectionMap.get(i.sectionId)!, questionId: i.questionId, questionVersionId: i.questionVersionId, marks: i.marks, position: i.position, marking: i.marking })),
        );
      }
      const rubric = await tx.select().from(rubricItems).where(eq(rubricItems.examId, examId));
      if (rubric.length) {
        await tx.insert(rubricItems).values(rubric.map((r) => ({ examId: id, questionId: r.questionId, target: r.target, label: r.label, description: r.description, points: r.points, position: r.position })));
      }
      await this.audit.record(
        { organizationId: source.organizationId, actorId: auth.user.id, action: 'exam.duplicated', entityType: 'exam', entityId: id, summary: `Duplicated "${source.title}"`, metadata: { sourceId: examId } },
        tx,
      );
      return id;
    });
    return this.get(auth, newId);
  }
}

function shiftedWindow(exam: ExamRow) {
  const now = Date.now();
  const opens = exam.windowOpensAt.getTime();
  const length = exam.windowClosesAt.getTime() - opens;
  if (opens > now) return { opens: exam.windowOpensAt, closes: exam.windowClosesAt };
  const week = 7 * 24 * 3600_000;
  const weeks = Math.max(1, Math.ceil((now - opens) / week));
  return { opens: new Date(opens + weeks * week), closes: new Date(opens + weeks * week + length) };
}

export interface ExamListItem {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  phase: ExamPhase;
  resultsStatus: 'unpublished' | 'published';
  windowOpensAt: Date;
  windowClosesAt: Date;
  durationMinutes: number;
  totalMarks: number;
  computedTotal: number;
  publishedAt: Date | null;
  updatedAt: Date;
  myRole: ExamStaffRole | null;
  counts: { questions: number; sections: number; enrolled: number; inProgress: number; submitted: number; pendingGrading: number };
  nextAction: NextAction | null;
}

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { examPhase, type Paginated, type QuestionType } from '@athena/shared';
import type { Database } from '../../db/client';
import { examQuestions, exams, examStaff, questionCategories, questions, questionVersions, users } from '../../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import type { CategoryService } from './categories.service';
import { previewQuestion, stableStringify, validateQuestionDraft } from './question-draft';
import type { createQuestionSchema, ListQuestionsQuery, previewSchema, updateQuestionSchema } from './questions.schemas';

type CreateInput = z.infer<typeof createQuestionSchema>;
type UpdateInput = z.infer<typeof updateQuestionSchema>;
type PreviewInput = z.infer<typeof previewSchema>;

/** Escapes LIKE wildcards so a search for "50%" means the literal text. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const currentVersion = alias(questionVersions, 'cv');

/** Number of distinct exams that use a question (any status). */
const usageCount = sql<number>`(select count(distinct ${examQuestions.examId}) from ${examQuestions} where ${examQuestions.questionId} = ${questions.id})`.mapWith(Number);

const difficultyRank = sql`case ${questions.difficulty} when 'easy' then 0 when 'medium' then 1 else 2 end`;

/**
 * The question bank. Content and answer keys live in immutable versions: editing creates a new version and
 * exams keep the version they pinned, so a live or graded exam never changes underneath its candidates.
 */
export class QuestionService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly categories: CategoryService,
  ) {}

  async list(auth: TenantAuthContext, query: ListQuestionsQuery): Promise<Paginated<QuestionListItem>> {
    const orgId = auth.organization.id;
    const conds: (SQL | undefined)[] = [eq(questions.organizationId, orgId)];
    if (query.status !== 'all') conds.push(eq(questions.status, query.status));
    if (query.type) conds.push(eq(questions.type, query.type));
    if (query.difficulty) conds.push(eq(questions.difficulty, query.difficulty));
    if (query.categoryId === 'none') conds.push(isNull(questions.categoryId));
    else if (query.categoryId) conds.push(eq(questions.categoryId, query.categoryId));
    if (query.excludeExamId) {
      conds.push(sql`not exists (select 1 from ${examQuestions} where ${examQuestions.questionId} = ${questions.id} and ${examQuestions.examId} = ${query.excludeExamId})`);
    }
    if (query.tag) conds.push(sql`exists (select 1 from unnest(${questions.tags}) as t(tag) where lower(t.tag) = ${query.tag.toLowerCase()})`);
    if (query.q) {
      const pattern = likePattern(query.q);
      conds.push(
        or(
          ilike(questions.title, pattern),
          sql`${currentVersion.content}->>'stem' ilike ${pattern}`,
          sql`exists (select 1 from unnest(${questions.tags}) as t(tag) where t.tag ilike ${pattern})`,
        ),
      );
    }
    const where = and(...conds);
    const order =
      query.sort === 'title'
        ? [asc(questions.title), asc(questions.id)]
        : query.sort === 'usage'
          ? [desc(usageCount), desc(questions.updatedAt), desc(questions.id)]
          : query.sort === 'difficulty'
            ? [asc(difficultyRank), asc(questions.title), asc(questions.id)]
            : [desc(questions.updatedAt), desc(questions.id)];

    const rows = await this.db
      .select({
        id: questions.id,
        title: questions.title,
        type: questions.type,
        difficulty: questions.difficulty,
        status: questions.status,
        tags: questions.tags,
        defaultMarks: questions.defaultMarks,
        currentVersion: questions.currentVersion,
        observedP: questions.observedP,
        observedN: questions.observedN,
        exposureCount: questions.exposureCount,
        leakedAt: questions.leakedAt,
        createdAt: questions.createdAt,
        updatedAt: questions.updatedAt,
        categoryId: questionCategories.id,
        categoryName: questionCategories.name,
        categoryColor: questionCategories.color,
        stem: sql<string>`left(${currentVersion.content}->>'stem', 240)`,
        hasWorking: sql<boolean>`coalesce((${currentVersion.content}->'working'->>'enabled')::boolean, false)`,
        usageCount,
      })
      .from(questions)
      .leftJoin(questionCategories, eq(questionCategories.id, questions.categoryId))
      .leftJoin(currentVersion, and(eq(currentVersion.questionId, questions.id), eq(currentVersion.version, questions.currentVersion)))
      .where(where)
      .orderBy(...order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totalRow] = await this.db
      .select({ n: count() })
      .from(questions)
      .leftJoin(currentVersion, and(eq(currentVersion.questionId, questions.id), eq(currentVersion.version, questions.currentVersion)))
      .where(where);

    return {
      items: rows.map(({ categoryId, categoryName, categoryColor, ...r }) => ({
        ...r,
        category: categoryId ? { id: categoryId, name: categoryName!, color: categoryColor } : null,
      })),
      total: totalRow?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Every tag in the bank with how many active questions carry it (for filters and autocomplete). */
  async tags(orgId: string) {
    const rows = await this.db.execute<{ tag: string; n: number }>(sql`
      select t.tag, count(*)::int as n
      from ${questions}, unnest(${questions.tags}) as t(tag)
      where ${questions.organizationId} = ${orgId} and ${questions.status} = 'active'
      group by t.tag order by n desc, t.tag asc limit 200`);
    return rows.rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
  }

  async get(auth: TenantAuthContext, id: string) {
    const orgId = auth.organization.id;
    const creator = alias(users, 'creator');
    const [row] = await this.db
      .select({
        question: questions,
        category: { id: questionCategories.id, name: questionCategories.name, color: questionCategories.color },
        createdByName: creator.name,
      })
      .from(questions)
      .leftJoin(questionCategories, eq(questionCategories.id, questions.categoryId))
      .leftJoin(creator, eq(creator.id, questions.createdBy))
      .where(and(eq(questions.id, id), eq(questions.organizationId, orgId)))
      .limit(1);
    if (!row) throw new NotFoundError('Question');
    const q = row.question;
    const [version] = await this.db
      .select()
      .from(questionVersions)
      .where(and(eq(questionVersions.questionId, id), eq(questionVersions.version, q.currentVersion)))
      .limit(1);
    if (!version) throw new NotFoundError('Question version');

    const usage = await this.db
      .select({
        examId: exams.id,
        title: exams.title,
        code: exams.code,
        status: exams.status,
        windowOpensAt: exams.windowOpensAt,
        windowClosesAt: exams.windowClosesAt,
        pinnedVersion: questionVersions.version,
        marks: examQuestions.marks,
      })
      .from(examQuestions)
      .innerJoin(exams, eq(exams.id, examQuestions.examId))
      .innerJoin(questionVersions, eq(questionVersions.id, examQuestions.questionVersionId))
      .where(and(eq(examQuestions.questionId, id), eq(exams.organizationId, orgId)))
      .orderBy(desc(exams.windowOpensAt));
    // Exam titles are only listed when the caller may see that exam; the rest are counted.
    const visible = await this.visibleExamIds(auth, usage.map((u) => u.examId));

    return {
      id: q.id,
      type: q.type,
      title: q.title,
      difficulty: q.difficulty,
      status: q.status,
      tags: q.tags,
      defaultMarks: q.defaultMarks,
      currentVersion: q.currentVersion,
      observedP: q.observedP,
      observedN: q.observedN,
      exposureCount: q.exposureCount,
      leakedAt: q.leakedAt,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      createdBy: q.createdBy ? { id: q.createdBy, name: row.createdByName } : null,
      category: row.category?.id ? row.category : null,
      versionId: version.id,
      versionCreatedAt: version.createdAt,
      content: version.content,
      key: version.answerKey,
      usage: {
        total: usage.length,
        hidden: usage.filter((u) => !visible.has(u.examId)).length,
        exams: usage
          .filter((u) => visible.has(u.examId))
          .map(({ windowOpensAt, windowClosesAt, ...u }) => ({ ...u, phase: examPhase({ status: u.status, windowOpensAt, windowClosesAt }), windowOpensAt })),
      },
    };
  }

  async create(auth: TenantAuthContext, input: CreateInput) {
    const orgId = auth.organization.id;
    const draft = validateQuestionDraft(input.type, input.content, input.key);
    await this.assertCategory(orgId, input.categoryId);
    const id = await this.db.transaction(async (tx) => {
      const [q] = await tx
        .insert(questions)
        .values({
          organizationId: orgId,
          categoryId: input.categoryId,
          type: input.type,
          difficulty: input.difficulty,
          title: input.title,
          tags: input.tags,
          defaultMarks: input.defaultMarks,
          currentVersion: 1,
          createdBy: auth.user.id,
          updatedBy: auth.user.id,
        })
        .returning({ id: questions.id });
      await tx.insert(questionVersions).values({ questionId: q!.id, version: 1, content: draft.content, answerKey: draft.key, createdBy: auth.user.id });
      await this.audit.record(
        { organizationId: orgId, actorId: auth.user.id, action: 'question.created', entityType: 'question', entityId: q!.id, summary: `Created question "${input.title}"`, metadata: { type: input.type } },
        tx,
      );
      return q!.id;
    });
    return this.get(auth, id);
  }

  /**
   * Saves an edit. Changed content or key creates version N+1 (immutable); metadata-only edits update the
   * question in place. The row lock serialises concurrent saves so version numbers never collide.
   */
  async update(auth: TenantAuthContext, id: string, input: UpdateInput) {
    const orgId = auth.organization.id;
    await this.assertCategory(orgId, input.categoryId);
    const result = await this.db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.organizationId, orgId)))
        .for('update');
      if (!q) throw new NotFoundError('Question');
      if (q.status === 'archived') throw new ConflictError('This question is archived. Restore it before editing.');
      if (input.type && input.type !== q.type) {
        throw new ValidationError("A question's type can't change", { type: "A question's type can't change. Duplicate it and edit the copy instead." });
      }
      if (input.baseVersion && input.baseVersion !== q.currentVersion) {
        throw new ConflictError(`Someone saved a newer version (v${q.currentVersion}) while you were editing. Reload to see it before saving again.`, 'VERSION_CONFLICT');
      }
      const draft = validateQuestionDraft(q.type, input.content, input.key);
      const [current] = await tx
        .select()
        .from(questionVersions)
        .where(and(eq(questionVersions.questionId, id), eq(questionVersions.version, q.currentVersion)))
        .limit(1);
      const changed = !current || stableStringify(current.content) !== stableStringify(draft.content) || stableStringify(current.answerKey) !== stableStringify(draft.key);
      const version = changed ? q.currentVersion + 1 : q.currentVersion;
      if (changed) {
        await tx.insert(questionVersions).values({ questionId: id, version, content: draft.content, answerKey: draft.key, createdBy: auth.user.id });
      }
      await tx
        .update(questions)
        .set({
          title: input.title,
          difficulty: input.difficulty,
          categoryId: input.categoryId,
          tags: input.tags,
          defaultMarks: input.defaultMarks,
          currentVersion: version,
          updatedBy: auth.user.id,
        })
        .where(eq(questions.id, id));
      await this.audit.record(
        {
          organizationId: orgId,
          actorId: auth.user.id,
          action: 'question.updated',
          entityType: 'question',
          entityId: id,
          summary: changed ? `Saved version ${version} of "${input.title}"` : `Updated details of "${input.title}"`,
          metadata: { version, versionCreated: changed },
        },
        tx,
      );
      return { versionCreated: changed, version };
    });
    return { ...(await this.get(auth, id)), ...result };
  }

  /** Archive or restore. Exams that already use a question keep their pinned version either way. */
  async setStatus(auth: TenantAuthContext, ids: string[], status: 'active' | 'archived') {
    const orgId = auth.organization.id;
    const rows = await this.db
      .update(questions)
      .set({ status, updatedBy: auth.user.id })
      .where(and(eq(questions.organizationId, orgId), inArray(questions.id, ids)))
      .returning({ id: questions.id, title: questions.title });
    if (rows.length === 0) throw new NotFoundError('Question');
    const verb = status === 'archived' ? 'Archived' : 'Restored';
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.user.id,
      action: status === 'archived' ? 'question.archived' : 'question.restored',
      entityType: 'question',
      entityId: rows.length === 1 ? rows[0]!.id : undefined,
      summary: rows.length === 1 ? `${verb} "${rows[0]!.title}"` : `${verb} ${rows.length} questions`,
      metadata: { ids: rows.map((r) => r.id) },
    });
    return { updated: rows.length, ids: rows.map((r) => r.id) };
  }

  async duplicate(auth: TenantAuthContext, id: string) {
    const orgId = auth.organization.id;
    const newId = await this.db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(questions)
        .where(and(eq(questions.id, id), eq(questions.organizationId, orgId)))
        .limit(1);
      if (!q) throw new NotFoundError('Question');
      const [v] = await tx
        .select()
        .from(questionVersions)
        .where(and(eq(questionVersions.questionId, id), eq(questionVersions.version, q.currentVersion)))
        .limit(1);
      const title = `${q.title.slice(0, 190)} (copy)`;
      const [copy] = await tx
        .insert(questions)
        .values({
          organizationId: orgId,
          categoryId: q.categoryId,
          type: q.type,
          difficulty: q.difficulty,
          title,
          tags: q.tags,
          defaultMarks: q.defaultMarks,
          createdBy: auth.user.id,
          updatedBy: auth.user.id,
        })
        .returning({ id: questions.id });
      await tx.insert(questionVersions).values({ questionId: copy!.id, version: 1, content: v!.content, answerKey: v!.answerKey, createdBy: auth.user.id });
      await this.audit.record(
        { organizationId: orgId, actorId: auth.user.id, action: 'question.duplicated', entityType: 'question', entityId: copy!.id, summary: `Duplicated "${q.title}"`, metadata: { sourceId: id } },
        tx,
      );
      return copy!.id;
    });
    return this.get(auth, newId);
  }

  async versions(auth: TenantAuthContext, id: string) {
    const orgId = auth.organization.id;
    const [q] = await this.db
      .select({ id: questions.id, currentVersion: questions.currentVersion })
      .from(questions)
      .where(and(eq(questions.id, id), eq(questions.organizationId, orgId)))
      .limit(1);
    if (!q) throw new NotFoundError('Question');
    const pinnedBy = sql<number>`(select count(*) from ${examQuestions} where ${examQuestions.questionVersionId} = ${questionVersions.id})`.mapWith(Number);
    const rows = await this.db
      .select({
        id: questionVersions.id,
        version: questionVersions.version,
        content: questionVersions.content,
        key: questionVersions.answerKey,
        createdAt: questionVersions.createdAt,
        createdById: questionVersions.createdBy,
        createdByName: users.name,
        pinnedBy,
      })
      .from(questionVersions)
      .leftJoin(users, eq(users.id, questionVersions.createdBy))
      .where(eq(questionVersions.questionId, id))
      .orderBy(desc(questionVersions.version));
    return {
      currentVersion: q.currentVersion,
      items: rows.map(({ createdById, createdByName, ...r }) => ({
        ...r,
        isCurrent: r.version === q.currentVersion,
        createdBy: createdById ? { id: createdById, name: createdByName } : null,
      })),
    };
  }

  preview(input: PreviewInput) {
    return previewQuestion(input.type as QuestionType, input.content, input.key, { seed: input.seed, shuffleOptions: input.shuffleOptions });
  }

  private async assertCategory(orgId: string, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const [c] = await this.db
      .select({ id: questionCategories.id })
      .from(questionCategories)
      .where(and(eq(questionCategories.id, categoryId), eq(questionCategories.organizationId, orgId)))
      .limit(1);
    if (!c) throw new ValidationError('Unknown category', { categoryId: 'This category no longer exists' });
  }

  private async visibleExamIds(auth: TenantAuthContext, examIds: string[]): Promise<Set<string>> {
    if (examIds.length === 0) return new Set();
    if (auth.permissions.has('exams.view_all')) return new Set(examIds);
    const rows = await this.db
      .select({ examId: examStaff.examId })
      .from(examStaff)
      .where(and(eq(examStaff.userId, auth.user.id), inArray(examStaff.examId, examIds)));
    return new Set(rows.map((r) => r.examId));
  }
}

export interface QuestionListItem {
  id: string;
  title: string;
  type: QuestionType;
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'active' | 'archived';
  tags: string[];
  defaultMarks: number;
  currentVersion: number;
  observedP: number | null;
  observedN: number;
  exposureCount: number;
  leakedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string; color: string | null } | null;
  stem: string;
  hasWorking: boolean;
  usageCount: number;
}

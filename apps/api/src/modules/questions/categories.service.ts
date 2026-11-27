import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database, Executor } from '../../db/client';
import { questionCategories, questions } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from './db-errors';
import type { categoryInputSchema } from './questions.schemas';

type CategoryInput = z.infer<typeof categoryInputSchema>;

/** Question categories: an organization-wide taxonomy with names unique per tenant (case-insensitive). */
export class CategoryService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string) {
    const counts = this.db
      .select({ categoryId: questions.categoryId, n: count().as('n') })
      .from(questions)
      .where(and(eq(questions.organizationId, orgId), eq(questions.status, 'active')))
      .groupBy(questions.categoryId)
      .as('counts');
    return this.db
      .select({
        id: questionCategories.id,
        name: questionCategories.name,
        description: questionCategories.description,
        color: questionCategories.color,
        questionCount: sql<number>`coalesce(${counts.n}, 0)`.mapWith(Number),
        createdAt: questionCategories.createdAt,
      })
      .from(questionCategories)
      .leftJoin(counts, eq(counts.categoryId, questionCategories.id))
      .where(eq(questionCategories.organizationId, orgId))
      .orderBy(asc(questionCategories.name));
  }

  async create(auth: TenantAuthContext, input: CategoryInput) {
    const orgId = auth.organization.id;
    await this.assertNameFree(this.db, orgId, input.name);
    const [row] = await this.db
      .insert(questionCategories)
      .values({ organizationId: orgId, name: input.name, description: input.description ?? null, color: input.color ?? null })
      .returning()
      .catch((err: unknown) => {
        // Two people creating the same category at once: the unique index decides.
        if (isUniqueViolation(err)) throw new ValidationError('A category with this name already exists', { name: 'A category with this name already exists' });
        throw err;
      });
    await this.audit.record({ organizationId: orgId, actorId: auth.user.id, action: 'question_category.created', entityType: 'question_category', entityId: row!.id, summary: `Created category "${row!.name}"` });
    return { ...row!, questionCount: 0 };
  }

  async update(auth: TenantAuthContext, id: string, input: Partial<CategoryInput>) {
    const orgId = auth.organization.id;
    const existing = await this.get(orgId, id);
    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(this.db, orgId, input.name, id);
    }
    const [row] = await this.db
      .update(questionCategories)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        color: input.color === undefined ? existing.color : input.color,
      })
      .where(and(eq(questionCategories.id, id), eq(questionCategories.organizationId, orgId)))
      .returning();
    await this.audit.record({ organizationId: orgId, actorId: auth.user.id, action: 'question_category.updated', entityType: 'question_category', entityId: id, summary: `Updated category "${row!.name}"` });
    return row!;
  }

  /** Questions in a deleted category become uncategorized (FK on delete set null); nothing else changes. */
  async remove(auth: TenantAuthContext, id: string) {
    const orgId = auth.organization.id;
    const existing = await this.get(orgId, id);
    const [{ n }] = (await this.db
      .select({ n: count() })
      .from(questions)
      .where(and(eq(questions.organizationId, orgId), eq(questions.categoryId, id)))) as [{ n: number }];
    await this.db.delete(questionCategories).where(and(eq(questionCategories.id, id), eq(questionCategories.organizationId, orgId)));
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.user.id,
      action: 'question_category.deleted',
      entityType: 'question_category',
      entityId: id,
      summary: `Deleted category "${existing.name}" (${n} question${n === 1 ? '' : 's'} uncategorized)`,
    });
    return { uncategorized: n };
  }

  async get(orgId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(questionCategories)
      .where(and(eq(questionCategories.id, id), eq(questionCategories.organizationId, orgId)))
      .limit(1);
    if (!row) throw new NotFoundError('Category');
    return row;
  }

  /** Resolves category names to ids, creating the missing ones (used by import inside its transaction). */
  async ensureByName(tx: Executor, orgId: string, names: string[]): Promise<Map<string, string>> {
    const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
    const map = new Map<string, string>();
    if (wanted.size === 0) return map;
    const existing = await tx.select({ id: questionCategories.id, name: questionCategories.name }).from(questionCategories).where(eq(questionCategories.organizationId, orgId));
    for (const c of existing) map.set(c.name.toLowerCase(), c.id);
    const missing = [...wanted].filter(([lower]) => !map.has(lower)).map(([, name]) => name);
    if (missing.length) {
      const created = await tx
        .insert(questionCategories)
        .values(missing.map((name) => ({ organizationId: orgId, name })))
        .returning({ id: questionCategories.id, name: questionCategories.name });
      for (const c of created) map.set(c.name.toLowerCase(), c.id);
    }
    return map;
  }

  private async assertNameFree(tx: Executor, orgId: string, name: string, exceptId?: string) {
    const [clash] = await tx
      .select({ id: questionCategories.id })
      .from(questionCategories)
      .where(
        and(
          eq(questionCategories.organizationId, orgId),
          sql`lower(${questionCategories.name}) = ${name.toLowerCase()}`,
          exceptId ? ne(questionCategories.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (clash) throw new ValidationError('A category with this name already exists', { name: 'A category with this name already exists' });
  }
}

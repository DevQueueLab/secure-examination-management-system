import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import { importJobs, questionCategories, questions, questionVersions } from '../../db/schema';
import { ValidationError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import type { CategoryService } from './categories.service';
import { validateQuestionDraft } from './question-draft';
import { csvFieldFor, csvRowToDraft, jsonItemToDraft, MAX_IMPORT_ROWS, parseCsv, type ImportDraft, type RowError } from './question-import';
import { questionMetaSchema, type ImportRequest } from './questions.schemas';

interface ValidRow {
  draft: ImportDraft;
  content: Record<string, unknown>;
  key: Record<string, unknown>;
  tags: string[];
}

const normalized = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Bulk question import. A dry run parses and validates every row with the editor's own rules and reports
 * row-level errors; a commit inserts the valid rows (and any new categories) in one transaction and records
 * an import job. Exact duplicates of bank questions are rejected, so re-running an import is harmless.
 */
export class QuestionImportService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly categories: CategoryService,
  ) {}

  async run(auth: TenantAuthContext, req: ImportRequest) {
    const orgId = auth.organization.id;
    const { drafts, errors, total } = this.parseFile(req);
    const asCsv = req.format === 'csv';
    const fieldFor = (path: string) => (asCsv ? csvFieldFor(path) : path);

    // Validate each draft exactly as the editor would.
    const valid: ValidRow[] = [];
    const seen = new Map<string, number>();
    for (const draft of drafts) {
      const rowErrors: RowError[] = [];
      const attempt = <T>(fn: () => T): T | undefined => {
        try {
          return fn();
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e;
          for (const [path, message] of Object.entries(e.fields ?? { _: e.message })) rowErrors.push({ row: draft.row, field: fieldFor(path), message });
          return undefined;
        }
      };
      const meta = attempt(() => parse(questionMetaSchema, { title: draft.title, difficulty: draft.difficulty, tags: draft.tags, defaultMarks: draft.marks, categoryId: null }));
      if (draft.category && draft.category.length > 80) rowErrors.push({ row: draft.row, field: 'category', message: 'Category names are at most 80 characters' });
      const shaped = attempt(() => validateQuestionDraft(draft.type, draft.content, draft.key));
      const dupKey = `${draft.type}|${normalized(draft.title)}|${normalized(String(draft.content.stem ?? ''))}|${normalized(String(draft.content.template ?? ''))}`;
      const firstRow = seen.get(dupKey);
      if (firstRow !== undefined) rowErrors.push({ row: draft.row, field: 'title', message: `Duplicate of row ${firstRow}` });
      else seen.set(dupKey, draft.row);
      if (rowErrors.length || !shaped || !meta) {
        errors.push(...rowErrors);
        continue;
      }
      valid.push({ draft, content: shaped.content, key: shaped.key, tags: meta.tags });
    }

    // Exact duplicates of questions already in the bank (same type, title and question text).
    const existing = await this.existingSignatures(orgId, valid.map((v) => v.draft.title));
    const fresh: ValidRow[] = [];
    for (const v of valid) {
      const sig = `${v.draft.type}|${normalized(v.draft.title)}|${normalized(String(v.content.stem ?? ''))}|${normalized(String(v.content.template ?? ''))}`;
      if (existing.has(sig)) errors.push({ row: v.draft.row, field: 'title', message: 'This question is already in the bank' });
      else fresh.push(v);
    }

    const categoryRows = await this.db.select({ name: questionCategories.name }).from(questionCategories).where(eq(questionCategories.organizationId, orgId));
    const known = new Set(categoryRows.map((c) => c.name.toLowerCase()));
    const newCategories = [...new Map(fresh.filter((v) => v.draft.category && !known.has(v.draft.category.toLowerCase())).map((v) => [v.draft.category!.toLowerCase(), v.draft.category!])).values()];

    errors.sort((a, b) => a.row - b.row);
    const summary = {
      format: req.format,
      total,
      valid: fresh.length,
      invalid: new Set(errors.map((e) => e.row)).size,
      errors,
      newCategories,
      preview: fresh.map((v) => ({
        row: v.draft.row,
        type: v.draft.type,
        title: v.draft.title,
        category: v.draft.category,
        categoryIsNew: !!v.draft.category && !known.has(v.draft.category.toLowerCase()),
        difficulty: v.draft.difficulty,
        marks: v.draft.marks,
        tags: v.tags,
        stem: String(v.content.template ?? v.content.stem ?? '').slice(0, 240),
      })),
    };
    if (req.dryRun) return { ...summary, dryRun: true as const, imported: 0, jobId: null };

    if (fresh.length === 0) throw new ValidationError('Nothing to import: every row has errors', { data: 'Fix the errors and try again' });

    const jobId = await this.db.transaction(async (tx) => {
      const categoryIds = await this.categories.ensureByName(tx, orgId, fresh.map((v) => v.draft.category).filter((c): c is string => !!c));
      const rows = fresh.map((v) => ({ id: randomUUID(), v }));
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await tx.insert(questions).values(
          chunk.map(({ id, v }) => ({
            id,
            organizationId: orgId,
            categoryId: v.draft.category ? (categoryIds.get(v.draft.category.toLowerCase()) ?? null) : null,
            type: v.draft.type,
            difficulty: v.draft.difficulty,
            title: v.draft.title,
            tags: v.tags,
            defaultMarks: v.draft.marks,
            currentVersion: 1,
            createdBy: auth.user.id,
            updatedBy: auth.user.id,
          })),
        );
        await tx.insert(questionVersions).values(chunk.map(({ id, v }) => ({ questionId: id, version: 1, content: v.content, answerKey: v.key, createdBy: auth.user.id })));
      }
      const [job] = await tx
        .insert(importJobs)
        .values({
          organizationId: orgId,
          kind: 'questions',
          filename: req.filename ?? null,
          totalRows: total,
          importedRows: fresh.length,
          errorRows: summary.invalid,
          errors: errors.slice(0, 500),
          createdBy: auth.user.id,
        })
        .returning({ id: importJobs.id });
      await this.audit.record(
        {
          organizationId: orgId,
          actorId: auth.user.id,
          action: 'question.imported',
          entityType: 'import_job',
          entityId: job!.id,
          summary: `Imported ${fresh.length} of ${total} questions${req.filename ? ` from ${req.filename}` : ''}`,
          metadata: { format: req.format, total, imported: fresh.length, errorRows: summary.invalid, newCategories },
        },
        tx,
      );
      return job!.id;
    });
    return { ...summary, dryRun: false as const, imported: fresh.length, jobId };
  }

  private parseFile(req: ImportRequest): { drafts: ImportDraft[]; errors: RowError[]; total: number } {
    const drafts: ImportDraft[] = [];
    const errors: RowError[] = [];
    if (req.format === 'csv') {
      const parsed = parseCsv(req.data);
      if (parsed.missingColumns.length) {
        throw new ValidationError(`The CSV is missing the column${parsed.missingColumns.length === 1 ? '' : 's'}: ${parsed.missingColumns.join(', ')}`, {
          data: `Missing columns: ${parsed.missingColumns.join(', ')}. Download the template to see the expected header.`,
        });
      }
      this.assertSize(parsed.rows.length);
      const broken = new Set(parsed.errors.map((e) => e.row));
      errors.push(...parsed.errors);
      parsed.rows.forEach((raw, i) => {
        const line = i + 2;
        if (broken.has(line)) return;
        const r = csvRowToDraft(raw, line);
        errors.push(...r.errors);
        if (r.draft) drafts.push(r.draft);
      });
      return { drafts, errors, total: parsed.rows.length };
    }
    let data: unknown;
    try {
      data = JSON.parse(req.data);
    } catch (e) {
      throw new ValidationError('The file is not valid JSON', { data: `Not valid JSON: ${(e as Error).message}` });
    }
    const items = Array.isArray(data) ? data : Array.isArray((data as { questions?: unknown })?.questions) ? (data as { questions: unknown[] }).questions : null;
    if (!items) throw new ValidationError('The JSON must be an array of questions', { data: 'Expected an array of questions, or { "questions": [...] }' });
    this.assertSize(items.length);
    items.forEach((item, i) => {
      const r = jsonItemToDraft(item, i + 1);
      errors.push(...r.errors);
      if (r.draft) drafts.push(r.draft);
    });
    return { drafts, errors, total: items.length };
  }

  private assertSize(n: number) {
    if (n === 0) throw new ValidationError('The file has no questions', { data: 'The file has no rows' });
    if (n > MAX_IMPORT_ROWS) throw new ValidationError(`At most ${MAX_IMPORT_ROWS} questions per import`, { data: `The file has ${n} rows. Split it into files of at most ${MAX_IMPORT_ROWS}.` });
  }

  private async existingSignatures(orgId: string, titles: string[]): Promise<Set<string>> {
    const lowered = [...new Set(titles.map(normalized))];
    if (lowered.length === 0) return new Set();
    const cv = alias(questionVersions, 'cv');
    const rows = await this.db
      .select({ type: questions.type, title: questions.title, stem: sql<string>`coalesce(${cv.content}->>'stem', '')`, template: sql<string>`coalesce(${cv.content}->>'template', '')` })
      .from(questions)
      .innerJoin(cv, and(eq(cv.questionId, questions.id), eq(cv.version, questions.currentVersion)))
      .where(and(eq(questions.organizationId, orgId), eq(questions.status, 'active'), inArray(sql`lower(regexp_replace(trim(${questions.title}), '\\s+', ' ', 'g'))`, lowered)));
    return new Set(rows.map((r) => `${r.type}|${normalized(r.title)}|${normalized(r.stem)}|${normalized(r.template)}`));
  }
}

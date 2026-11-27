import { and, eq, inArray } from 'drizzle-orm';
import { examPhase } from '@athena/shared';
import type { Database } from '../../db/client';
import { attemptItems, attempts, exams, examStaff, memberships, questions, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import { matchedStems, normalizeCode, readMarks, traceVariants, type ExamTrace, type PaperItem } from '../../domain/integrity/leak';
import { sha256 } from '../../lib/crypto';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from './integrity.service';
import {
  LEAK_NOTICE,
  type CandidateRef,
  type ExamRef,
  type LeakCandidateView,
  type LeakConfidence,
  type LeakExactMatch,
  type LeakExamFinding,
  type LeakTraceResult,
} from './integrity.types';

/** Exams whose papers a stripped text is compared against: closed within this many days, or still to come. */
export const LEAK_WINDOW_DAYS = 90;

type ExamRow = Pick<typeof exams.$inferSelect, 'id' | 'title' | 'code' | 'status' | 'windowOpensAt' | 'windowClosesAt'>;

const examRef = (e: ExamRow): ExamRef => ({ id: e.id, title: e.title, code: e.code, phase: examPhase(e) });

/**
 * Traces a leaked paper back to the paper it came from (challenge 5.5). Marks and typed codes give an exact answer;
 * otherwise variant forensics narrows the papers down. Every trace is audited, and a reviewer only ever sees
 * papers from exams they can open.
 */
export class LeakService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Exams in the organization this reviewer can open: all of them with exams.view_all, otherwise their staff exams. */
  private async accessibleExams(auth: TenantAuthContext): Promise<Map<string, ExamRow & { archivedAt: Date | null }>> {
    const columns = {
      id: exams.id,
      title: exams.title,
      code: exams.code,
      status: exams.status,
      windowOpensAt: exams.windowOpensAt,
      windowClosesAt: exams.windowClosesAt,
      archivedAt: exams.archivedAt,
    };
    const rows = auth.permissions.has('exams.view_all')
      ? await this.db.select(columns).from(exams).where(eq(exams.organizationId, auth.organization.id))
      : await this.db
          .select(columns)
          .from(exams)
          .innerJoin(examStaff, and(eq(examStaff.examId, exams.id), eq(examStaff.userId, auth.user.id)))
          .where(eq(exams.organizationId, auth.organization.id));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async candidates(orgId: string, attemptIds: string[]) {
    if (attemptIds.length === 0) return new Map<string, CandidateRef & { servedAt: Date; submittedAt: Date | null }>();
    const rows = await this.db
      .select({
        attemptId: attempts.id,
        userId: attempts.userId,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
        servedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
      })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, orgId)))
      .where(and(eq(attempts.organizationId, orgId), inArray(attempts.id, attemptIds)));
    return new Map(rows.map((r) => [r.attemptId, r]));
  }

  private async paperItems(orgId: string, where: ReturnType<typeof and>): Promise<PaperItem[]> {
    return this.db
      .select({
        attemptId: attemptItems.attemptId,
        examId: attempts.examId,
        questionId: attemptItems.questionId,
        title: questions.title,
        position: attemptItems.position,
        type: attemptItems.type,
        content: attemptItems.content,
        variant: attemptItems.variant,
      })
      .from(attemptItems)
      .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
      .innerJoin(questions, eq(questions.id, attemptItems.questionId))
      .where(and(eq(attempts.organizationId, orgId), where));
  }

  async trace(actor: Actor, input: { text: string; code: string; examId?: string }): Promise<LeakTraceResult> {
    const { auth } = actor;
    const orgId = auth.organization.id;
    const raw = input.text;
    // Marks are read from the raw text, before anything is cleaned away.
    const marks = readMarks(raw);
    const typedCode = input.code.trim() ? normalizeCode(input.code) : null;
    if (input.code.trim() && !typedCode) {
      throw new ValidationError('That doesn’t look like a watermark code', {
        code: 'A code is 4 to 12 letters and digits, like 7F3K9Q. Spaces and dashes are fine.',
      });
    }

    const accessible = await this.accessibleExams(auth);
    const now = Date.now();
    // Scoped to one exam (opened from that exam's integrity review): compare with its papers only, whatever its age.
    const scope = input.examId ? accessible.get(input.examId) : undefined;
    if (input.examId && !scope) throw new NotFoundError('Exam');
    const searchable = scope
      ? [scope]
      : [...accessible.values()].filter(
          (e) => e.status !== 'draft' && !e.archivedAt && e.windowClosesAt.getTime() >= now - LEAK_WINDOW_DAYS * 86_400_000,
        );

    // (a) Exact: marks and typed codes, matched within this organization only. Previews count: staff papers leak too.
    const codes = [...new Set([...marks.codes, ...(typedCode ? [typedCode] : [])])];
    const coded = codes.length
      ? await this.db
          .select({ attemptId: attempts.id, examId: attempts.examId, fingerprint: attempts.fingerprint, preview: attempts.isSandbox })
          .from(attempts)
          .where(and(eq(attempts.organizationId, orgId), inArray(attempts.fingerprint, codes)))
      : [];
    const unknownCodes = codes.filter((c) => !coded.some((r) => r.fingerprint === c));
    const visible = coded.filter((r) => accessible.has(r.examId));
    const restricted = coded.length - visible.length;

    // (c) Variant forensics over the searchable exams' real papers.
    const searchIds = searchable.map((e) => e.id);
    const items =
      raw.trim() && searchIds.length ? await this.paperItems(orgId, and(inArray(attempts.examId, searchIds), realAttempts)) : [];
    const traces = raw.trim() ? traceVariants(raw, items) : [];
    const traceByExam = new Map(traces.map((t) => [t.examId, t]));

    const exactItems = visible.length && raw.trim() ? await this.paperItems(orgId, and(inArray(attempts.id, visible.map((r) => r.attemptId)))) : [];
    const named = traces.flatMap((t) => namedPapers(t));
    const people = await this.candidates(orgId, [...new Set([...visible.map((r) => r.attemptId), ...named])]);

    const exact: LeakExactMatch[] = visible.flatMap((r) => {
      const person = people.get(r.attemptId);
      const exam = accessible.get(r.examId);
      if (!person || !exam) return [];
      const trace = traceByExam.get(r.examId);
      const via: LeakExactMatch['via'] = [];
      if (marks.codes.includes(r.fingerprint)) via.push('invisible_mark');
      if (typedCode === r.fingerprint) via.push('typed_code');
      return [
        {
          via,
          code: r.fingerprint,
          candidate: { attemptId: r.attemptId, userId: person.userId, name: person.name, email: person.email, rollNumber: person.rollNumber },
          exam: examRef(exam),
          servedAt: person.servedAt.toISOString(),
          submittedAt: person.submittedAt?.toISOString() ?? null,
          preview: r.preview,
          matchedStems: raw.trim() ? matchedStems(raw, exactItems.filter((i) => i.attemptId === r.attemptId)) : [],
          corroborated: trace && trace.observations.length > 0 && !r.preview ? trace.fitting.includes(r.attemptId) : null,
        },
      ];
    });

    const findings: LeakExamFinding[] = traces.flatMap((t) => {
      const exam = accessible.get(t.examId);
      if (!exam) return [];
      const ids = namedPapers(t);
      const candidates: LeakCandidateView[] = ids.flatMap((id) => {
        const person = people.get(id);
        if (!person) return [];
        return [
          {
            candidate: { attemptId: id, userId: person.userId, name: person.name, email: person.email, rollNumber: person.rollNumber },
            servedAt: person.servedAt.toISOString(),
            submittedAt: person.submittedAt?.toISOString() ?? null,
            fits: t.observations.filter((o) => o.fitting.includes(id)).length,
            of: t.observations.length,
          },
        ];
      });
      candidates.sort((a, b) => a.candidate.name.localeCompare(b.candidate.name));
      return [
        {
          exam: examRef(exam),
          papers: t.papers,
          questions: t.questions.map((q) => ({ questionId: q.questionId, title: q.title, coverage: q.coverage, excerpt: q.excerpt })),
          observations: t.observations.map((o) => ({
            questionId: o.questionId,
            title: o.title,
            kind: o.kind,
            detail: o.detail,
            sequence: o.sequence ?? null,
            fits: o.fitting.length,
            papers: o.papers,
          })),
          fittingCount: t.fitting.length,
          candidates,
          closest: t.fitting.length === 0 && t.closest !== null,
          confidence: t.confidence,
        },
      ];
    });

    const confidence: LeakConfidence = exact.length
      ? 'exact'
      : findings.some((f) => f.confidence === 'strong')
        ? 'strong'
        : findings.some((f) => f.confidence === 'weak')
          ? 'weak'
          : 'none';
    const headline = headlineFor(confidence, exact, findings, marks.status, restricted, { chars: raw.length, typedCode, unknownCodes });
    const papersSearched = new Set(items.map((i) => i.attemptId)).size;

    await this.audit.record({
      organizationId: orgId,
      actorId: auth.user.id,
      action: 'integrity.leak_traced',
      entityType: exact.length > 0 ? 'attempt' : findings.length > 0 ? 'exam' : undefined,
      entityId: exact[0]?.candidate.attemptId ?? findings[0]?.exam.id,
      summary: `Traced a leaked text (${raw.length} characters${typedCode ? ', with a typed code' : ''}): ${headline}`,
      metadata: {
        sha256: sha256(raw),
        chars: raw.length,
        typedCode: typedCode !== null,
        marks: marks.status,
        confidence,
        exactAttemptIds: exact.map((e) => e.candidate.attemptId),
        namedAttemptIds: findings.flatMap((f) => f.candidates.map((c) => c.candidate.attemptId)),
        examIds: findings.map((f) => f.exam.id),
        restricted,
        unknownCodes: unknownCodes.length,
        scopedExamId: scope?.id ?? null,
      },
      ip: actor.ip ?? null,
    });

    return {
      notice: LEAK_NOTICE,
      generatedAt: new Date().toISOString(),
      input: { chars: raw.length, typedCode },
      marks: { status: marks.status, found: marks.codes.length },
      confidence,
      headline,
      exact,
      restricted,
      unknownCodes,
      findings,
      searched: { exams: searchable.length, papers: papersSearched, windowDays: LEAK_WINDOW_DAYS, scope: scope ? examRef(scope) : null },
    };
  }
}

/** Papers worth naming: the few that fit every detail, or the closest few when none fits all. */
function namedPapers(t: ExamTrace): string[] {
  if (t.narrowed) return t.fitting;
  if (t.fitting.length === 0 && t.closest) return t.closest.attemptIds;
  return [];
}

function headlineFor(
  confidence: LeakConfidence,
  exact: LeakExactMatch[],
  findings: LeakExamFinding[],
  marks: 'intact' | 'damaged' | 'none',
  restricted: number,
  input: { chars: number; typedCode: string | null; unknownCodes: string[] },
): string {
  if (confidence === 'exact') {
    const first = exact[0]!;
    if (exact.length > 1) return `Marks from ${exact.length} different papers were found in this text`;
    return first.preview
      ? `This text came from a staff preview of ${first.exam.title}, opened by ${first.candidate.name}`
      : `This text came from ${first.candidate.name}’s paper for ${first.exam.title}`;
  }
  const best = findings[0];
  if (confidence === 'strong' && best) return `Only ${best.candidates[0]?.candidate.name ?? 'one'}’s paper fits every detail in this text`;
  if (confidence === 'weak' && best) {
    if (best.closest) return `No paper fits every detail. ${best.candidates.length} come closest`;
    return best.candidates.length === 1
      ? `One paper fits, but only one detail tells the papers apart`
      : `${best.candidates.length} papers fit every detail in this text equally`;
  }
  const codeOnly = input.chars === 0;
  if (restricted > 0) return codeOnly ? 'That code belongs to an exam you can’t open' : 'The marks in this text belong to an exam you can’t open';
  // A typed code that matched nothing, with no text to compare.
  if (codeOnly && input.typedCode) return `No paper in your institution has the code ${input.typedCode}`;
  if (marks === 'damaged') return 'Invisible marks were present but damaged, so they no longer say whose paper this was';
  if (best && best.observations.length > 0) return `${best.fittingCount} of ${best.papers} papers fit every detail in this text, too many to name anyone`;
  if (!best && marks === 'intact' && input.unknownCodes.length > 0) return 'The mark in this text doesn’t match any paper in your institution';
  if (best) {
    return `Recognised ${best.questions.length === 1 ? 'a question' : `${best.questions.length} questions`} from ${best.exam.title}, but every paper had the same version, so the text can’t point to one paper`;
  }
  return 'No questions from your recent exams were recognised in this text';
}

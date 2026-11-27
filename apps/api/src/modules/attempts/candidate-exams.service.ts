import { and, eq, inArray } from 'drizzle-orm';
import { examPhase, type CandidateExamCard, type ExamLobby, type ExamPhase } from '@athena/shared';
import type { Executor } from '../../db/client';
import { realAttempts } from '../../db/scopes';
import { attempts, examEnrollments, exams } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { isPastDeadline, startBlock, timeLimitMinutes, type StartBlock } from './attempt.policy';
import { settingsOf } from './attempt.service';
import { loadPaperShapes, type SectionShape } from './exam-paper.repository';

type ExamRow = typeof exams.$inferSelect;
type EnrollmentRow = typeof examEnrollments.$inferSelect;
type AttemptSummary = Pick<
  typeof attempts.$inferSelect,
  'id' | 'examId' | 'status' | 'startedAt' | 'deadlineAt' | 'submittedAt'
>;

/** Short reasons for the dashboard; the client renders the window times in the candidate's own time zone. */
const BLOCK_REASON: Record<StartBlock['kind'], string> = {
  unpublished: 'This exam is not available yet',
  archived: 'This exam has been archived',
  not_open: 'This exam has not opened yet',
  late_entry_closed: 'Late entry has closed',
  closed: 'This exam has closed',
};

const PHASE_ORDER: Record<ExamPhase, number> = {
  ongoing: 0,
  scheduled: 1,
  completed: 2,
  archived: 3,
  draft: 4,
};

/**
 * The candidate's side of the exam list: what they are enrolled in, what they can start now and why not.
 * Uses the same availability rule as AttemptService.start, so the lobby never promises what start refuses.
 * Candidate-facing totals include method marks, matching the maximum on their result.
 */
export class CandidateExamsService {
  constructor(
    private readonly db: Executor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(auth: TenantAuthContext): Promise<CandidateExamCard[]> {
    const rows = await this.enrolled(auth);
    const ids = rows.map((r) => r.exam.id);
    const [shapes, mine] = await Promise.all([
      loadPaperShapes(this.db, ids),
      this.attemptsOf(auth.user.id, ids),
    ]);
    const now = this.now();
    return rows
      .map((r) =>
        this.card(
          auth,
          r.exam,
          r.enrollment,
          shapes.get(r.exam.id) ?? [],
          mine.get(r.exam.id) ?? null,
          now,
        ),
      )
      .sort((a, b) => {
        const byPhase = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
        if (byPhase !== 0) return byPhase;
        if (a.phase === 'scheduled') return a.windowOpensAt.localeCompare(b.windowOpensAt);
        if (a.phase === 'ongoing') return a.windowClosesAt.localeCompare(b.windowClosesAt);
        return b.windowClosesAt.localeCompare(a.windowClosesAt);
      });
  }

  async lobby(auth: TenantAuthContext, examId: string): Promise<ExamLobby> {
    const [row] = await this.enrolled(auth, examId);
    if (!row) throw new NotFoundError('Exam');
    const { exam, enrollment } = row;
    const [shapes, mine] = await Promise.all([
      loadPaperShapes(this.db, [exam.id]),
      this.attemptsOf(auth.user.id, [exam.id]),
    ]);
    const sections = shapes.get(exam.id) ?? [];
    const now = this.now();
    const settings = settingsOf(exam);
    const accommodated =
      enrollment.timeMultiplier !== 1 ||
      enrollment.extraMinutes > 0 ||
      !!enrollment.accommodationNote;
    return {
      ...this.card(auth, exam, enrollment, sections, mine.get(exam.id) ?? null, now),
      instructions: exam.instructions,
      sections,
      requiresAccessCode: !!settings.accessCode,
      honorCode: settings.integrity.honorCode,
      integrity: {
        requireFullscreen: settings.integrity.requireFullscreen,
        detectFocusLoss: settings.integrity.detectFocusLoss,
        blockCopyPaste: settings.integrity.blockCopyPaste,
        watermark: settings.integrity.watermark,
      },
      allowCalculator: settings.allowCalculator,
      allowScratchpad: settings.allowScratchpad,
      navigation: settings.navigation,
      accommodation: accommodated
        ? {
            timeMultiplier: enrollment.timeMultiplier,
            extraMinutes: enrollment.extraMinutes,
            note: enrollment.accommodationNote,
          }
        : null,
      serverNow: now.toISOString(),
    };
  }

  private card(
    auth: TenantAuthContext,
    exam: ExamRow,
    enrollment: EnrollmentRow,
    sections: SectionShape[],
    attempt: AttemptSummary | null,
    now: Date,
  ): CandidateExamCard {
    const settings = settingsOf(exam);
    let blockedReason: string | null = null;
    if (attempt && attempt.status !== 'in_progress') blockedReason = 'You have submitted this exam';
    else if (attempt && isPastDeadline(attempt.deadlineAt, now))
      blockedReason = 'Time is up for this attempt';
    else if (!attempt) {
      const block = startBlock({ ...exam, lateEntryMinutes: settings.lateEntryMinutes }, now);
      blockedReason = block ? BLOCK_REASON[block.kind] : null;
    }
    return {
      examId: exam.id,
      title: exam.title,
      code: exam.code,
      organizationName: auth.organization.name,
      phase: examPhase(exam, now),
      windowOpensAt: exam.windowOpensAt.toISOString(),
      windowClosesAt: exam.windowClosesAt.toISOString(),
      durationMinutes: exam.durationMinutes,
      totalMarks: Math.round(sections.reduce((t, s) => t + s.marks, 0) * 1000) / 1000,
      questionCount: sections.reduce((t, s) => t + s.questionCount, 0),
      timeLimitMinutes: timeLimitMinutes(
        exam.durationMinutes,
        enrollment.timeMultiplier,
        enrollment.extraMinutes,
      ),
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            startedAt: attempt.startedAt.toISOString(),
            deadlineAt: attempt.deadlineAt.toISOString(),
            submittedAt: attempt.submittedAt?.toISOString() ?? null,
          }
        : null,
      resultsStatus: exam.resultsStatus,
      blockedReason,
      canStart: blockedReason === null,
    };
  }

  /** Published exams of the active organization the candidate is enrolled in. */
  private enrolled(auth: TenantAuthContext, examId?: string) {
    return this.db
      .select({ exam: exams, enrollment: examEnrollments })
      .from(examEnrollments)
      .innerJoin(exams, eq(exams.id, examEnrollments.examId))
      .where(
        and(
          eq(examEnrollments.userId, auth.user.id),
          eq(examEnrollments.status, 'enrolled'),
          eq(exams.organizationId, auth.organization.id),
          eq(exams.status, 'published'),
          examId ? eq(exams.id, examId) : undefined,
        ),
      );
  }

  private async attemptsOf(
    userId: string,
    examIds: string[],
  ): Promise<Map<string, AttemptSummary>> {
    if (examIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: attempts.id,
        examId: attempts.examId,
        status: attempts.status,
        startedAt: attempts.startedAt,
        deadlineAt: attempts.deadlineAt,
        submittedAt: attempts.submittedAt,
      })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), inArray(attempts.examId, examIds), realAttempts));
    return new Map(rows.map((r) => [r.examId, r]));
  }
}

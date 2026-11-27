import { isAutoGraded, type ExamStatus, type QuestionType } from '@athena/shared';
import { timingIssues } from './exams.schemas';

/**
 * Review before publication: one pure function used by GET /review, the overview checklist, publish, and the
 * integrity guard that keeps a published exam publishable. Errors block publishing; warnings are advice.
 */

export interface ReviewSection {
  id: string;
  title: string;
  position: number;
  drawCount: number | null;
}

export interface ReviewItem {
  id: string;
  sectionId: string;
  questionId: string;
  title: string;
  type: QuestionType;
  marks: number;
  workingMarks: number;
  rubric: { answer: number; working: number };
  bankStatus: 'active' | 'archived';
  leaked: boolean;
}

export interface ReviewInput {
  exam: { status: ExamStatus; windowOpensAt: Date; windowClosesAt: Date; durationMinutes: number; totalMarks: number };
  sections: ReviewSection[];
  items: ReviewItem[];
  enrolledCount: number;
}

export interface ReviewIssue {
  code: string;
  /** Unique key, also used as the field name in a 422 response. */
  field: string;
  severity: 'error' | 'warning';
  message: string;
  sectionId?: string;
  examQuestionId?: string;
  /** A one-click fix the UI can offer. */
  fix?: { kind: 'set_total'; value: number } | { kind: 'set_pool_marks'; sectionId: string; value: number } | { kind: 'set_draw'; sectionId: string; value: number };
}

export interface ChecklistItem {
  key: 'questions' | 'marks' | 'pools' | 'schedule' | 'rubrics' | 'candidates' | 'opening';
  label: string;
  status: 'ok' | 'error' | 'warning';
  detail: string;
}

export interface PaperSection {
  id: string;
  title: string;
  isPool: boolean;
  poolSize: number;
  drawCount: number | null;
  /** Questions each candidate receives from this section. */
  delivered: number;
  /** Marks each candidate can earn from this section (answer marks only). */
  total: number;
  workingMarks: number;
}

export interface PaperSummary {
  computedTotal: number;
  declaredTotal: number;
  /** Method marks for "show your working", graded by rubric on top of answer marks. */
  workingMarks: number;
  questionCount: number;
  deliveredCount: number;
  sections: PaperSection[];
}

export interface ExamReview {
  canPublish: boolean;
  errors: ReviewIssue[];
  warnings: ReviewIssue[];
  checklist: ChecklistItem[];
  paper: PaperSummary;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isWritten = (t: QuestionType) => !isAutoGraded(t);

/**
 * What one candidate's paper is worth. A fixed section contributes every question; a pool ("draw N of M")
 * contributes N × the pool's per-question marks, which is why pool questions must carry equal marks.
 */
export function computePaper(sections: ReviewSection[], items: Pick<ReviewItem, 'sectionId' | 'marks' | 'workingMarks'>[], declaredTotal = 0): PaperSummary {
  const out: PaperSection[] = [];
  for (const s of [...sections].sort((a, b) => a.position - b.position)) {
    const list = items.filter((i) => i.sectionId === s.id);
    const isPool = s.drawCount != null;
    const delivered = isPool ? Math.min(s.drawCount!, list.length) : list.length;
    const perQuestion = list[0]?.marks ?? 0;
    const perWorking = list[0]?.workingMarks ?? 0;
    const total = isPool ? round3(delivered * perQuestion) : round3(list.reduce((a, i) => a + i.marks, 0));
    const workingMarks = isPool ? round3(delivered * perWorking) : round3(list.reduce((a, i) => a + i.workingMarks, 0));
    out.push({ id: s.id, title: s.title, isPool, poolSize: list.length, drawCount: s.drawCount, delivered, total, workingMarks });
  }
  return {
    computedTotal: round3(out.reduce((a, s) => a + s.total, 0)),
    declaredTotal,
    workingMarks: round3(out.reduce((a, s) => a + s.workingMarks, 0)),
    questionCount: items.length,
    deliveredCount: out.reduce((a, s) => a + s.delivered, 0),
    sections: out,
  };
}

export function reviewExam(input: ReviewInput, now: Date = new Date()): ExamReview {
  const { exam, sections, items } = input;
  const errors: ReviewIssue[] = [];
  const warnings: ReviewIssue[] = [];
  const paper = computePaper(sections, items, exam.totalMarks);

  // ---------- errors ----------
  if (items.length === 0) {
    errors.push({ code: 'no_questions', field: 'questions', severity: 'error', message: 'Add at least one question from the bank.' });
  }

  const timing = timingIssues(exam);
  for (const [field, message] of Object.entries(timing)) errors.push({ code: 'invalid_timing', field, severity: 'error', message });
  if (!timing.windowClosesAt && exam.windowClosesAt.getTime() <= now.getTime()) {
    errors.push({ code: 'window_closed', field: 'windowClosesAt', severity: 'error', message: 'The exam window has already closed. Move it to the future.' });
  }

  let poolProblems = 0;
  for (const s of paper.sections.filter((x) => x.isPool)) {
    const list = items.filter((i) => i.sectionId === s.id);
    if (s.drawCount! > list.length) {
      poolProblems++;
      errors.push({
        code: 'pool_too_small',
        field: `sections.${s.id}.drawCount`,
        severity: 'error',
        sectionId: s.id,
        message: `“${s.title}” draws ${s.drawCount} but its pool only has ${plural(list.length, 'question')}.`,
        ...(list.length > 0 ? { fix: { kind: 'set_draw' as const, sectionId: s.id, value: list.length } } : {}),
      });
    }
    const distinct = [...new Set(list.map((i) => i.marks))];
    const distinctWorking = [...new Set(list.map((i) => i.workingMarks))];
    if (distinct.length > 1 || distinctWorking.length > 1) {
      poolProblems++;
      // Suggest the most common value so the fewest questions change.
      const counts = new Map<number, number>();
      for (const i of list) counts.set(i.marks, (counts.get(i.marks) ?? 0) + 1);
      const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      errors.push({
        code: 'pool_unequal_marks',
        field: `sections.${s.id}.marks`,
        severity: 'error',
        sectionId: s.id,
        message:
          distinct.length > 1
            ? `Questions in the pool “${s.title}” carry different marks (${distinct.join(', ')}). Every candidate must be able to earn the same total, so give them equal marks.`
            : `Questions in the pool “${s.title}” award different method marks for working. Use questions with the same working marks in one pool.`,
        ...(distinct.length > 1 ? { fix: { kind: 'set_pool_marks' as const, sectionId: s.id, value: common } } : {}),
      });
    }
  }

  if (items.length > 0 && poolProblems === 0 && paper.computedTotal !== exam.totalMarks) {
    errors.push({
      code: 'total_mismatch',
      field: 'totalMarks',
      severity: 'error',
      message: `Each paper is worth ${paper.computedTotal} marks, but the exam declares ${exam.totalMarks}. Update the declared total or adjust question marks.`,
      fix: { kind: 'set_total', value: paper.computedTotal },
    });
  }

  // ---------- warnings ----------
  for (const s of paper.sections.filter((x) => !x.isPool && x.poolSize === 0)) {
    warnings.push({ code: 'empty_section', field: `sections.${s.id}`, severity: 'warning', sectionId: s.id, message: `Section “${s.title}” has no questions.` });
  }
  const missingRubric = items.filter((i) => (isWritten(i.type) && i.rubric.answer === 0) || (i.workingMarks > 0 && i.rubric.working === 0));
  for (const i of missingRubric) {
    const what = isWritten(i.type) && i.rubric.answer === 0 ? 'has no rubric' : 'has no rubric for its working marks';
    warnings.push({ code: 'missing_rubric', field: `questions.${i.id}.rubric`, severity: 'warning', examQuestionId: i.id, message: `“${i.title}” ${what}. Graders will have to score it freehand.` });
  }
  for (const i of items.filter((x) => x.leaked)) {
    warnings.push({ code: 'leaked_question', field: `questions.${i.id}.leaked`, severity: 'warning', examQuestionId: i.id, message: `“${i.title}” was traced in a leak. Consider replacing it.` });
  }
  for (const i of items.filter((x) => x.bankStatus === 'archived')) {
    warnings.push({ code: 'archived_question', field: `questions.${i.id}.archived`, severity: 'warning', examQuestionId: i.id, message: `“${i.title}” has been archived in the bank. The exam keeps its pinned version.` });
  }
  if (input.enrolledCount === 0) {
    warnings.push({ code: 'no_candidates', field: 'enrollments', severity: 'warning', message: 'No candidates are enrolled yet. You can enroll them after publishing too.' });
  }
  const opensInPast = exam.windowOpensAt.getTime() < now.getTime();
  if (opensInPast && exam.status === 'draft' && !errors.some((e) => e.code === 'window_closed')) {
    warnings.push({ code: 'opens_in_past', field: 'windowOpensAt', severity: 'warning', message: 'The window opens in the past, so candidates can start the moment you publish.' });
  }

  // ---------- checklist ----------
  const sectionCount = sections.length;
  const pools = paper.sections.filter((s) => s.isPool);
  const has = (code: string) => errors.some((e) => e.code === code);
  const checklist: ChecklistItem[] = [
    {
      key: 'questions',
      label: 'Questions',
      status: items.length ? 'ok' : 'error',
      detail: items.length ? `${plural(items.length, 'question')} in ${plural(sectionCount, 'section')}; each candidate answers ${paper.deliveredCount}` : 'No questions yet',
    },
    {
      key: 'marks',
      label: 'Marks add up',
      status: items.length === 0 ? 'error' : has('total_mismatch') || poolProblems > 0 ? 'error' : 'ok',
      detail:
        items.length === 0
          ? 'Add questions first'
          : has('total_mismatch')
            ? `Paper is worth ${paper.computedTotal}; declared total is ${exam.totalMarks}`
            : poolProblems > 0
              ? 'Fix the pools first'
              : `Every paper is worth ${paper.computedTotal} marks${paper.workingMarks ? ` plus ${paper.workingMarks} for working` : ''}`,
    },
    ...(pools.length
      ? [
          {
            key: 'pools' as const,
            label: 'Question pools',
            status: poolProblems ? ('error' as const) : ('ok' as const),
            detail: poolProblems ? `${plural(poolProblems, 'problem')} in ${plural(pools.length, 'pool')}` : pools.map((p) => `${p.title}: draw ${p.drawCount} of ${p.poolSize}`).join('; '),
          },
        ]
      : []),
    {
      key: 'schedule',
      label: 'Schedule',
      status: Object.keys(timing).length || has('window_closed') ? 'error' : 'ok',
      detail: Object.values(timing)[0] ?? (has('window_closed') ? 'The window has already closed' : `Attempts last ${spanLabel(exam.durationMinutes)}, inside a window open for ${spanLabel(Math.round((exam.windowClosesAt.getTime() - exam.windowOpensAt.getTime()) / 60_000))}`),
    },
    {
      key: 'rubrics',
      label: 'Rubrics for written answers',
      status: missingRubric.length ? 'warning' : 'ok',
      detail: missingRubric.length
        ? `${plural(missingRubric.length, 'question')} without a rubric`
        : items.some((i) => isWritten(i.type) || i.workingMarks > 0)
          ? 'Every written answer has a rubric'
          : 'No written answers to grade',
    },
    {
      key: 'candidates',
      label: 'Candidates',
      status: input.enrolledCount ? 'ok' : 'warning',
      detail: input.enrolledCount ? `${plural(input.enrolledCount, 'candidate')} enrolled` : 'No one is enrolled yet',
    },
    {
      key: 'opening',
      label: 'Opening time',
      status: opensInPast && exam.status === 'draft' ? 'warning' : 'ok',
      detail: opensInPast ? (exam.status === 'draft' ? 'Opens in the past' : 'Window has opened') : 'Opens in the future',
    },
  ];

  return { canPublish: errors.length === 0, errors, warnings, checklist, paper };
}

/** Field map for a 422 response, one entry per blocking issue. */
export function reviewErrorFields(review: ExamReview): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const e of review.errors) fields[fields[e.field] ? `${e.field}.${e.code}` : e.field] = e.message;
  return fields;
}

/** "90 minutes", "2 hours", "3 days 2 hours": readable spans for review copy. */
function spanLabel(minutes: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (minutes < 120) return unit(minutes, 'minute');
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days === 0) return mins ? `${unit(hours, 'hour')} ${unit(mins, 'minute')}` : unit(hours, 'hour');
  return hours ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
}

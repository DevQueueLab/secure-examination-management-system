import { DEFAULT_EXAM_SETTINGS, type ExamSettings } from '@athena/shared';
import { useSyncExternalStore } from 'react';
import { fromLocalInput, nextHourLocal, timeZoneLabel, toLocalInput } from '../lib/datetime';
import type { ExamDetail, ExamInput } from '../types';

/** Editable exam fields as the forms hold them: datetimes as local datetime-local strings. */
export interface ExamFormState {
  title: string;
  code: string;
  description: string;
  instructions: string;
  opens: string;
  closes: string;
  durationMinutes: number;
  totalMarks: number;
  settings: ExamSettings;
}

export type FormErrors = Record<string, string>;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function blankForm(): ExamFormState {
  return {
    title: '',
    code: '',
    description: '',
    instructions: '',
    opens: '',
    closes: '',
    durationMinutes: 90,
    totalMarks: 100,
    settings: clone(DEFAULT_EXAM_SETTINGS),
  };
}

/** Wizard defaults that depend on the viewer's clock: tomorrow at the next whole hour, a three-hour window. */
export function scheduleDefaults(): Pick<ExamFormState, 'opens' | 'closes'> {
  return { opens: nextHourLocal(1), closes: nextHourLocal(1, 3) };
}

export function formFromExam(exam: ExamDetail): ExamFormState {
  return {
    title: exam.title,
    code: exam.code ?? '',
    description: exam.description ?? '',
    instructions: exam.instructions ?? '',
    opens: toLocalInput(exam.windowOpensAt),
    closes: toLocalInput(exam.windowClosesAt),
    durationMinutes: exam.durationMinutes,
    totalMarks: exam.totalMarks,
    settings: { ...clone(DEFAULT_EXAM_SETTINGS), ...clone(exam.settings) },
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function inputFromForm(form: ExamFormState): ExamInput {
  return {
    title: form.title.trim(),
    code: orNull(form.code),
    description: orNull(form.description),
    instructions: form.instructions,
    windowOpensAt: fromLocalInput(form.opens) ?? '',
    windowClosesAt: fromLocalInput(form.closes) ?? '',
    durationMinutes: form.durationMinutes,
    totalMarks: form.totalMarks,
    settings: form.settings,
  };
}

/**
 * Only what the user changed. Datetimes compare as the local strings the inputs show, so an untouched
 * window (stored with seconds) is never re-sent: that matters once an exam is locked by a real attempt.
 */
export function patchFromForm(exam: ExamDetail, form: ExamFormState): Partial<ExamInput> {
  const base = formFromExam(exam);
  const patch: Partial<ExamInput> = {};
  if (form.title.trim() !== base.title) patch.title = form.title.trim();
  if (form.code.trim() !== base.code) patch.code = orNull(form.code);
  if (form.description.trim() !== base.description.trim()) patch.description = orNull(form.description);
  if (form.instructions !== base.instructions) patch.instructions = form.instructions;
  if (form.opens !== base.opens) patch.windowOpensAt = fromLocalInput(form.opens) ?? '';
  if (form.closes !== base.closes) patch.windowClosesAt = fromLocalInput(form.closes) ?? '';
  if (form.durationMinutes !== base.durationMinutes) patch.durationMinutes = form.durationMinutes;
  if (form.totalMarks !== base.totalMarks) patch.totalMarks = form.totalMarks;
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(form.settings) as (keyof ExamSettings)[]) {
    if (JSON.stringify(form.settings[key]) !== JSON.stringify(base.settings[key])) settings[key] = form.settings[key];
  }
  if (Object.keys(settings).length) patch.settings = settings as ExamInput['settings'];
  return patch;
}

/** The checks the API makes, run first so most mistakes never leave the page. */
export function validateBasics(form: ExamFormState): FormErrors {
  const e: FormErrors = {};
  if (form.title.trim().length < 3) e.title = 'Give the exam a title of at least 3 characters';
  if (!/^[A-Za-z0-9 ._/-]*$/.test(form.code.trim())) e.code = 'Use letters, digits, spaces and - _ . /';
  if (form.code.trim().length > 40) e.code = 'Keep the code under 40 characters';
  if (form.totalMarks < 0) e.totalMarks = 'Total marks can’t be negative';
  return e;
}

export function validateSchedule(form: ExamFormState): FormErrors {
  const e: FormErrors = {};
  const opens = fromLocalInput(form.opens);
  const closes = fromLocalInput(form.closes);
  if (!opens) e.windowOpensAt = 'Choose when the window opens';
  if (!closes) e.windowClosesAt = 'Choose when the window closes';
  if (opens && closes) {
    const windowMin = (new Date(closes).getTime() - new Date(opens).getTime()) / 60_000;
    if (windowMin <= 0) e.windowClosesAt = 'The window must close after it opens';
    else if (form.durationMinutes > windowMin) e.durationMinutes = `Longer than the ${Math.floor(windowMin)}-minute window`;
  }
  if (!Number.isInteger(form.durationMinutes) || form.durationMinutes < 1 || form.durationMinutes > 1440) e.durationMinutes = 'Between 1 and 1440 minutes';
  return e;
}

/** Which wizard step owns an error path (server errors can arrive for any step). */
export function stepOf(path: string): 0 | 1 | 2 {
  if (['title', 'code', 'description', 'instructions', 'totalMarks'].includes(path)) return 0;
  if (['windowOpensAt', 'windowClosesAt', 'durationMinutes', 'settings.lateEntryMinutes', 'settings.reconnectGraceMinutes'].includes(path)) return 1;
  return 2;
}

/** "Asia/Karachi (GMT+5)" after mount, empty during server render (avoids a hydration mismatch). */
export function useTimeZoneLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => timeZoneLabel(),
    () => '',
  );
}
const noopSubscribe = () => () => {};

/** Lock reason for a field path, from the exam's locks (prefix match: settings.marking covers settings.marking.multiSelect). */
export function lockReasonFor(exam: ExamDetail | undefined, path: string): string | undefined {
  if (!exam) return undefined;
  if (exam.status === 'archived') return 'Archived exams are read-only.';
  if (!exam.can.edit) return 'Only the exam’s owner and co-examiners can change this.';
  if (!exam.locks.locked) return undefined;
  const hit = exam.locks.fields.some((f) => path === f || path.startsWith(`${f}.`));
  if (!hit) return undefined;
  const n = exam.locks.realAttempts;
  return `Locked because ${n} candidate${n === 1 ? ' has' : 's have'} started. Changing it now would give candidates different exams.`;
}

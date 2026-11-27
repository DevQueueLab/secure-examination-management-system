import { contentSchemas, keySchemas, type Difficulty, type QuestionType } from '@athena/shared';
import type { QuestionDetail, QuestionInput } from '../../types';

/* Editor state mirrors the API body exactly ({content, key} per type), so client and server errors share paths. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export interface Option {
  id: string;
  text: string;
}

export interface Draft {
  type: QuestionType;
  title: string;
  difficulty: Difficulty;
  categoryId: string | null;
  tags: string[];
  defaultMarks: number;
  content: Json;
  key: Json;
}

/** Next free id with a prefix: o1, o2... skipping ids already used (imported questions may use any ids). */
export function nextId(prefix: string, existing: { id: string }[] | string[]): string {
  const taken = new Set(existing.map((e) => (typeof e === 'string' ? e : e.id)));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const opts = (prefix: string, n: number): Option[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, text: '' }));

export function defaultContentKey(type: QuestionType): { content: Json; key: Json } {
  const base = { stem: '', working: { enabled: false, marks: 0 } };
  switch (type) {
    case 'single_choice':
      return { content: { ...base, options: opts('o', 4) }, key: { correct: '' } };
    case 'multiple_choice':
      return { content: { ...base, options: opts('o', 4) }, key: { correct: [] } };
    case 'true_false':
      return { content: { ...base }, key: { correct: true } };
    case 'numeric':
      return { content: { ...base, variables: [] }, key: { answer: null, tolerance: { type: 'absolute', value: 0 } } };
    case 'short_text':
      return { content: { ...base, maxLength: 200 }, key: { accepted: [], caseSensitive: false } };
    case 'fill_blanks':
      return { content: { ...base, stem: 'Fill in each blank.', template: '', blanks: [] }, key: { blanks: {}, caseSensitive: false } };
    case 'matching':
      return {
        content: { ...base, prompts: opts('p', 3), answers: opts('a', 3) },
        key: { pairs: { p1: 'a1', p2: 'a2', p3: 'a3' } },
      };
    case 'ordering':
      return { content: { ...base, items: opts('i', 4) }, key: { order: ['i1', 'i2', 'i3', 'i4'] } };
    case 'long_text':
      return { content: { ...base }, key: {} };
    case 'code':
      return { content: { ...base, language: 'python', starterCode: '' }, key: {} };
  }
}

export function newDraft(type: QuestionType): Draft {
  return { type, title: '', difficulty: 'medium', categoryId: null, tags: [], defaultMarks: type === 'long_text' || type === 'code' ? 5 : 1, ...defaultContentKey(type) };
}

export function draftFromQuestion(q: QuestionDetail): Draft {
  const content = structuredClone(q.content) as Json;
  if (!content.working) content.working = { enabled: false, marks: 0 };
  return {
    type: q.type,
    title: q.title,
    difficulty: q.difficulty,
    categoryId: q.category?.id ?? null,
    tags: [...q.tags],
    defaultMarks: q.defaultMarks,
    content,
    key: structuredClone(q.key) as Json,
  };
}

/** Blank ids in the order they appear in a fill-in-the-blanks template: "[[b1]] ... [[b2]]". */
export function blankIds(template: string): string[] {
  const ids: string[] = [];
  for (const m of template.matchAll(/\[\[([A-Za-z0-9_-]{1,64})\]\]/g)) if (!ids.includes(m[1]!)) ids.push(m[1]!);
  return ids;
}

/** Keeps content.blanks and key.blanks in step with the template (tokens added or removed). */
export function syncBlanks(content: Json, key: Json): { content: Json; key: Json } {
  const ids = blankIds(String(content.template ?? ''));
  const prevLabels = new Map<string, string | undefined>((content.blanks ?? []).map((b: { id: string; label?: string }) => [b.id, b.label]));
  const blanks = ids.map((id) => (prevLabels.get(id) ? { id, label: prevLabels.get(id) } : { id }));
  const accepted: Record<string, string[]> = {};
  for (const id of ids) accepted[id] = key.blanks?.[id] ?? [];
  return { content: { ...content, blanks }, key: { ...key, blanks: accepted } };
}

/** Drops empty optional fields so the API stores clean JSON (and an unchanged question compares equal). */
function clean(type: QuestionType, content: Json, key: Json): { content: Json; key: Json } {
  const c: Json = { ...content };
  const k: Json = { ...key };
  for (const f of ['explanation', 'unit', 'starterCode']) if (typeof c[f] === 'string' && !c[f].trim()) delete c[f];
  if (c.working) {
    c.working = { ...c.working };
    if (!c.working.guidance?.trim()) delete c.working.guidance;
    if (!c.working.enabled) c.working = { enabled: false, marks: 0 };
  }
  if (type === 'long_text') {
    if (c.minWords === null || c.minWords === undefined || c.minWords === '') delete c.minWords;
    if (c.maxWords === null || c.maxWords === undefined || c.maxWords === '') delete c.maxWords;
  }
  if (type === 'long_text' || type === 'code') if (typeof k.sampleAnswer === 'string' && !k.sampleAnswer.trim()) delete k.sampleAnswer;
  if (type === 'numeric') {
    if (typeof k.formula === 'string' && !k.formula.trim()) delete k.formula;
    if (k.formula) k.answer = null;
  }
  if (type === 'ordering') k.order = (c.items as Option[]).map((i) => i.id);
  if (type === 'short_text') k.accepted = (k.accepted as string[]).map((a) => a.trim()).filter(Boolean);
  return { content: c, key: k };
}

export function toInput(draft: Draft, baseVersion?: number): QuestionInput {
  const { content, key } = clean(draft.type, draft.content, draft.key);
  return {
    type: draft.type,
    title: draft.title.trim(),
    difficulty: draft.difficulty,
    categoryId: draft.categoryId,
    tags: draft.tags,
    defaultMarks: draft.defaultMarks,
    content,
    key,
    ...(baseVersion !== undefined ? { baseVersion } : {}),
  };
}

/**
 * The same schemas the API validates with (from @athena/shared), plus the cross-field rules it applies,
 * so almost every mistake is caught before a request.
 */
export function validateDraft(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  const add = (path: string, message: string) => {
    if (!(path in errors)) errors[path] = message;
  };
  const title = draft.title.trim();
  if (title.length < 3) add('title', 'Give the question a short title (3+ characters)');
  if (title.length > 200) add('title', 'Keep the title under 200 characters');
  if (!(draft.defaultMarks > 0)) add('defaultMarks', 'Marks must be more than 0');

  const { content, key } = clean(draft.type, draft.content, draft.key);

  // Specific checks first: their messages say what to do, where the schema would only say "Required".
  const t = draft.type;
  if (t === 'single_choice' && !(content.options as Option[]).some((o) => o.id === key.correct)) add('key.correct', 'Choose which option is correct');
  if (t === 'multiple_choice' && !(key.correct as string[]).length) add('key.correct', 'Mark at least one correct option');
  if (t === 'numeric') {
    const vars = (content.variables ?? []) as { name: string; min: number; max: number }[];
    const seen = new Set<string>();
    vars.forEach((v, i) => {
      if (seen.has(v.name)) add(`content.variables.${i}.name`, `“${v.name}” is defined twice`);
      seen.add(v.name);
      if (v.max < v.min) add(`content.variables.${i}.max`, 'Max must be at least min');
    });
    if (vars.length && !key.formula) add('key.formula', 'Questions with variables need a formula for the answer');
    if (!vars.length && !key.formula && (key.answer === null || key.answer === undefined || Number.isNaN(key.answer))) add('key.answer', 'Give the answer or a formula');
  }
  if (t === 'fill_blanks') {
    const ids = blankIds(String(content.template ?? ''));
    if (!ids.length) {
      add('content.template', 'Insert at least one blank, written as [[b1]]');
      add('content.blanks', '');
    }
    for (const id of ids) if (!(key.blanks?.[id] ?? []).length) add(`key.blanks.${id}`, 'Add at least one accepted answer');
  }
  if (t === 'matching') {
    const answers = new Set((content.answers as Option[]).map((a) => a.id));
    for (const p of content.prompts as Option[]) if (!answers.has(key.pairs?.[p.id])) add(`key.pairs.${p.id}`, 'Choose its match');
  }
  if (t === 'long_text' && content.minWords && content.maxWords && content.minWords > content.maxWords) add('content.maxWords', 'Must be at least the minimum');

  const c = contentSchemas[draft.type].safeParse(content);
  if (!c.success) for (const issue of c.error.issues) add(['content', ...issue.path].join('.'), friendly(issue.message, issue.path));
  const k = keySchemas[draft.type].safeParse(key);
  if (!k.success) for (const issue of k.error.issues) add(['key', ...issue.path].join('.'), friendly(issue.message, issue.path));
  // A placeholder used only to keep a derived field's raw schema message out of the list.
  for (const [path, message] of Object.entries(errors)) if (!message) delete errors[path];
  return errors;
}

const PART: Record<string, string> = { options: 'option', prompts: 'prompt', answers: 'answer', items: 'item' };

function friendly(message: string, path: readonly PropertyKey[] = []): string {
  const part = PART[String(path[0])];
  if (part && path[path.length - 1] === 'text') return `Write the ${part}, or remove it`;
  if (/expected string to have >=1/i.test(message) || /Too small: expected string/i.test(message)) return 'Required';
  if (/expected array to have >=1/i.test(message)) return 'Add at least one';
  if (/expected number, received/i.test(message)) return 'Enter a number';
  return message;
}

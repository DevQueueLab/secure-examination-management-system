import Papa from 'papaparse';
import { DIFFICULTIES, QUESTION_TYPES, QUESTION_TYPE_META, type Difficulty, type QuestionType } from '@athena/shared';

/**
 * Pure parsing for the question import (SF-4.4): turns CSV rows or JSON items into authoring drafts.
 * Validation of the drafts themselves happens in the service with the same rules as the editor.
 */

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportDraft {
  row: number;
  type: QuestionType;
  category: string | null;
  difficulty: Difficulty;
  title: string;
  marks: number;
  tags: string[];
  content: Record<string, unknown>;
  key: Record<string, unknown>;
}

export const MAX_IMPORT_ROWS = 500;
export const CSV_COLUMNS = ['type', 'category', 'difficulty', 'title', 'stem', 'options', 'correct', 'marks', 'tags', 'explanation'] as const;

const TYPE_ALIASES: Record<string, QuestionType> = {
  mcq: 'single_choice',
  single: 'single_choice',
  'single choice': 'single_choice',
  multi: 'multiple_choice',
  multiple: 'multiple_choice',
  msq: 'multiple_choice',
  'multiple select': 'multiple_choice',
  'multiple choice': 'multiple_choice',
  tf: 'true_false',
  'true/false': 'true_false',
  truefalse: 'true_false',
  'true false': 'true_false',
  short: 'short_text',
  'short answer': 'short_text',
  number: 'numeric',
  blanks: 'fill_blanks',
  'fill in the blanks': 'fill_blanks',
  match: 'matching',
  order: 'ordering',
  essay: 'long_text',
  long: 'long_text',
  'written response': 'long_text',
};

export function resolveType(raw: string): QuestionType | null {
  const v = raw.trim().toLowerCase().replace(/[-]/g, '_');
  if ((QUESTION_TYPES as readonly string[]).includes(v)) return v as QuestionType;
  const spaced = v.replace(/_/g, ' ');
  if (TYPE_ALIASES[spaced]) return TYPE_ALIASES[spaced]!;
  if (TYPE_ALIASES[v]) return TYPE_ALIASES[v]!;
  const byLabel = QUESTION_TYPES.find((t) => QUESTION_TYPE_META[t].label.toLowerCase() === spaced || QUESTION_TYPE_META[t].short.toLowerCase() === spaced);
  return byLabel ?? null;
}

const splitList = (raw: string, sep: RegExp) =>
  raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

const optionId = (i: number) => `o${i + 1}`;

/** "B" -> 1, "2" -> 1 (1-based numbers are accepted too). */
function letterIndex(token: string): number | null {
  const t = token.trim().toUpperCase();
  if (/^[A-Z]$/.test(t)) return t.charCodeAt(0) - 65;
  if (/^\d{1,2}$/.test(t)) return Number(t) - 1;
  return null;
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['true', 't', 'yes', 'y', '1'].includes(v)) return true;
  if (['false', 'f', 'no', 'n', '0'].includes(v)) return false;
  return null;
}

/** "9.81", "9.81 ± 0.05", "9.81 +- 0.05", "120 ± 2%" */
function parseNumericAnswer(raw: string): { answer: number; tolerance: { type: 'absolute' | 'relative'; value: number } } | null {
  const m = raw.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:(?:±|\+-|\+\/-)\s*((?:\d+\.?\d*|\.\d+))\s*(%?))?$/i);
  if (!m) return null;
  const answer = Number(m[1]);
  if (!Number.isFinite(answer)) return null;
  if (!m[2]) return { answer, tolerance: { type: 'absolute', value: 0 } };
  const value = Number(m[2]);
  return m[3] ? { answer, tolerance: { type: 'relative', value: value / 100 } } : { answer, tolerance: { type: 'absolute', value } };
}

export function parseCsv(data: string): { rows: Record<string, string>[]; errors: RowError[]; missingColumns: string[] } {
  const result = Papa.parse<Record<string, string>>(data.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });
  const errors: RowError[] = result.errors
    .filter((e) => e.type !== 'FieldMismatch' || e.code !== 'TooFewFields')
    .map((e) => ({ row: (e.row ?? 0) + 2, field: 'row', message: e.message }));
  const fields = result.meta.fields ?? [];
  const missingColumns = ['type', 'title', 'stem'].filter((c) => !fields.includes(c));
  return { rows: result.data, errors, missingColumns };
}

/** Maps one CSV row (header = line 1, so the first data row is line 2) to a draft. */
export function csvRowToDraft(raw: Record<string, string>, line: number): { draft?: ImportDraft; errors: RowError[] } {
  const errors: RowError[] = [];
  const err = (field: string, message: string) => errors.push({ row: line, field, message });
  const get = (k: string) => (raw[k] ?? '').toString().trim();

  const type = resolveType(get('type'));
  if (!get('type')) err('type', 'Type is required');
  else if (!type) err('type', `Unknown type "${get('type')}". Use one of: ${QUESTION_TYPES.join(', ')}`);

  const difficultyRaw = get('difficulty').toLowerCase();
  const difficulty = (difficultyRaw || 'medium') as Difficulty;
  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) err('difficulty', 'Difficulty must be easy, medium or hard');

  const marksRaw = get('marks');
  const marks = marksRaw === '' ? 1 : Number(marksRaw);
  if (!Number.isFinite(marks) || marks <= 0) err('marks', 'Marks must be a number above 0');

  const stem = get('stem');
  const options = splitList(get('options'), /\|/);
  const correct = get('correct');
  const explanation = get('explanation') || undefined;
  const base = { stem, ...(explanation ? { explanation } : {}) };

  let content: Record<string, unknown> = base;
  let key: Record<string, unknown> = {};

  if (type) {
    switch (type) {
      case 'single_choice':
      case 'multiple_choice': {
        const opts = options.map((text, i) => ({ id: optionId(i), text }));
        const picks = splitList(correct, /[,;\s]+/);
        const ids: string[] = [];
        for (const p of picks) {
          const idx = letterIndex(p);
          if (idx === null) err('correct', `"${p}" is not an option letter (use A, B, C...)`);
          else if (idx < 0 || idx >= opts.length) err('correct', `Option ${p.toUpperCase()} does not exist (${opts.length} option${opts.length === 1 ? '' : 's'} given)`);
          else ids.push(opts[idx]!.id);
        }
        if (picks.length === 0) err('correct', type === 'single_choice' ? 'Give the correct option letter, e.g. B' : 'Give the correct option letters, e.g. A,C');
        if (type === 'single_choice' && picks.length > 1) err('correct', 'Single choice takes exactly one correct option. Use type multiple_choice for several.');
        content = { ...base, options: opts };
        key = type === 'single_choice' ? { correct: ids[0] ?? '' } : { correct: [...new Set(ids)] };
        break;
      }
      case 'true_false': {
        const v = parseBool(correct);
        if (v === null) err('correct', 'Write true or false');
        key = { correct: v ?? false };
        break;
      }
      case 'numeric': {
        const parsed = parseNumericAnswer(correct);
        if (!parsed) err('correct', 'Give the answer as a number, optionally with a tolerance like 9.8 ± 0.1 or 120 ± 2%');
        content = { ...base, variables: [] };
        key = parsed ? { answer: parsed.answer, tolerance: parsed.tolerance } : { answer: null };
        break;
      }
      case 'short_text': {
        const accepted = splitList(correct, /\|/);
        if (accepted.length === 0) err('correct', 'Give at least one accepted answer (separate alternatives with |)');
        key = { accepted, caseSensitive: false };
        break;
      }
      case 'fill_blanks': {
        // The stem is the text with [[b1]] markers; correct lists each blank's answers in order, alternatives split by /.
        const ids = [...stem.matchAll(/\[\[([A-Za-z0-9_-]{1,64})\]\]/g)].map((m) => m[1]!);
        const answers = correct.split('|').map((part) => splitList(part, /\//));
        if (ids.length === 0) err('stem', 'Mark each blank in the stem as [[b1]], [[b2]]...');
        else if (answers.length !== ids.length) err('correct', `The stem has ${ids.length} blank${ids.length === 1 ? '' : 's'} but ${answers.length} answer group${answers.length === 1 ? '' : 's'} were given (separate with |)`);
        content = { ...base, stem: 'Fill in the blanks.', template: stem, blanks: [...new Set(ids)].map((id) => ({ id })) };
        key = { blanks: Object.fromEntries(ids.map((id, i) => [id, answers[i] ?? []])), caseSensitive: false };
        break;
      }
      case 'matching': {
        // options: "Prompt=Answer|Prompt=Answer|=Distractor"
        const prompts: { id: string; text: string }[] = [];
        const answers: { id: string; text: string }[] = [];
        const pairs: Record<string, string> = {};
        for (const [i, pair] of options.entries()) {
          const at = pair.indexOf('=');
          if (at < 0) {
            err('options', `"${pair}" needs the form Prompt=Answer`);
            continue;
          }
          const prompt = pair.slice(0, at).trim();
          const answer = pair.slice(at + 1).trim();
          const answerId = `a${i + 1}`;
          answers.push({ id: answerId, text: answer });
          if (prompt) {
            const promptId = `p${prompts.length + 1}`;
            prompts.push({ id: promptId, text: prompt });
            pairs[promptId] = answerId;
          }
        }
        content = { ...base, prompts, answers };
        key = { pairs };
        break;
      }
      case 'ordering': {
        // options: the items already in the correct order.
        const items = options.map((text, i) => ({ id: `i${i + 1}`, text }));
        content = { ...base, items };
        key = { order: items.map((it) => it.id) };
        break;
      }
      case 'long_text':
        key = correct ? { sampleAnswer: correct } : {};
        break;
      case 'code':
        content = { ...base, language: 'python' };
        key = correct ? { sampleAnswer: correct } : {};
        break;
    }
  }

  if (errors.length || !type) return { errors };
  return {
    errors,
    draft: {
      row: line,
      type,
      category: get('category') || null,
      difficulty,
      title: get('title'),
      marks,
      tags: splitList(get('tags'), /;/),
      content,
      key,
    },
  };
}

/** Maps one JSON item (1-based position in the array) to a draft. */
export function jsonItemToDraft(item: unknown, row: number): { draft?: ImportDraft; errors: RowError[] } {
  const errors: RowError[] = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { errors: [{ row, field: 'row', message: 'Each item must be an object' }] };
  const o = item as Record<string, unknown>;
  const type = typeof o.type === 'string' ? resolveType(o.type) : null;
  if (!type) errors.push({ row, field: 'type', message: `Unknown or missing type. Use one of: ${QUESTION_TYPES.join(', ')}` });
  const difficulty = (typeof o.difficulty === 'string' ? o.difficulty.toLowerCase() : 'medium') as Difficulty;
  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) errors.push({ row, field: 'difficulty', message: 'Difficulty must be easy, medium or hard' });
  const marks = o.marks === undefined ? 1 : Number(o.marks);
  if (!Number.isFinite(marks) || marks <= 0) errors.push({ row, field: 'marks', message: 'Marks must be a number above 0' });
  if (!o.content || typeof o.content !== 'object') errors.push({ row, field: 'content', message: 'content is required' });
  if (o.key === undefined || typeof o.key !== 'object' || o.key === null) errors.push({ row, field: 'key', message: 'key is required' });
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : typeof o.tags === 'string' ? splitList(o.tags, /;/) : [];
  if (errors.length || !type) return { errors };
  return {
    errors,
    draft: {
      row,
      type,
      category: typeof o.category === 'string' && o.category.trim() ? o.category.trim() : null,
      difficulty,
      title: typeof o.title === 'string' ? o.title.trim() : '',
      marks,
      tags,
      content: o.content as Record<string, unknown>,
      key: o.key as Record<string, unknown>,
    },
  };
}

/** Maps a validation path from the authoring schema to the CSV column a person would fix. */
export function csvFieldFor(path: string): string {
  if (path === 'title') return 'title';
  if (path === 'defaultMarks') return 'marks';
  if (path.startsWith('tags')) return 'tags';
  if (path === 'difficulty') return 'difficulty';
  if (path.startsWith('content.explanation')) return 'explanation';
  if (path.startsWith('content.stem') || path.startsWith('content.template') || path.startsWith('content.blanks')) return 'stem';
  if (/^content\.(options|items|prompts|answers)/.test(path)) return 'options';
  if (path.startsWith('key.')) return 'correct';
  if (path === '_') return 'row';
  return path;
}

export const CSV_TEMPLATE = [
  CSV_COLUMNS.join(','),
  'single_choice,Data Structures,easy,Queue in BFS,Which structure holds the BFS frontier?,Stack|Queue|Heap|Set,B,2,graphs;bfs,BFS explores level by level.',
  'multiple_choice,Algorithms,medium,Stable sorts,Which sorting algorithms are stable?,Merge sort|Quick sort|Insertion sort|Heap sort,"A,C",4,sorting,',
  'true_false,Data Structures,medium,Hash worst case,A hash table guarantees O(1) lookups in the worst case.,,false,2,hashing,Collisions can degrade lookups to O(n).',
  'numeric,Physics,easy,Free fall,An object falls for 2 s from rest. How far does it fall in metres? (g = 9.8),,19.6 ± 0.1,3,kinematics,',
  'short_text,Databases,easy,Remove duplicates,Which SQL keyword removes duplicate rows from a result?,,DISTINCT|SELECT DISTINCT,2,sql,',
  'fill_blanks,Algorithms,medium,Negative weights,Dijkstra fails with [[b1]] edge weights; [[b2]] handles them.,,negative|Bellman-Ford/Bellman Ford,4,graphs,',
  'matching,Physics,easy,SI units,Match each quantity to its unit.,Force=Newton|Energy=Joule|Power=Watt|=Pascal,,3,units,',
  'ordering,Operating Systems,easy,Build stages,Put the stages of building a C program in order.,Preprocess|Compile|Assemble|Link,,3,compilers,',
  'long_text,Software Engineering,medium,Retries,Explain how idempotency keys make retries safe.,,,6,distributed-systems,',
  'code,Algorithms,medium,Palindrome,Write a function is_palindrome(s) that ignores case and spaces.,,,6,strings,',
].join('\n');

export const JSON_TEMPLATE = JSON.stringify(
  [
    {
      type: 'single_choice',
      category: 'Data Structures',
      difficulty: 'easy',
      title: 'Queue in BFS',
      marks: 2,
      tags: ['graphs', 'bfs'],
      content: { stem: 'Which structure holds the BFS frontier?', options: [{ id: 'o1', text: 'Stack' }, { id: 'o2', text: 'Queue' }, { id: 'o3', text: 'Heap' }] },
      key: { correct: 'o2' },
    },
    {
      type: 'numeric',
      category: 'Physics',
      difficulty: 'medium',
      title: 'Average speed (parameterized)',
      marks: 3,
      content: {
        stem: 'A car travels {{d}} km in {{t}} hours. What is its average speed in km/h?',
        unit: 'km/h',
        variables: [
          { name: 'd', min: 60, max: 240, step: 10 },
          { name: 't', min: 1, max: 4, step: 1 },
        ],
        working: { enabled: true, marks: 1, guidance: 'Show the formula you use.' },
      },
      key: { answer: null, formula: 'd / t', tolerance: { type: 'relative', value: 0.01 } },
    },
    {
      type: 'matching',
      category: 'Physics',
      difficulty: 'easy',
      title: 'SI units',
      marks: 3,
      content: {
        stem: 'Match each quantity to its SI unit.',
        prompts: [{ id: 'p1', text: 'Force' }, { id: 'p2', text: 'Energy' }],
        answers: [{ id: 'a1', text: 'Newton' }, { id: 'a2', text: 'Joule' }, { id: 'a3', text: 'Pascal' }],
      },
      key: { pairs: { p1: 'a1', p2: 'a2' } },
    },
    {
      type: 'long_text',
      category: 'Software Engineering',
      difficulty: 'hard',
      title: 'Designing for retries',
      marks: 6,
      content: { stem: 'Explain how idempotency keys make retries safe.', minWords: 80, maxWords: 400 },
      key: { sampleAnswer: 'The client sends a unique key per logical operation...' },
    },
  ],
  null,
  2,
);

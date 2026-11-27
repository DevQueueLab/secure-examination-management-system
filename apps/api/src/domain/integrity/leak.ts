import { decodeFingerprints, stripFingerprints } from '@athena/shared';

/**
 * Paper-leak forensics. Pure functions: the service loads papers, checks access and resolves names.
 *
 * (a) Invisible marks. Every question stem a candidate sees carries their paper's code in zero-width characters,
 *     and copying question text out of the exam appends it too. A valid mark identifies the paper exactly.
 * (b) A damaged mark shows the text came from an Athena paper but no longer says whose.
 * (c) Variant forensics. Per-paper numbers, option order and question draw narrow down which papers the text
 *     could have come from. It says which papers fit, never who shared them.
 */

// ---------------------------------------------------------------------------------------------------------
// (a) and (b): invisible marks and typed codes
// ---------------------------------------------------------------------------------------------------------

export type MarkStatus = 'intact' | 'damaged' | 'none';

const ZW_FRAME_CHAR = /[\u2063\u2064]/;
const CODE_ALPHABET = /^[0-9A-HJKMNP-TV-Z]+$/;
const ZW_DIGIT_RUN = /[\u200B\u200C\u200D\u2060]{4,}/;

/** Reads the marks in the raw pasted text. Run it before any cleaning: cleaning removes them. */
export function readMarks(raw: string): { status: MarkStatus; codes: string[] } {
  // A checksum-valid frame that decodes to something other than a paper code was not written by Athena.
  const codes = decodeFingerprints(raw).filter((c) => c.length >= 4 && c.length <= 12 && CODE_ALPHABET.test(c));
  if (codes.length > 0) return { status: 'intact', codes };
  // Emoji sequences and Urdu or Persian text use lone joiners. Only our frame characters or a run of four count.
  return { status: ZW_FRAME_CHAR.test(raw) || ZW_DIGIT_RUN.test(raw) ? 'damaged' : 'none', codes: [] };
}

/**
 * A watermark code as someone typed it from a screenshot. Case, spaces and dashes don't matter, and the letters
 * the code alphabet leaves out because they look like digits (O, I, L) read as 0, 1 and 1.
 */
export function normalizeCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s\-\u2010-\u2015_.\u00B7]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length < 4 || code.length > 12 || !CODE_ALPHABET.test(code)) return null;
  return code;
}

// ---------------------------------------------------------------------------------------------------------
// Text as a reader sees it
// ---------------------------------------------------------------------------------------------------------

export interface Token {
  kind: 'word' | 'number';
  value: string;
  start: number;
  end: number;
  /** A line break or sentence end comes before it, as before a question number ("Q3." or "3."). */
  boundary: boolean;
}

/** LaTeX commands that render as a word a reader (or OCR) would see. */
const FUNCTION_NAMES = new Set(['log', 'ln', 'lg', 'sin', 'cos', 'tan', 'exp', 'max', 'min', 'lim', 'det', 'gcd', 'mod']);
const SUPER_SUB = /[²³¹⁰-₟]/g;

/**
 * Removes invisible marks, Markdown and LaTeX markup, and folds compatibility forms (² to 2, full-width digits,
 * Arabic-Indic digits) so a stem stored as `3x^2` matches the same stem pasted from the screen as `3x²`.
 */
export function cleanText(raw: string): string {
  return stripFingerprints(raw)
    .replace(SUPER_SUB, (c) => ` ${c.normalize('NFKC')} `)
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => (FUNCTION_NAMES.has(name) ? ` ${name} ` : ' '))
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/[*_`#>$^{}|~\\]/g, ' ');
}

/** "7.50" and "7.5", "02" and "2", "1,000" and "1000" are the same number. */
export function normalizeNumber(raw: string): string {
  let s = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(/,/g, '.');
  if (s.split('.').length > 2) return s;
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace(/^0+(?=\d)/, '');
}

const TOKEN = /\p{L}+|\d+(?:[.,]\d+)*/gu;

export function tokenize(clean: string): Token[] {
  const out: Token[] = [];
  let previousEnd = 0;
  for (const m of clean.matchAll(TOKEN)) {
    const value = m[0];
    const start = m.index ?? 0;
    const number = value.charCodeAt(0) <= 57;
    const boundary = out.length === 0 || /\n|[.?!;:]\s/.test(clean.slice(previousEnd, start));
    out.push({ kind: number ? 'number' : 'word', value: number ? normalizeNumber(value) : value.toLowerCase(), start, end: start + value.length, boundary });
    previousEnd = start + value.length;
  }
  return out;
}

/** A number that continues the current sentence (not the next question's number). */
const continuesWith = (t: Token | undefined) => t !== undefined && t.kind === 'number' && !t.boundary;

export interface Span {
  /** First and last token of the match. */
  from: number;
  to: number;
  coverage: number;
  matched: number;
}

export interface Template {
  /** Distinct tokens that identify the question on any paper. */
  keys: Set<string>;
  /** The same tokens in stem order, with repeats. */
  sequence: string[];
  /** Token count of the whole stem. */
  length: number;
}

/** Longest common subsequence: how much of the template appears in the same order. */
function lcs(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Finds where a question's text sits in the leak: the window with the most distinct template tokens, which must
 * also follow the template's word order (so "3x² + 2x … evaluate" is not mistaken for "evaluate ∫ 3x² dx").
 * Templates under 4 distinct tokens are too generic to recognise; under 5 they must match almost completely.
 */
export function locate(tokens: Token[], { keys: template, sequence, length: templateLength }: Template): Span | null {
  const size = template.size;
  if (size < 4 || tokens.length === 0) return null;
  const width = Math.max(8, Math.round(templateLength * 1.15) + 3);
  const counts = new Map<string, number>();
  let distinct = 0;
  let best = 0;
  let bestEnd = -1;
  for (let j = 0; j < tokens.length; j++) {
    const incoming = tokens[j]!.value;
    if (template.has(incoming)) {
      const c = (counts.get(incoming) ?? 0) + 1;
      counts.set(incoming, c);
      if (c === 1) distinct++;
    }
    const leaving = j - width;
    if (leaving >= 0) {
      const out = tokens[leaving]!.value;
      if (template.has(out)) {
        const c = counts.get(out)! - 1;
        counts.set(out, c);
        if (c === 0) distinct--;
      }
    }
    if (distinct > best) {
      best = distinct;
      bestEnd = j;
    }
  }
  const coverage = best / size;
  if (best < 4 || coverage < (size >= 5 ? 0.6 : 0.8)) return null;
  let from = Math.max(0, bestEnd - width + 1);
  const inWindow = new Map<string, number>();
  for (let i = from; i <= bestEnd; i++) {
    const v = tokens[i]!.value;
    if (template.has(v)) inWindow.set(v, (inWindow.get(v) ?? 0) + 1);
  }
  // The tightest window with the same matches, so the end of the previous question can't pull the start back.
  while (from < bestEnd) {
    const v = tokens[from]!.value;
    const c = inWindow.get(v);
    if (c === 1) break;
    if (c !== undefined) inWindow.set(v, c - 1);
    from++;
  }
  // The window was found at its earliest end, but the stem can go on: it may end on its variable ("at x = 5").
  let to = bestEnd;
  while (to + 1 < tokens.length && to + 1 - from < width && (template.has(tokens[to + 1]!.value) || continuesWith(tokens[to + 1]))) to++;
  const seen = tokens
    .slice(from, to + 1)
    .map((t) => t.value)
    .filter((v) => template.has(v));
  if (lcs(sequence, seen) < 0.6 * sequence.length) return null;
  return { from, to, coverage: round(coverage), matched: best };
}

// ---------------------------------------------------------------------------------------------------------
// (c) Variant forensics
// ---------------------------------------------------------------------------------------------------------

/** One question as it appeared on one candidate's paper (attempt_items row). */
export interface PaperItem {
  attemptId: string;
  examId: string;
  questionId: string;
  title: string;
  position: number;
  type: string;
  content: Record<string, unknown>;
  variant: Record<string, unknown>;
}

export interface LocatedQuestion {
  examId: string;
  questionId: string;
  title: string;
  coverage: number;
  /** The recognised passage, cleaned of markup. */
  excerpt: string;
}

export type ObservationKind = 'numbers' | 'order' | 'drawn';

export interface Observation {
  questionId: string;
  title: string;
  kind: ObservationKind;
  /** What the leaked text shows, in plain words. */
  detail: string;
  /** For order details: the options (or answers, or items) as the text lists them, in the paper's own wording. */
  sequence?: string[];
  /** Papers in this exam consistent with it. */
  fitting: string[];
  papers: number;
}

export type TraceConfidence = 'strong' | 'weak' | 'none';

export interface ExamTrace {
  examId: string;
  papers: number;
  questions: LocatedQuestion[];
  /** Only observations that tell papers apart: every one fits some papers and not others. */
  observations: Observation[];
  /** Papers consistent with every observation. Unordered: they fit equally. */
  fitting: string[];
  /** When no paper fits everything: the few papers that fit the most observations. */
  closest: { attemptIds: string[]; fits: number; of: number } | null;
  /** True when the text narrows the exam's papers down to a small group worth naming. */
  narrowed: boolean;
  confidence: TraceConfidence;
}

export const NAME_LIMIT = 5;

/** The text a candidate saw for the question itself (not options), as stored. */
export function visibleStem(item: Pick<PaperItem, 'content'>): string {
  const c = item.content;
  const parts = [typeof c.stem === 'string' ? c.stem : ''];
  if (typeof c.template === 'string') parts.push(c.template);
  return parts.join('\n');
}

interface Choice {
  id: string;
  text: string;
}

/** The list whose order differs between papers: options, matching answers or ordering items, in display order. */
function sequenceOf(item: PaperItem): { noun: string; list: Choice[] } | null {
  const pick = (value: unknown): Choice[] =>
    Array.isArray(value)
      ? value.flatMap((v) => (v && typeof v === 'object' && typeof v.id === 'string' && typeof v.text === 'string' ? [{ id: v.id, text: v.text }] : []))
      : [];
  if (item.type === 'single_choice' || item.type === 'multiple_choice') return { noun: 'Options', list: pick(item.content.options) };
  if (item.type === 'matching') return { noun: 'Answers', list: pick(item.content.answers) };
  if (item.type === 'ordering') return { noun: 'Items', list: pick(item.content.items) };
  return null;
}

function variantValues(item: PaperItem): Record<string, unknown> | null {
  const values = item.variant?.values;
  return values && typeof values === 'object' && Object.keys(values).length > 0 ? (values as Record<string, unknown>) : null;
}

const valuesLabel = (values: Record<string, unknown>) =>
  Object.entries(values)
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join(', ');

function countOf<T>(list: T[]): Map<T, number> {
  const out = new Map<T, number>();
  for (const v of list) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

function groupBy<T>(list: T[], keyOf: (v: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const v of list) {
    const k = keyOf(v);
    const group = out.get(k);
    if (group) group.push(v);
    else out.set(k, [v]);
  }
  return out;
}

interface QuestionMatch {
  questionId: string;
  title: string;
  items: PaperItem[];
  span: Span;
  /** Token count of the stem: where the stem should end, even when the match ran on into the options. */
  length: number;
}

/** Words of the stem plus the numbers every paper's version shares: what identifies the question on any paper. */
function questionTemplate(items: PaperItem[]): Template {
  const renditions = [...groupBy(items, (i) => visibleStem(i)).keys()].map((stem) => tokenize(cleanText(stem)));
  const first = renditions[0] ?? [];
  const keys = new Set(first.filter((t) => t.kind === 'word').map((t) => t.value));
  const numberSets = renditions.map((r) => new Set(r.filter((t) => t.kind === 'number').map((t) => t.value)));
  for (const n of numberSets[0] ?? []) if (numberSets.every((s) => s.has(n))) keys.add(n);
  return { keys, sequence: first.map((t) => t.value).filter((v) => keys.has(v)), length: first.length };
}

function stemTemplate(item: PaperItem): Template {
  const tokens = tokenize(cleanText(visibleStem(item))).map((t) => t.value);
  return { keys: new Set(tokens), sequence: tokens, length: tokens.length };
}

/**
 * Number tokens of the matched stem, plus numbers that continue its last sentence (a stem can end on its variable).
 * Nothing before the stem counts: that is where question numbers sit ("Q2. Let f(x)…").
 */
function numbersAround(tokens: Token[], match: QuestionMatch): Map<string, number> {
  const span = match.span;
  const from = span.from;
  let to = Math.min(span.to, span.from + match.length + 2);
  for (let k = 0; k < 3 && continuesWith(tokens[to + 1]); k++) to++;
  return countOf(
    tokens
      .slice(from, to + 1)
      .filter((t) => t.kind === 'number')
      .map((t) => t.value),
  );
}

/**
 * Which versions of a parameterized question the text is consistent with. Each value must appear as many times as
 * it does in that version's stem, so a value that equals a constant (a = 2 in "3x² + 2x") still has to show up
 * once more than the constant alone accounts for.
 */
function numbersObservation(tokens: Token[], match: QuestionMatch, attemptIds: string[]): Observation | null {
  const papers = attemptIds.length;
  const renditions = groupBy(
    match.items.filter((i) => variantValues(i)),
    (i) => JSON.stringify(Object.entries(variantValues(i)!).sort()),
  );
  if (renditions.size < 2) return null;
  const seen = numbersAround(tokens, match);
  const fitting: string[] = [];
  const fitLabels: string[] = [];
  let decided = 0;
  for (const group of renditions.values()) {
    const sample = group[0]!;
    const values = variantValues(sample)!;
    const stemNumbers = countOf(
      tokenize(cleanText(visibleStem(sample)))
        .filter((t) => t.kind === 'number')
        .map((t) => t.value),
    );
    const required = new Map<string, number>();
    for (const v of Object.values(values)) {
      const n = normalizeNumber(String(v));
      const times = stemNumbers.get(n) ?? 0;
      if (times > 0) required.set(n, times);
    }
    if (required.size === 0) {
      // This version's values don't appear in its stem, so the text can't rule it in or out.
      fitting.push(...group.map((i) => i.attemptId));
      continue;
    }
    decided++;
    if ([...required].every(([n, times]) => (seen.get(n) ?? 0) >= times)) {
      fitting.push(...group.map((i) => i.attemptId));
      fitLabels.push(valuesLabel(values));
    }
  }
  if (decided === 0 || fitLabels.length === 0) return null;
  fitting.push(...undrawnIfUnsure(match, attemptIds));
  if (new Set(fitting).size >= papers) return null;
  return {
    questionId: match.questionId,
    title: match.title,
    kind: 'numbers',
    detail: `Uses ${fitLabels.slice(0, 3).join(' or ')}${fitLabels.length > 3 ? ' or another version' : ''}`,
    fitting: [...new Set(fitting)],
    papers,
  };
}

/** Which papers showed the options (or answers, or items) in the order the text lists them. */
function orderObservation(tokens: Token[], match: QuestionMatch, nextFrom: number, attemptIds: string[]): Observation | null {
  const papers = attemptIds.length;
  const sample = sequenceOf(match.items[0]!);
  if (!sample || sample.list.length < 3) return null;
  const choiceTokens = sample.list
    .map((c) => ({ ...c, tokens: tokenize(cleanText(c.text)).map((t) => t.value) }))
    .filter((c) => c.tokens.length > 0);
  const budget = choiceTokens.reduce((n, c) => n + c.tokens.length, 0) * 2 + 12;
  // Options follow the stem. The match can run on into them when they share a word or number with it.
  const start = Math.min(match.span.to + 1, match.span.from + Math.max(1, match.length - 1));
  const end = Math.min(nextFrom, tokens.length, start + budget);
  const used = new Uint8Array(tokens.length);
  const found: { id: string; at: number }[] = [];
  // Longest first, so "n log n" is claimed before "n" can match inside it.
  for (const c of [...choiceTokens].sort((a, b) => b.tokens.length - a.tokens.length)) {
    for (let i = start; i + c.tokens.length <= end; i++) {
      let ok = true;
      for (let k = 0; k < c.tokens.length && ok; k++) ok = !used[i + k] && tokens[i + k]!.value === c.tokens[k];
      if (!ok) continue;
      used.fill(1, i, i + c.tokens.length);
      found.push({ id: c.id, at: i });
      break;
    }
  }
  if (found.length < 3) return null;
  const observed = found.sort((a, b) => a.at - b.at).map((f) => f.id);
  const seenIds = new Set(observed);
  const fitting = match.items
    .filter((item) => {
      const order = (sequenceOf(item)?.list ?? []).map((c) => c.id).filter((id) => seenIds.has(id));
      return order.length === observed.length && order.every((id, k) => id === observed[k]);
    })
    .map((i) => i.attemptId);
  if (fitting.length === 0) return null;
  fitting.push(...undrawnIfUnsure(match, attemptIds));
  if (new Set(fitting).size >= papers) return null;
  const textOf = new Map(sample.list.map((c) => [c.id, c.text.replace(/\s+/g, ' ').trim()]));
  return {
    questionId: match.questionId,
    title: match.title,
    kind: 'order',
    detail: `${sample.noun} listed in this order`,
    sequence: observed.map((id) => textOf.get(id) ?? id),
    fitting: [...new Set(fitting)],
    papers,
  };
}

/** Coverage at which a recognised question is trusted enough to rule out papers that never drew it. */
const SURE_COVERAGE = 0.75;

/**
 * Papers that never drew the question. A detail about it can only rule them out when the match is sure: a loose
 * match may be a different question, and the real source may not have this one at all.
 */
function undrawnIfUnsure(match: QuestionMatch, attemptIds: string[]): string[] {
  if (match.span.coverage >= SURE_COVERAGE) return [];
  const drew = new Set(match.items.map((i) => i.attemptId));
  return attemptIds.filter((id) => !drew.has(id));
}

function excerpt(clean: string, tokens: Token[], span: Span): string {
  const text = clean.slice(tokens[span.from]!.start, tokens[span.to]!.end).replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

/**
 * Recognises the exam questions in a leaked text and works out which papers it is consistent with, per exam.
 * Exams where no question is recognised are left out.
 */
export function traceVariants(raw: string, items: PaperItem[]): ExamTrace[] {
  const clean = cleanText(raw);
  const tokens = tokenize(clean);
  if (tokens.length === 0) return [];
  const traces: ExamTrace[] = [];

  for (const [examId, examItems] of groupBy(items, (i) => i.examId)) {
    const attemptIds = [...new Set(examItems.map((i) => i.attemptId))].sort();
    const papers = attemptIds.length;
    const matches: QuestionMatch[] = [];
    for (const [questionId, questionItems] of groupBy(examItems, (i) => i.questionId)) {
      const template = questionTemplate(questionItems);
      const span = locate(tokens, template);
      if (span) matches.push({ questionId, title: questionItems[0]!.title, items: questionItems, span, length: template.length });
    }
    if (matches.length === 0) continue;
    matches.sort((a, b) => a.span.from - b.span.from);

    const observations: Observation[] = [];
    matches.forEach((match, k) => {
      const nextFrom = matches[k + 1]?.span.from ?? tokens.length;
      const drawnBy = [...new Set(match.items.map((i) => i.attemptId))];
      if (match.span.coverage >= SURE_COVERAGE && drawnBy.length < papers) {
        observations.push({
          questionId: match.questionId,
          title: match.title,
          kind: 'drawn',
          detail: `Includes this question, which ${drawnBy.length} of ${papers} papers drew`,
          fitting: drawnBy,
          papers,
        });
      }
      const numbers = numbersObservation(tokens, match, attemptIds);
      if (numbers) observations.push(numbers);
      const order = orderObservation(tokens, match, nextFrom, attemptIds);
      if (order) observations.push(order);
    });

    let fitting = attemptIds;
    for (const o of observations) {
      const set = new Set(o.fitting);
      fitting = fitting.filter((id) => set.has(id));
    }

    let closest: ExamTrace['closest'] = null;
    if (fitting.length === 0 && observations.length >= 2) {
      const fits = new Map(attemptIds.map((id) => [id, observations.filter((o) => o.fitting.includes(id)).length]));
      const most = Math.max(...fits.values());
      const group = attemptIds.filter((id) => fits.get(id) === most);
      if (most >= 2 && group.length <= 3) closest = { attemptIds: group, fits: most, of: observations.length };
    }

    const narrowed = observations.length > 0 && fitting.length > 0 && fitting.length <= NAME_LIMIT;
    const confidence: TraceConfidence =
      fitting.length === 1 && observations.length >= 2 ? 'strong' : narrowed || closest ? 'weak' : 'none';

    traces.push({
      examId,
      papers,
      questions: matches.map((m) => ({ examId, questionId: m.questionId, title: m.title, coverage: m.span.coverage, excerpt: excerpt(clean, tokens, m.span) })),
      observations,
      fitting,
      closest,
      narrowed,
      confidence,
    });
  }
  const rank = { strong: 0, weak: 1, none: 2 } as const;
  return traces.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.questions.length - a.questions.length);
}

/** Which of one paper's question stems appear in the text (for an exact attribution). */
export function matchedStems(raw: string, paper: PaperItem[]): { position: number; title: string; coverage: number }[] {
  const tokens = tokenize(cleanText(raw));
  const out: { position: number; title: string; coverage: number }[] = [];
  for (const item of paper) {
    const span = locate(tokens, stemTemplate(item));
    if (span) out.push({ position: item.position, title: item.title, coverage: span.coverage });
  }
  return out.sort((a, b) => a.position - b.position);
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

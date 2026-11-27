import { createHash } from 'node:crypto';
import type { QuestionType } from '@athena/shared';
import { parseNumber } from '../question-types/numeric';

/**
 * Answer-similarity analytics (IC-5.1). Pure functions over plain data.
 *
 * Objective items: two candidates who share the same *wrong* answers, especially rare ones, are unusual; shared
 * right answers are expected and ignored. Each shared wrong response is weighted by its rarity,
 *   w = -ln(share of the respondents to that exact item content who gave the same wrong response),
 * a pair's score is the sum of its weights, and the score is compared with every other pair as a z-score.
 * Only uncommon wrong answers count at all: ones given by at most 15% of the candidates who answered (and, in groups
 * too small for 15% to reach three people, by the pair alone). Common mistakes are expected and say nothing.
 * Only pairs that saw the same item content are compared, so parameterized variants never match by accident; the
 * one exception is the same wrong number on papers with different numbers, which counts when equally uncommon.
 *
 * Written items: character 5-gram shingles of normalized text, compared with Jaccard similarity, minus any text
 * every candidate was given (the stem, starter code). Matching passages are returned for highlighting.
 *
 * These are statistics for a human reviewer: common revision notes produce the same patterns.
 */

// ---------------------------------------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------------------------------------

/** JSON with object keys sorted, so equal values always serialize identically. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .filter((k) => obj[k] !== undefined)
          .map((k) => [k, sort(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value)) ?? 'null';
}

/** Arrays whose order is per-candidate presentation (shuffles), not content. */
const PRESENTATION_ARRAYS = ['options', 'answers', 'items', 'prompts'] as const;

const idOf = (v: unknown) => (v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : stableStringify(v));

/**
 * Identity of an item as the candidate saw it: type plus content, ignoring option order. Two attempts with the
 * same key were asked exactly the same thing (same variant numbers, same options), whatever order they saw.
 */
export function itemContentKey(type: string, content: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = { ...content };
  for (const key of PRESENTATION_ARRAYS) {
    const list = normalized[key];
    if (Array.isArray(list)) normalized[key] = [...list].sort((a, b) => idOf(a).localeCompare(idOf(b)));
  }
  return createHash('sha256').update(`${type}\n${stableStringify(normalized)}`).digest('hex').slice(0, 32);
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** A comparable form of an objective response, or null when unanswered (or the type is written). */
export function responseKey(type: QuestionType, response: Record<string, unknown> | null | undefined): string | null {
  if (!response) return null;
  switch (type) {
    case 'single_choice':
      return typeof response.optionId === 'string' && response.optionId ? response.optionId : null;
    case 'true_false':
      return typeof response.value === 'boolean' ? String(response.value) : null;
    case 'multiple_choice': {
      const ids = Array.isArray(response.optionIds) ? response.optionIds.map(String).sort() : [];
      return ids.length ? ids.join(',') : null;
    }
    case 'numeric': {
      const raw = String(response.value ?? '').trim();
      if (!raw) return null;
      const n = parseNumber(raw);
      return n === null ? squash(raw) : String(n);
    }
    case 'short_text': {
      const s = squash(String(response.text ?? ''));
      return s || null;
    }
    case 'fill_blanks': {
      const blanks = (response.blanks ?? {}) as Record<string, unknown>;
      const entries = Object.entries(blanks)
        .map(([k, v]) => [k, squash(String(v ?? ''))] as const)
        .filter(([, v]) => v)
        .sort(([a], [b]) => a.localeCompare(b));
      return entries.length ? stableStringify(Object.fromEntries(entries)) : null;
    }
    case 'matching': {
      const pairs = (response.pairs ?? {}) as Record<string, unknown>;
      const entries = Object.entries(pairs)
        .filter(([, v]) => v != null)
        .sort(([a], [b]) => a.localeCompare(b));
      return entries.length ? stableStringify(Object.fromEntries(entries)) : null;
    }
    case 'ordering':
      return Array.isArray(response.order) && response.order.length ? response.order.map(String).join('>') : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Distribution helpers
// ---------------------------------------------------------------------------------------------------------

export interface Distribution {
  /** Pairs compared. */
  pairs: number;
  mean: number;
  sd: number;
  p95: number;
  max: number;
  /** Enough pairs and spread for a z-score to mean anything. */
  enough: boolean;
  histogram: { from: number; to: number; count: number }[];
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function describe(values: number[], bins = 12, minPairs = 10): Distribution {
  const n = values.length;
  if (n === 0) return { pairs: 0, mean: 0, sd: 0, p95: 0, max: 0, enough: false, histogram: [] };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sorted = [...values].sort((a, b) => a - b);
  const max = sorted[n - 1]!;
  const p95 = sorted[Math.min(n - 1, Math.floor(0.95 * (n - 1)))]!;
  const width = max > 0 ? max / bins : 1;
  const histogram = Array.from({ length: max > 0 ? bins : 1 }, (_, i) => ({ from: round(i * width), to: round((i + 1) * width), count: 0 }));
  for (const v of values) histogram[Math.min(histogram.length - 1, Math.floor(v / width))]!.count++;
  return { pairs: n, mean: round(mean), sd: round(sd), p95: round(p95), max: round(max), enough: n >= minPairs && sd > 1e-9, histogram };
}

// ---------------------------------------------------------------------------------------------------------
// Objective items
// ---------------------------------------------------------------------------------------------------------

export interface ObjectiveResponse {
  attemptId: string;
  /** itemContentKey of what this candidate saw. */
  itemKey: string;
  /** The bank question behind it. Different itemKeys of one question are parameter variants. */
  questionKey?: string;
  /** responseKey of what they answered. */
  responseKey: string;
  /** Full marks on the item. */
  correct: boolean;
  answeredAt: Date | null;
}

export interface SharedWrongAnswer {
  itemKey: string;
  responseKey: string;
  /** Candidates who answered this exact item content. */
  respondents: number;
  /** How many of them gave this same wrong response (the pair included). */
  count: number;
  share: number;
  /** Rarity weight, -ln(share). */
  weight: number;
  /** Time between the two candidates' answers, when both are known. */
  apartMs: number | null;
  /**
   * The two papers had different numbers (parameter variants) yet the same wrong answer:
   * the classic sign of a number copied from someone else's paper.
   */
  crossVariant: boolean;
  /** The second candidate's item when it differs (cross-variant matches). */
  itemKeyB?: string;
}

export interface ObjectivePair {
  a: string;
  b: string;
  score: number;
  z: number | null;
  /** Items both answered with the same content. */
  comparableItems: number;
  /** Items both got wrong, with any response. */
  bothWrong: number;
  sharedWrong: SharedWrongAnswer[];
  /** Share of the shared wrong answers given within 2 minutes of each other (null when times are unknown). */
  within2Min: number | null;
  flagged: boolean;
}

export interface ObjectiveOptions {
  zThreshold?: number;
  minShared?: number;
  minPairs?: number;
  uncommonShare?: number;
}

export const OBJECTIVE_DEFAULTS = { zThreshold: 3, minShared: 3, minPairs: 10, uncommonShare: 0.15 } as const;

/**
 * Whether a wrong answer given by `count` of `respondents` candidates (the pair included) is uncommon enough to be
 * evidence: at most `share` of them gave it. Below the group size where that share reaches three people (20 at
 * 15%), only an answer the pair alone gave counts, so a percentage of a handful never decides it.
 */
export function isUncommon(count: number, respondents: number, share: number = OBJECTIVE_DEFAULTS.uncommonShare): boolean {
  return count <= Math.max(2, Math.floor(share * respondents + 1e-9));
}
const TWO_MINUTES = 2 * 60_000;

/** Every pair's rarity-weighted shared-wrong score, its z against all comparable pairs, and the flagged pairs. */
export function analyzeObjective(
  responses: ObjectiveResponse[],
  options: ObjectiveOptions = {},
): { pairs: ObjectivePair[]; distribution: Distribution } {
  const opts = { ...OBJECTIVE_DEFAULTS, ...options };
  const ids = [...new Set(responses.map((r) => r.attemptId))].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const N = ids.length;
  const key = (i: number, j: number) => (i < j ? i * N + j : j * N + i);

  const byItem = new Map<string, Map<string, ObjectiveResponse>>();
  for (const r of responses) {
    let group = byItem.get(r.itemKey);
    if (!group) byItem.set(r.itemKey, (group = new Map()));
    group.set(r.attemptId, r);
  }

  const comparable = new Map<number, number>();
  const bothWrong = new Map<number, number>();
  const shared = new Map<number, SharedWrongAnswer[]>();
  const score = new Map<number, number>();

  // How often each wrong answer was given across every variant of a parameterized question. A value many people
  // typed is a common mistake (a default, a forgotten step) even when few of them had the same numbers.
  const acrossQuestion = new Map<string, { respondents: number; wrong: Map<string, number> }>();
  for (const groupMap of byItem.values()) {
    for (const r of groupMap.values()) {
      if (!r.questionKey) continue;
      let q = acrossQuestion.get(r.questionKey);
      if (!q) acrossQuestion.set(r.questionKey, (q = { respondents: 0, wrong: new Map() }));
      q.respondents++;
      if (!r.correct) q.wrong.set(r.responseKey, (q.wrong.get(r.responseKey) ?? 0) + 1);
    }
  }
  const uncommonAcrossQuestion = (r: ObjectiveResponse) => {
    const q = r.questionKey ? acrossQuestion.get(r.questionKey) : undefined;
    return !q || isUncommon(q.wrong.get(r.responseKey) ?? 0, q.respondents, opts.uncommonShare);
  };

  for (const [itemKey, groupMap] of byItem) {
    const group = [...groupMap.values()];
    const n = group.length;
    for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) {
      const k = key(index.get(group[x]!.attemptId)!, index.get(group[y]!.attemptId)!);
      comparable.set(k, (comparable.get(k) ?? 0) + 1);
    }
    const wrong = group.filter((r) => !r.correct);
    for (let x = 0; x < wrong.length; x++) for (let y = x + 1; y < wrong.length; y++) {
      const k = key(index.get(wrong[x]!.attemptId)!, index.get(wrong[y]!.attemptId)!);
      bothWrong.set(k, (bothWrong.get(k) ?? 0) + 1);
    }
    const buckets = new Map<string, ObjectiveResponse[]>();
    for (const r of wrong) {
      const list = buckets.get(r.responseKey);
      if (list) list.push(r);
      else buckets.set(r.responseKey, [r]);
    }
    for (const [responseKey, bucket] of buckets) {
      if (bucket.length < 2) continue;
      // Common mistakes are expected: an answer counts only when it is uncommon among those who saw this content
      // and, for parameterized questions, among everyone who answered the question.
      if (!isUncommon(bucket.length, n, opts.uncommonShare) || !uncommonAcrossQuestion(bucket[0]!)) continue;
      const share = bucket.length / n;
      const weight = -Math.log(share);
      if (weight <= 0) continue; // everyone gave it: no information
      for (let x = 0; x < bucket.length; x++) for (let y = x + 1; y < bucket.length; y++) {
        const ra = bucket[x]!;
        const rb = bucket[y]!;
        const k = key(index.get(ra.attemptId)!, index.get(rb.attemptId)!);
        score.set(k, (score.get(k) ?? 0) + weight);
        const apartMs = ra.answeredAt && rb.answeredAt ? Math.abs(ra.answeredAt.getTime() - rb.answeredAt.getTime()) : null;
        const entry: SharedWrongAnswer = { itemKey, responseKey, respondents: n, count: bucket.length, share: round(share, 4), weight: round(weight), apartMs, crossVariant: false };
        const list = shared.get(k);
        if (list) list.push(entry);
        else shared.set(k, [entry]);
      }
    }
  }

  // Parameterized questions: the same wrong answer typed on papers with different numbers.
  const byQuestion = new Map<string, ObjectiveResponse[]>();
  for (const groupMap of byItem.values()) {
    for (const r of groupMap.values()) {
      if (!r.questionKey) continue;
      const list = byQuestion.get(r.questionKey);
      if (list) list.push(r);
      else byQuestion.set(r.questionKey, [r]);
    }
  }
  for (const group of byQuestion.values()) {
    if (new Set(group.map((r) => r.itemKey)).size < 2) continue; // one variant only: handled above
    const n = group.length;
    // Pairs on different variants of the question are comparable too.
    for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) {
      const ra = group[x]!;
      const rb = group[y]!;
      if (ra.itemKey === rb.itemKey) continue;
      const k = key(index.get(ra.attemptId)!, index.get(rb.attemptId)!);
      comparable.set(k, (comparable.get(k) ?? 0) + 1);
      if (!ra.correct && !rb.correct) bothWrong.set(k, (bothWrong.get(k) ?? 0) + 1);
    }
    const buckets = new Map<string, ObjectiveResponse[]>();
    for (const r of group) {
      if (r.correct) continue;
      const list = buckets.get(r.responseKey);
      if (list) list.push(r);
      else buckets.set(r.responseKey, [r]);
    }
    for (const [responseKey, bucket] of buckets) {
      if (bucket.length < 2) continue;
      if (!isUncommon(bucket.length, n, opts.uncommonShare)) continue; // a common value across the question
      const share = bucket.length / n;
      const weight = -Math.log(share);
      if (weight <= 0) continue;
      for (let x = 0; x < bucket.length; x++) for (let y = x + 1; y < bucket.length; y++) {
        const ra = bucket[x]!;
        const rb = bucket[y]!;
        if (ra.itemKey === rb.itemKey) continue; // same paper content: counted above
        const k = key(index.get(ra.attemptId)!, index.get(rb.attemptId)!);
        score.set(k, (score.get(k) ?? 0) + weight);
        const apartMs = ra.answeredAt && rb.answeredAt ? Math.abs(ra.answeredAt.getTime() - rb.answeredAt.getTime()) : null;
        const [first, second] = ra.attemptId < rb.attemptId ? [ra, rb] : [rb, ra];
        const entry: SharedWrongAnswer = {
          itemKey: first.itemKey,
          itemKeyB: second.itemKey,
          responseKey,
          respondents: n,
          count: bucket.length,
          share: round(share, 4),
          weight: round(weight),
          apartMs,
          crossVariant: true,
        };
        const list = shared.get(k);
        if (list) list.push(entry);
        else shared.set(k, [entry]);
      }
    }
  }

  const keys = [...comparable.keys()];
  const distribution = describe(
    keys.map((k) => score.get(k) ?? 0),
    12,
    opts.minPairs,
  );
  // describe() rounds; z uses the exact moments.
  const values = keys.map((k) => score.get(k) ?? 0);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length));

  const pairs: ObjectivePair[] = [];
  for (const k of keys) {
    const sharedWrong = (shared.get(k) ?? []).sort((p, q) => q.weight - p.weight);
    if (sharedWrong.length === 0) continue;
    const s = score.get(k) ?? 0;
    const z = distribution.enough ? (s - mean) / sd : null;
    const timed = sharedWrong.filter((w) => w.apartMs !== null);
    pairs.push({
      a: ids[Math.floor(k / N)]!,
      b: ids[k % N]!,
      score: round(s),
      z: z === null ? null : round(z, 2),
      comparableItems: comparable.get(k) ?? 0,
      bothWrong: bothWrong.get(k) ?? 0,
      sharedWrong,
      within2Min: timed.length ? round(timed.filter((w) => w.apartMs! <= TWO_MINUTES).length / timed.length, 3) : null,
      flagged: z !== null && z >= opts.zThreshold && sharedWrong.length >= opts.minShared,
    });
  }
  pairs.sort((p, q) => q.score - p.score);
  return { pairs, distribution };
}

// ---------------------------------------------------------------------------------------------------------
// Written items
// ---------------------------------------------------------------------------------------------------------

export const SHINGLE_SIZE = 5;
export const WRITTEN_DEFAULTS = { threshold: 0.45, minChars: 80, minPassage: 20 } as const;

/** Zero-width characters used by paper fingerprints (see @athena/shared integrity). */
const FINGERPRINT_CHAR = /[​‌‍⁠⁣⁤]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export interface NormalizedText {
  /** Lowercase letters and digits with single spaces between runs. */
  norm: string;
  /** map[k] = index in the original text of normalized character k. */
  map: number[];
}

/** Lowercases, drops fingerprints, turns punctuation and whitespace runs into one space, and keeps offsets. */
export function normalizeText(text: string): NormalizedText {
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const at = i;
    i += ch.length;
    if (FINGERPRINT_CHAR.test(ch)) continue;
    if (WORD_CHAR.test(ch)) {
      for (const unit of ch.toLocaleLowerCase()) {
        norm += unit;
        map.push(at);
      }
    } else if (norm.length && !norm.endsWith(' ')) {
      norm += ' ';
      map.push(at);
    }
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

export function shingles(norm: string, k = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + k <= norm.length; i++) out.add(norm.slice(i, i + k));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

/** [start, end) offsets in the original text. */
export interface Passage {
  start: number;
  end: number;
}

/** Runs of `text` covered by shingles that also occur in `other`, merged, mapped back to original offsets. */
export function sharedPassages(text: string, t: NormalizedText, other: Set<string>, minLength: number = WRITTEN_DEFAULTS.minPassage, k = SHINGLE_SIZE): Passage[] {
  const covered = new Uint8Array(t.norm.length);
  for (let i = 0; i + k <= t.norm.length; i++) if (other.has(t.norm.slice(i, i + k))) covered.fill(1, i, i + k);
  const out: Passage[] = [];
  for (let i = 0; i < covered.length; ) {
    if (!covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < covered.length && covered[j]) j++;
    if (j - i >= minLength) {
      let start = t.map[i]!;
      const last = t.map[j - 1]!;
      let end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
      // Snap to whole words so a reviewer never sees a highlight start or stop mid-word.
      while (start > 0 && SNAP_CHAR.test(text[start - 1]!)) start--;
      while (end < text.length && SNAP_CHAR.test(text[end]!)) end++;
      const prev = out.at(-1);
      // Passages separated only by spaces or punctuation read as one.
      if (prev && (start <= prev.end || !/[\p{L}\p{N}]/u.test(text.slice(prev.end, start)))) prev.end = Math.max(prev.end, end);
      else out.push({ start, end });
    }
    i = j;
  }
  return out;
}

const SNAP_CHAR = /[\p{L}\p{N}_]/u;

export interface WrittenResponse {
  attemptId: string;
  /** Answers compared with each other: same question and field (response or working). */
  groupKey: string;
  text: string;
  /** Text every candidate was given (stem, starter code). Its shingles are ignored. */
  baseline?: string;
}

export interface WrittenPair {
  a: string;
  b: string;
  groupKey: string;
  jaccard: number;
  aPassages: Passage[];
  bPassages: Passage[];
  flagged: boolean;
}

export interface WrittenOptions {
  threshold?: number;
  minChars?: number;
  minPassage?: number;
}

/** Jaccard over 5-gram shingles for every pair in each group; flagged pairs carry their matching passages. */
export function analyzeWritten(
  responses: WrittenResponse[],
  options: WrittenOptions = {},
): { pairs: WrittenPair[]; distribution: Distribution } {
  const opts = { ...WRITTEN_DEFAULTS, ...options };
  const groups = new Map<string, { r: WrittenResponse; t: NormalizedText; set: Set<string> }[]>();
  const baselines = new Map<string, Set<string>>();
  for (const r of responses) {
    const t = normalizeText(r.text);
    if (t.norm.length < opts.minChars) continue;
    let base = baselines.get(r.groupKey);
    if (!base) baselines.set(r.groupKey, (base = shingles(normalizeText(r.baseline ?? '').norm)));
    const set = shingles(t.norm);
    for (const s of base) set.delete(s);
    // The candidate's own text (what is left after the question and starter code) must reach the minimum too.
    if (set.size < opts.minChars - SHINGLE_SIZE + 1) continue;
    const list = groups.get(r.groupKey);
    const entry = { r, t, set };
    if (list) list.push(entry);
    else groups.set(r.groupKey, [entry]);
  }

  const values: number[] = [];
  const pairs: WrittenPair[] = [];
  for (const [groupKey, list] of groups) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const A = list[x]!;
      const B = list[y]!;
      if (A.r.attemptId === B.r.attemptId) continue;
      // Exact for every pair (not only likely ones), so the distribution shown to reviewers is honest.
      const j = jaccard(A.set, B.set);
      values.push(j);
      if (j < opts.threshold) continue;
      const [a, b] = A.r.attemptId < B.r.attemptId ? [A, B] : [B, A];
      pairs.push({
        a: a.r.attemptId,
        b: b.r.attemptId,
        groupKey,
        jaccard: round(j, 4),
        aPassages: sharedPassages(a.r.text, a.t, b.set, opts.minPassage),
        bPassages: sharedPassages(b.r.text, b.t, a.set, opts.minPassage),
        flagged: true,
      });
    }
  }
  pairs.sort((p, q) => q.jaccard - p.jaccard);
  const distribution = describe(values, 10, 3);
  return { pairs, distribution };
}

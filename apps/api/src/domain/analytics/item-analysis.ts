import type { QuestionType } from '@athena/shared';
import {
  cronbachAlpha,
  discriminationIndex,
  extremeGroups,
  histogram,
  kr20,
  mean,
  median,
  pointBiserial,
  reliabilityBand,
  round,
  sampleSd,
  type HistogramBin,
} from './stats';

/**
 * Classical test theory item analysis. Everything here is pure: the analytics service loads real (non-sandbox),
 * submitted attempts and hands them over as plain records.
 */

export interface AttemptRecord {
  attemptId: string;
  /** Score over graded items and the max of those items (equals the final score once grading is complete). */
  score: number;
  max: number;
  complete: boolean;
}

export interface ItemObservation {
  attemptId: string;
  /** Combined answer + working score; null while a part awaits a human. */
  score: number | null;
  /** marks + workingMarks of this item. */
  max: number;
  answered: boolean;
  flagged: boolean;
  timeSpentMs: number;
  /** Option ids picked (choice types only). */
  selected: string[] | null;
  sectionId: string | null;
}

export interface ItemDefinition {
  questionId: string;
  /** Exam order label, e.g. "Q4". */
  label: string;
  number: number;
  title: string;
  type: QuestionType;
  category: string | null;
  /** Authored option order (letters A, B, C... follow it), for choice types. */
  options: { id: string; text: string }[] | null;
  /** Keyed option ids, for choice types. */
  correct: string[] | null;
}

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface Insight {
  questionId: string | null;
  label: string | null;
  severity: InsightSeverity;
  kind:
    | 'miskey'
    | 'negative_discrimination'
    | 'weak_discrimination'
    | 'strong_item'
    | 'too_easy'
    | 'too_hard'
    | 'skipped'
    | 'long_time'
    | 'flagged'
    | 'dead_distractor'
    | 'low_reliability'
    | 'good_reliability'
    | 'pending_grading'
    | 'small_sample';
  title: string;
  detail: string;
}

export interface DistractorOption {
  id: string;
  letter: string;
  text: string;
  isKey: boolean;
  count: number;
  upper: number;
  lower: number;
  /** Shares of the respective group, 0-1. */
  share: number;
  upperShare: number;
  lowerShare: number;
}

export interface DistractorAnalysis {
  n: number;
  upperSize: number;
  lowerSize: number;
  options: DistractorOption[];
  omitted: { count: number; upper: number; lower: number };
}

export interface ItemAnalysis {
  questionId: string;
  label: string;
  number: number;
  title: string;
  type: QuestionType;
  category: string | null;
  attempts: number;
  answered: number;
  graded: number;
  skipRate: number;
  maxScore: number;
  meanScore: number | null;
  meanPercent: number | null;
  /** Difficulty index p: mean score fraction (proportion correct for 0/1 items). Higher = easier. */
  difficulty: number | null;
  /** Upper 27% minus lower 27% mean score fraction. */
  discrimination: number | null;
  upperMean: number | null;
  lowerMean: number | null;
  /** Corrected item-total (point-biserial) correlation. */
  pointBiserial: number | null;
  avgTimeMs: number | null;
  flaggedRate: number;
  dichotomous: boolean;
  distractors: DistractorAnalysis | null;
  insights: Insight[];
}

export interface Reliability {
  method: 'KR-20' | 'Cronbach alpha';
  value: number | null;
  items: number;
  n: number;
  band: ReturnType<typeof reliabilityBand>;
  note: string | null;
}

export interface ExamSummary {
  n: number;
  complete: number;
  pending: number;
  maxScore: number | null;
  score: { mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null };
  percent: { mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null };
  passPercent: number | null;
  passed: number;
  passRate: number | null;
  reliability: Reliability;
  histogram: HistogramBin[];
}

export const MIN_SAMPLE = 5;
const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice', 'true_false'];
const letter = (i: number) => String.fromCharCode(65 + i);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt2 = (x: number) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

const percentOf = (a: AttemptRecord) => (a.max > 0 ? (a.score / a.max) * 100 : 0);

/** Options for the distractor table; true/false is treated as a two-option item. */
function optionList(def: ItemDefinition): { id: string; text: string }[] | null {
  if (def.type === 'true_false') return [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
  return def.options;
}

export function analyzeDistractors(
  def: ItemDefinition,
  observations: readonly ItemObservation[],
  totals: ReadonlyMap<string, number>,
): DistractorAnalysis | null {
  const options = optionList(def);
  if (!CHOICE_TYPES.includes(def.type) || !options?.length) return null;
  const key = new Set(def.correct ?? []);
  const rows = observations.map((o) => ({ o, total: totals.get(o.attemptId) ?? 0 }));
  const { upper, lower } = extremeGroups(rows);
  const upperIds = new Set(upper.map((r) => r.o.attemptId));
  const lowerIds = new Set(lower.map((r) => r.o.attemptId));
  const n = observations.length;

  const out: DistractorOption[] = options.map((opt, i) => {
    let count = 0;
    let u = 0;
    let l = 0;
    for (const o of observations) {
      if (!o.selected?.includes(opt.id)) continue;
      count++;
      if (upperIds.has(o.attemptId)) u++;
      if (lowerIds.has(o.attemptId)) l++;
    }
    return {
      id: opt.id,
      letter: letter(i),
      text: opt.text,
      isKey: key.has(opt.id),
      count,
      upper: u,
      lower: l,
      share: n ? count / n : 0,
      upperShare: upperIds.size ? u / upperIds.size : 0,
      lowerShare: lowerIds.size ? l / lowerIds.size : 0,
    };
  });
  const omittedRows = observations.filter((o) => !o.selected?.length);
  return {
    n,
    upperSize: upperIds.size,
    lowerSize: lowerIds.size,
    options: out,
    omitted: {
      count: omittedRows.length,
      upper: omittedRows.filter((o) => upperIds.has(o.attemptId)).length,
      lower: omittedRows.filter((o) => lowerIds.has(o.attemptId)).length,
    },
  };
}

/** Rule-based, plain-language findings for one item. Thresholds follow common item-analysis practice. */
export function itemInsights(a: Omit<ItemAnalysis, 'insights'>, typicalTimeMs: number | null): Insight[] {
  const out: Insight[] = [];
  const base = { questionId: a.questionId, label: a.label };
  const n = a.graded;
  if (n < MIN_SAMPLE) {
    if (a.attempts > 0) {
      out.push({ ...base, severity: 'info', kind: 'small_sample', title: 'Too few graded answers to judge', detail: `Only ${n} graded answer${n === 1 ? '' : 's'} so far; statistics firm up from ${MIN_SAMPLE}.` });
    }
    return out;
  }

  const d = a.distractors;
  if (d && d.upperSize > 0 && (a.type === 'single_choice' || a.type === 'true_false')) {
    const keyOpt = d.options.find((o) => o.isKey);
    const rival = d.options.filter((o) => !o.isKey).sort((x, y) => y.upper - x.upper)[0];
    if (keyOpt && rival && rival.upper >= 2 && rival.upper > keyOpt.upper) {
      out.push({
        ...base,
        severity: 'critical',
        kind: 'miskey',
        title: `${a.label} may be miskeyed`,
        detail: `High scorers chose ${rival.letter} more often than the key ${keyOpt.letter} (${rival.upper} vs ${keyOpt.upper} of the top ${d.upperSize}). Check the key and the wording.`,
      });
    }
  }
  if (d && d.upperSize > 0 && a.type === 'multiple_choice') {
    const suspect = d.options.find((o) => !o.isKey && o.upperShare >= 0.6 && o.upperShare > o.lowerShare);
    if (suspect) {
      out.push({
        ...base,
        severity: 'critical',
        kind: 'miskey',
        title: `${a.label} may be miskeyed`,
        detail: `${pct(suspect.upperShare)} of high scorers selected ${suspect.letter}, which is not in the key. Check whether it should be.`,
      });
    }
  }

  const dichotomous = a.dichotomous;
  if (a.discrimination !== null && a.discrimination < -0.05) {
    out.push({
      ...base,
      severity: 'critical',
      kind: 'negative_discrimination',
      title: 'Negative discrimination',
      detail: `Lower scorers did better than higher scorers on ${a.label} (D = ${fmt2(a.discrimination)}). Usually a wrong key or misleading wording.`,
    });
  }
  if (a.difficulty !== null && a.difficulty >= 0.9) {
    out.push({
      ...base,
      severity: 'info',
      kind: 'too_easy',
      title: dichotomous ? `Too easy (${pct(a.difficulty)} correct)` : `Very easy (mean ${pct(a.difficulty)})`,
      detail: 'Almost everyone earned the marks, so it tells you little about who has mastered the topic.',
    });
  } else if (a.difficulty !== null && a.difficulty <= 0.3) {
    out.push({
      ...base,
      severity: 'warning',
      kind: 'too_hard',
      title: dichotomous ? `Very hard (${pct(a.difficulty)} correct)` : `Very hard (mean ${pct(a.difficulty)})`,
      detail: 'Few candidates earned the marks. Check that the topic was taught and the question is clear.',
    });
  }
  const inUsefulRange = a.difficulty !== null && a.difficulty > 0.3 && a.difficulty < 0.9;
  if (a.discrimination !== null && a.discrimination >= -0.05 && a.discrimination < 0.15 && inUsefulRange) {
    out.push({
      ...base,
      severity: 'info',
      kind: 'weak_discrimination',
      title: 'Weak discrimination',
      detail: `Strong and weak candidates scored about the same on ${a.label} (D = ${fmt2(a.discrimination)}).`,
    });
  }
  if (a.discrimination !== null && a.discrimination >= 0.4 && inUsefulRange) {
    out.push({
      ...base,
      severity: 'positive',
      kind: 'strong_item',
      title: 'Strong discriminator',
      detail: `${a.label} separates well-prepared candidates from the rest (D = ${fmt2(a.discrimination)}). A good question to keep.`,
    });
  }
  if (a.skipRate >= 0.2) {
    out.push({
      ...base,
      severity: 'warning',
      kind: 'skipped',
      title: `Frequently skipped (${pct(a.skipRate)})`,
      detail: 'Many candidates left it blank: it may be too long, placed too late, or unclear.',
    });
  }
  if (a.avgTimeMs !== null && typicalTimeMs && a.avgTimeMs >= 60_000 && a.avgTimeMs >= 2 * typicalTimeMs) {
    out.push({
      ...base,
      severity: 'info',
      kind: 'long_time',
      title: 'Long time spent',
      detail: `Candidates spent ${formatDuration(a.avgTimeMs)} on average, ${(a.avgTimeMs / typicalTimeMs).toFixed(1)}× the typical question.`,
    });
  }
  if (a.flaggedRate >= 0.25) {
    out.push({
      ...base,
      severity: 'info',
      kind: 'flagged',
      title: `Flagged by ${pct(a.flaggedRate)} of candidates`,
      detail: 'Candidates marked it for review: the wording may be unclear.',
    });
  }
  if (d && d.n >= 10 && a.type === 'single_choice') {
    const dead = d.options.filter((o) => !o.isKey && o.share < 0.05);
    if (dead.length) {
      out.push({
        ...base,
        severity: 'info',
        kind: 'dead_distractor',
        title: dead.length === 1 ? `Distractor ${dead[0]!.letter} attracts almost nobody` : `${dead.length} distractors attract almost nobody`,
        detail: `${dead.map((o) => `${o.letter} (“${o.text.slice(0, 40)}”)`).join(', ')} chosen by under 5%. A more plausible option would make the item more informative.`,
      });
    }
  }
  return out;
}

export function analyzeItems(
  defs: readonly ItemDefinition[],
  observationsByItem: ReadonlyMap<string, readonly ItemObservation[]>,
  attempts: readonly AttemptRecord[],
): ItemAnalysis[] {
  const byAttempt = new Map(attempts.map((a) => [a.attemptId, a]));
  const totals = new Map(attempts.map((a) => [a.attemptId, percentOf(a)]));

  const partial = defs.map((def) => {
    const obs = (observationsByItem.get(def.questionId) ?? []).filter((o) => byAttempt.has(o.attemptId));
    const graded = obs.filter((o) => o.score !== null);
    const maxScore = obs.length ? Math.max(...obs.map((o) => o.max)) : 0;
    const fractions = graded.map((o) => (o.max > 0 ? o.score! / o.max : 0));
    const difficulty = mean(fractions);
    const disc = discriminationIndex(graded.map((o) => ({ item: o.max > 0 ? o.score! / o.max : 0, total: totals.get(o.attemptId) ?? 0 })));
    // Corrected item-total correlation: the item is removed from the total it is correlated with.
    const rest = graded.map((o) => {
      const att = byAttempt.get(o.attemptId)!;
      const restMax = att.max - o.max;
      return restMax > 0 ? (att.score - o.score!) / restMax : 0;
    });
    const times = obs.map((o) => o.timeSpentMs).filter((t) => t > 0);
    const dichotomous = graded.length > 0 && graded.every((o) => o.score === 0 || Math.abs(o.score! - o.max) < 1e-9);
    const analysis: Omit<ItemAnalysis, 'insights'> = {
      questionId: def.questionId,
      label: def.label,
      number: def.number,
      title: def.title,
      type: def.type,
      category: def.category,
      attempts: obs.length,
      answered: obs.filter((o) => o.answered).length,
      graded: graded.length,
      skipRate: obs.length ? obs.filter((o) => !o.answered).length / obs.length : 0,
      maxScore,
      meanScore: round(mean(graded.map((o) => o.score!))),
      meanPercent: difficulty === null ? null : round(difficulty * 100, 1),
      difficulty: round(difficulty),
      discrimination: disc ? round(disc.d) : null,
      upperMean: disc ? round(disc.upper) : null,
      lowerMean: disc ? round(disc.lower) : null,
      pointBiserial: round(pointBiserial(fractions, rest)),
      avgTimeMs: times.length ? Math.round(mean(times)!) : null,
      flaggedRate: obs.length ? obs.filter((o) => o.flagged).length / obs.length : 0,
      dichotomous,
      distractors: analyzeDistractors(def, obs, totals),
    };
    return analysis;
  });

  const typicalTime = median(partial.map((p) => p.avgTimeMs).filter((t): t is number => t !== null));
  return partial.map((p) => ({ ...p, insights: itemInsights(p, typicalTime) }));
}

/**
 * Reliability over the questions every included candidate answered (papers drawn from pools differ, and the
 * coefficients need a complete person x item matrix). KR-20 when every such item is scored 0/1, otherwise alpha.
 */
export function computeReliability(
  defs: readonly ItemDefinition[],
  observationsByItem: ReadonlyMap<string, readonly ItemObservation[]>,
  attempts: readonly AttemptRecord[],
): Reliability {
  const pool = attempts.filter((a) => a.complete);
  const people = pool.length >= 3 ? pool : attempts;
  const ids = people.map((p) => p.attemptId);
  const common: { def: ItemDefinition; byAttempt: Map<string, ItemObservation> }[] = [];
  for (const def of defs) {
    const map = new Map((observationsByItem.get(def.questionId) ?? []).filter((o) => o.score !== null).map((o) => [o.attemptId, o]));
    if (ids.every((id) => map.has(id))) common.push({ def, byAttempt: map });
  }
  const dichotomous = common.every(({ byAttempt }) => [...byAttempt.values()].every((o) => o.score === 0 || Math.abs(o.score! - o.max) < 1e-9));
  const method: Reliability['method'] = dichotomous ? 'KR-20' : 'Cronbach alpha';
  if (people.length < 3 || common.length < 2) {
    return {
      method,
      value: null,
      items: common.length,
      n: people.length,
      band: null,
      note: people.length < 3 ? 'Needs at least three graded attempts.' : 'Needs at least two questions that every candidate answered.',
    };
  }
  const matrix = ids.map((id) =>
    common.map(({ byAttempt }) => {
      const o = byAttempt.get(id)!;
      return dichotomous ? (o.score! > 0 ? 1 : 0) : o.score!;
    }),
  );
  const value = round(dichotomous ? kr20(matrix) : cronbachAlpha(matrix));
  return {
    method,
    value,
    items: common.length,
    n: people.length,
    band: reliabilityBand(value),
    note: common.length < defs.length ? `Computed over the ${common.length} questions every candidate received.` : null,
  };
}

export function summarizeExam(
  defs: readonly ItemDefinition[],
  observationsByItem: ReadonlyMap<string, readonly ItemObservation[]>,
  attempts: readonly AttemptRecord[],
  passPercent: number | null,
): ExamSummary {
  const percents = attempts.map(percentOf);
  const scores = attempts.map((a) => a.score);
  const maxes = attempts.map((a) => a.max);
  const passed = passPercent === null ? 0 : percents.filter((p) => p >= passPercent - 1e-9).length;
  return {
    n: attempts.length,
    complete: attempts.filter((a) => a.complete).length,
    pending: attempts.filter((a) => !a.complete).length,
    maxScore: maxes.length ? Math.max(...maxes) : null,
    score: {
      mean: round(mean(scores), 2),
      median: round(median(scores), 2),
      sd: round(sampleSd(scores), 2),
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
    },
    percent: {
      mean: round(mean(percents), 1),
      median: round(median(percents), 1),
      sd: round(sampleSd(percents), 1),
      min: percents.length ? round(Math.min(...percents), 1) : null,
      max: percents.length ? round(Math.max(...percents), 1) : null,
    },
    passPercent,
    passed,
    passRate: passPercent === null || !attempts.length ? null : round(passed / attempts.length, 3),
    reliability: computeReliability(defs, observationsByItem, attempts),
    histogram: histogram(percents, 10, 0, 100),
  };
}

/** Exam-level findings that complement the per-item ones. */
export function examInsights(summary: ExamSummary): Insight[] {
  const out: Insight[] = [];
  const r = summary.reliability;
  if (r.value !== null && r.value < 0.6) {
    out.push({
      questionId: null,
      label: null,
      severity: 'warning',
      kind: 'low_reliability',
      title: `Low reliability (${r.method} ${r.value.toFixed(2)})`,
      detail: 'Scores carry a lot of noise. More questions, or questions that discriminate better, would make rankings more trustworthy.',
    });
  } else if (r.value !== null && r.value >= 0.8) {
    out.push({
      questionId: null,
      label: null,
      severity: 'positive',
      kind: 'good_reliability',
      title: `Reliable scores (${r.method} ${r.value.toFixed(2)})`,
      detail: 'Questions measure a consistent skill, so the ranking of candidates is dependable.',
    });
  }
  if (summary.pending > 0) {
    out.push({
      questionId: null,
      label: null,
      severity: 'info',
      kind: 'pending_grading',
      title: `${summary.pending} attempt${summary.pending === 1 ? '' : 's'} still being graded`,
      detail: 'Their scores count graded parts only, so figures will shift as grading finishes.',
    });
  }
  return out;
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };

/** All insights, most important first. */
export function rankInsights(items: readonly ItemAnalysis[], exam: readonly Insight[]): Insight[] {
  return [...exam, ...items.flatMap((i) => i.insights)]
    .filter((i) => i.kind !== 'small_sample')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

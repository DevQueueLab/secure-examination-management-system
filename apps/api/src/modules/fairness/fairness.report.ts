import { DIFFICULTY_PRIOR, type Difficulty, type QuestionType } from '@athena/shared';
import { isPool, PRIOR_WEIGHT, type PaperSection, type PaperSimulation, type SelectableQuestion } from '../../domain/paper';
import { ACHIEVABLE_SHARE, deviationFrom, jaccardToSharedShare, round, sharedHistogram } from './fairness.math';
import type { ExposureRow, FairnessSimulationReport, PoolInfo, SimulatedAssembly } from './fairness.types';

/**
 * Turns two Monte Carlo runs of the paper engine (balanced and random assembly of the same exam) into the
 * fairness report. Pure: the service loads the exam and calls simulatePapers; everything shown is derived here.
 */

export interface QuestionMeta {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  sectionTitle: string;
}

/** The difficulty model the engine balances with: label priors blended with real results. */
export function engineCalibration(): FairnessSimulationReport['calibration'] {
  return { priorWeight: PRIOR_WEIGHT, labelPriors: { ...DIFFICULTY_PRIOR } };
}

export function summarizeAssembly(sim: PaperSimulation): SimulatedAssembly {
  return {
    spread: {
      meanPercent: sim.spread.meanPercent,
      sdPercent: sim.spread.stdDevPercent,
      minPercent: sim.spread.minPercent,
      maxPercent: sim.spread.maxPercent,
      rangePercent: round(sim.spread.maxPercent - sim.spread.minPercent),
    },
    deviation: deviationFrom(sim.papers, sim.targetPercent),
    withinTolerance: sim.spread.withinTolerance,
    overlap: {
      meanJaccard: sim.overlap.mean,
      minJaccard: sim.overlap.min,
      maxJaccard: sim.overlap.max,
      sharedShare: jaccardToSharedShare(sim.overlap.mean),
      pairs: sim.overlap.pairs,
      sampled: sim.overlap.sampled,
    },
  };
}

export function buildSimulationReport(input: {
  sections: PaperSection<SelectableQuestion>[];
  sectionTitles: ReadonlyMap<string, string>;
  questions: ReadonlyMap<string, QuestionMeta>;
  balanced: PaperSimulation;
  random: PaperSimulation;
}): Omit<FairnessSimulationReport, 'exam' | 'generatedAt' | 'hasQuestions'> {
  const { balanced, random } = input;
  const sorted = [...input.sections].sort((a, b) => a.position - b.position);
  const pools: PoolInfo[] = sorted.filter(isPool).map((s) => ({
    sectionId: s.id,
    title: input.sectionTitles.get(s.id) ?? 'Section',
    drawCount: s.drawCount!,
    poolSize: s.questions.length,
  }));
  const questionsPerPaper = sorted.reduce((n, s) => n + (isPool(s) ? s.drawCount! : s.questions.length), 0);

  const histogram = sharedHistogram({ balanced: balanced.papers, random: random.papers });
  const randomRate = new Map(random.exposure.map((e) => [e.questionId, e.rate]));
  const sectionById = new Map(sorted.map((s) => [s.id, s]));
  const exposure: ExposureRow[] = balanced.exposure.map((e) => {
    const section = sectionById.get(e.sectionId)!;
    const pooled = isPool(section);
    const meta = input.questions.get(e.questionId);
    return {
      questionId: e.questionId,
      label: meta?.label ?? '',
      title: meta?.title ?? 'Question',
      type: meta?.type ?? 'single_choice',
      difficulty: e.difficulty,
      sectionId: e.sectionId,
      sectionTitle: meta?.sectionTitle ?? input.sectionTitles.get(e.sectionId) ?? 'Section',
      pooled,
      expectedP: e.expectedP,
      balancedRate: e.rate,
      randomRate: randomRate.get(e.questionId) ?? 0,
      uniformRate: pooled ? round(section.drawCount! / section.questions.length, 4) : 1,
    };
  });

  const balancedSummary = summarizeAssembly(balanced);
  return {
    runs: balanced.runs,
    hasPools: pools.length > 0,
    pools,
    questionsPerPaper,
    totalMarks: balanced.totalMarks,
    targetPercent: balanced.targetPercent,
    balanced: balancedSummary,
    random: summarizeAssembly(random),
    histogram: {
      binWidth: histogram.binWidth,
      bins: histogram.bins.map((b) => ({ from: b.from, to: b.to, mid: b.mid, balanced: b.counts.balanced ?? 0, random: b.counts.random ?? 0 })),
    },
    tolerance: {
      configuredPercent: balanced.tolerancePercent,
      achievable: balanced.spread.withinTolerance >= ACHIEVABLE_SHARE,
      holdsAtPercent: balancedSummary.deviation.p95Percent,
      holdsForShare: ACHIEVABLE_SHARE,
      balancedShare: balanced.spread.withinTolerance,
      randomShare: random.spread.withinTolerance,
    },
    exposure,
    calibration: engineCalibration(),
  };
}

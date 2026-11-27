import { evaluate } from 'mathjs';
import type { MarkingScheme } from '@athena/shared';
import type { Rng } from '../rng';
import { BaseQuestionType } from './base';
import type { GradeOutcome, Json, PreparedItem } from './types';

type Variable = { name: string; min: number; max: number; step: number };

/** Parses "1,250.5", " -3e2 " etc. Returns null for anything that is not a plain number. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s,]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length;

function drawValue(v: Variable, rng: Rng) {
  const steps = Math.max(0, Math.floor((v.max - v.min) / v.step + 1e-9));
  const value = v.min + v.step * rng.int(steps + 1);
  return Number(value.toFixed(decimalsOf(v.step)));
}

function computeAnswer(key: Json, scope: Record<string, number>): number {
  if (typeof key.formula === 'string' && key.formula.trim()) {
    const result = evaluate(key.formula, { ...scope });
    const n = typeof result === 'number' ? result : Number(result);
    if (!Number.isFinite(n)) throw new Error('Formula did not produce a finite number');
    return n;
  }
  if (typeof key.answer !== 'number') throw new Error('Numeric question has no answer');
  return key.answer;
}

/** Numeric answers with tolerance. Parameterized variants give each candidate different numbers. */
export class NumericType extends BaseQuestionType {
  readonly type = 'numeric' as const;

  protected override crossValidate(content: Json, key: Json) {
    const vars = (content.variables as Variable[]) ?? [];
    const names = new Set<string>();
    for (const v of vars) {
      if (names.has(v.name)) this.fail(`Variable "${v.name}" is defined twice`, 'content.variables');
      if (v.max < v.min) this.fail(`Variable "${v.name}": max must be at least min`, 'content.variables');
      names.add(v.name);
    }
    if (key.answer == null && !(typeof key.formula === 'string' && key.formula.trim())) {
      this.fail('Give the answer or a formula', 'key.answer');
    }
    if (vars.length > 0 && !(typeof key.formula === 'string' && key.formula.trim())) {
      this.fail('Parameterized questions need a formula for the answer', 'key.formula');
    }
    // Prove the formula works for the extreme values before it reaches a candidate.
    for (const pick of ['min', 'max'] as const) {
      const scope = Object.fromEntries(vars.map((v) => [v.name, v[pick]]));
      try {
        computeAnswer(key, scope);
      } catch (e) {
        this.fail(`Formula check failed: ${(e as Error).message}`, 'key.formula');
      }
    }
  }

  override prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem {
    const vars = (content.variables as Variable[]) ?? [];
    const values = Object.fromEntries(vars.map((v) => [v.name, drawValue(v, ctx.rng)]));
    const stem = (content.stem as string).replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (m, name: string) =>
      name in values ? String(values[name]) : m,
    );
    const answer = computeAnswer(key, values);
    const { variables: _hidden, ...visible } = content;
    return {
      content: { ...structuredClone(visible), stem },
      answerKey: { answer, tolerance: key.tolerance },
      variant: { values },
    };
  }

  isAnswered(r: Json | null | undefined) {
    return !!r && typeof r.value === 'string' && r.value.trim() !== '';
  }

  grade(key: Json, r: Json | null | undefined, marks: number, _marking: MarkingScheme): GradeOutcome {
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const value = parseNumber(r!.value as string);
    if (value === null) return { score: 0, detail: { correct: false, unparseable: true } };
    const answer = key.answer as number;
    const tol = (key.tolerance as { type: 'absolute' | 'relative'; value: number }) ?? { type: 'absolute', value: 0 };
    const allowed = (tol.type === 'relative' ? Math.abs(answer) * tol.value : tol.value) + 1e-9;
    const correct = Math.abs(value - answer) <= allowed;
    return { score: correct ? marks : 0, detail: { correct } };
  }
}

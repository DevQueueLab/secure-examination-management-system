import type { MarkingScheme } from '@athena/shared';
import { BaseQuestionType, normalizeText } from './base';
import type { GradeOutcome, Json } from './types';

export class ShortTextType extends BaseQuestionType {
  readonly type = 'short_text' as const;
  isAnswered(r: Json | null | undefined) {
    return !!r && typeof r.text === 'string' && r.text.trim() !== '';
  }
  grade(key: Json, r: Json | null | undefined, marks: number, _m: MarkingScheme): GradeOutcome {
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const cs = Boolean(key.caseSensitive);
    const given = normalizeText(r!.text as string, cs);
    const correct = (key.accepted as string[]).some((a) => normalizeText(a, cs) === given);
    return { score: correct ? marks : 0, detail: { correct } };
  }
}

/** Written responses are graded by people with rubrics. Blank answers are scored 0 automatically. */
export class LongTextType extends BaseQuestionType {
  readonly type = 'long_text' as const;
  isAnswered(r: Json | null | undefined) {
    return !!r && typeof r.text === 'string' && r.text.trim() !== '';
  }
  grade(_key: Json, r: Json | null | undefined): GradeOutcome {
    return this.isAnswered(r) ? { score: null } : { score: 0, detail: { answered: false } };
  }
}

export class CodeType extends BaseQuestionType {
  readonly type = 'code' as const;
  isAnswered(r: Json | null | undefined) {
    return !!r && typeof r.code === 'string' && r.code.trim() !== '';
  }
  grade(_key: Json, r: Json | null | undefined): GradeOutcome {
    return this.isAnswered(r) ? { score: null } : { score: 0, detail: { answered: false } };
  }
}

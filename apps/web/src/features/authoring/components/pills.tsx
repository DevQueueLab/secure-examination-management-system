import { QUESTION_TYPE_META, type Difficulty, type QuestionType } from '@athena/shared';
import {
  AlignLeft,
  CircleDot,
  Code2,
  Hash,
  Link2,
  ListChecks,
  ListOrdered,
  RectangleEllipsis,
  TextCursorInput,
  ToggleLeft,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { MarksRule } from '@/components/ui/marks-rule';
import { cn } from '@/lib/cn';

export const QUESTION_TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single_choice: CircleDot,
  true_false: ToggleLeft,
  multiple_choice: ListChecks,
  numeric: Hash,
  short_text: TextCursorInput,
  fill_blanks: RectangleEllipsis,
  matching: Link2,
  ordering: ListOrdered,
  long_text: AlignLeft,
  code: Code2,
};

/** Compact type label with its icon. Written-answer types read "Rubric" in their tooltip text. */
export function TypePill({ type, size = 'sm', full = false, className }: { type: QuestionType; size?: 'sm' | 'md'; full?: boolean; className?: string }) {
  const Icon = QUESTION_TYPE_ICON[type];
  const meta = QUESTION_TYPE_META[type];
  return (
    <Badge size={size} tone="neutral" className={className} title={`${meta.label}, ${meta.autoGraded ? 'auto-graded' : 'graded with a rubric'}`}>
      <Icon aria-hidden />
      {full ? meta.label : meta.short}
    </Badge>
  );
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
/** Graphite for every level: difficulty is a measurement, not a warning. */
export const DIFFICULTY_TONE: Record<Difficulty, Tone> = { easy: 'neutral', medium: 'neutral', hard: 'neutral' };
/** Share of marks (%) a question of each authored difficulty should see candidates earn: the gold band on the rule. */
export const DIFFICULTY_TARGET: Record<Difficulty, readonly [number, number]> = { easy: [70, 95], medium: [40, 70], hard: [15, 40] };

export function DifficultyPill({ difficulty, size = 'sm', className }: { difficulty: Difficulty; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Badge size={size} tone={DIFFICULTY_TONE[difficulty]} className={className}>
      {DIFFICULTY_LABEL[difficulty]}
    </Badge>
  );
}

/**
 * Observed difficulty: the share of marks candidates earned on this question, as a needle on a graphite micro rule.
 * Given the authored difficulty, a gold band marks the share that level should see, so a misjudged question shows at a glance.
 */
export function ObservedBar({ p, n, difficulty, className }: { p: number | null; n: number; difficulty?: Difficulty; className?: string }) {
  if (p === null || n === 0) return <span className={cn('text-footnote text-label-tertiary', className)}>No data</span>;
  const pct = Math.round(p * 100);
  const band = difficulty ? DIFFICULTY_TARGET[difficulty] : undefined;
  const target = band && difficulty ? `; ${DIFFICULTY_LABEL[difficulty].toLowerCase()} questions aim for ${band[0]} to ${band[1]}%` : '';
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={`${pct}% of marks earned across ${n} ${n === 1 ? 'answer' : 'answers'}${target}`}>
      <MarksRule size="sm" tone="neutral" value={pct} max={100} band={band} label="Marks earned" valueText={`${pct}% of marks earned, from ${n} ${n === 1 ? 'answer' : 'answers'}${target}`} className="w-16 shrink-0" />
      <span aria-hidden className="text-footnote tabular-nums text-label-secondary">
        {pct}%
      </span>
    </span>
  );
}

export function CategoryDot({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', !color && 'bg-label-quaternary', className)} style={color ? { background: color } : undefined} />;
}

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
export const DIFFICULTY_TONE: Record<Difficulty, Tone> = { easy: 'success', medium: 'warning', hard: 'danger' };

export function DifficultyPill({ difficulty, size = 'sm', className }: { difficulty: Difficulty; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Badge size={size} tone={DIFFICULTY_TONE[difficulty]} dot className={className}>
      {DIFFICULTY_LABEL[difficulty]}
    </Badge>
  );
}

/**
 * Observed difficulty: the share of marks real candidates earned on this question.
 * A thin bar plus the percentage; the sample size is in the label so a 100% from two candidates reads as weak evidence.
 */
export function ObservedBar({ p, n, className }: { p: number | null; n: number; className?: string }) {
  if (p === null || n === 0) return <span className={cn('text-footnote text-label-tertiary', className)}>No data</span>;
  const pct = Math.round(p * 100);
  const tone = pct >= 75 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger';
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={`${pct}% of marks earned across ${n} real ${n === 1 ? 'answer' : 'answers'}`}>
      <span aria-hidden className="relative h-1.5 w-14 overflow-hidden rounded-full bg-fill">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.max(pct, 3)}%` }} />
      </span>
      <span className="text-footnote tabular-nums text-label-secondary">
        {pct}%<span className="sr-only"> of marks earned, from {n} answers</span>
      </span>
    </span>
  );
}

export function CategoryDot({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', !color && 'bg-label-quaternary', className)} style={color ? { background: color } : undefined} />;
}

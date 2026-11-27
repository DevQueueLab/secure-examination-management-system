import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { Insight, InsightSeverity } from '../types';

export const SEVERITY: Record<InsightSeverity, { tone: Tone; word: string; icon: typeof Info; rank: number; color: string }> = {
  critical: { tone: 'danger', word: 'Review', icon: CircleAlert, rank: 0, color: 'text-danger' },
  warning: { tone: 'warning', word: 'Check', icon: TriangleAlert, rank: 1, color: 'text-warning' },
  info: { tone: 'info', word: 'Note', icon: Info, rank: 2, color: 'text-info' },
  positive: { tone: 'success', word: 'Good', icon: CircleCheck, rank: 3, color: 'text-success' },
};

export const worstInsight = (list: Insight[]) => [...list].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank)[0] ?? null;

export function InsightBadge({ insight, className }: { insight: Insight; className?: string }) {
  const s = SEVERITY[insight.severity];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} size="sm" className={cn('max-w-full', className)}>
      <Icon aria-hidden />
      <span className="truncate">{insight.title}</span>
    </Badge>
  );
}

/** Plain-language findings, most serious first. */
export function InsightList({ insights, onOpen, limit }: { insights: Insight[]; onOpen?: (questionId: string) => void; limit?: number }) {
  const list = [...insights].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank).slice(0, limit);
  return (
    <ul className="flex flex-col divide-y divide-separator">
      {list.map((i, idx) => {
        const s = SEVERITY[i.severity];
        const Icon = s.icon;
        const body = (
          <>
            <Icon aria-label={s.word} className={cn('mt-0.5 size-4 shrink-0', s.color)} />
            <div className="min-w-0 flex-1">
              <p className="text-callout font-medium text-label">
                {i.label && !i.title.startsWith(i.label) ? <span className="tabular-nums">{i.label}: </span> : null}
                {i.title}
              </p>
              <p className="mt-0.5 text-footnote text-label-secondary">{i.detail}</p>
            </div>
          </>
        );
        return (
          <li key={`${i.kind}-${i.questionId ?? 'exam'}-${idx}`} className="py-3 first:pt-0 last:pb-0">
            {i.questionId && onOpen ? (
              <button type="button" onClick={() => onOpen(i.questionId!)} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-fill-secondary focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus">
                {body}
              </button>
            ) : (
              <div className="flex items-start gap-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

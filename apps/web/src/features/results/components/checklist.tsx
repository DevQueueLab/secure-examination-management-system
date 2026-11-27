import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ChecklistItem, ChecklistLevel } from '../types';

const LEVEL: Record<ChecklistLevel, { icon: typeof CircleCheck; className: string; word: string }> = {
  ok: { icon: CircleCheck, className: 'text-success', word: 'Done' },
  info: { icon: Info, className: 'text-label-tertiary', word: 'Note' },
  warning: { icon: TriangleAlert, className: 'text-warning', word: 'Check' },
  blocker: { icon: CircleAlert, className: 'text-danger', word: 'Blocks publishing' },
};

/** One pre-publication check. The icon has a spoken word, so colour never carries the meaning alone. */
export function ChecklistRow({ item, compact = false, action }: { item: ChecklistItem; compact?: boolean; action?: ReactNode }) {
  const { icon: Icon, className, word } = LEVEL[item.level];
  return (
    <li className="flex items-start gap-2.5">
      <Icon aria-label={word} className={cn('mt-0.5 size-4 shrink-0', className)} />
      <div className="min-w-0">
        <p className={cn('text-callout text-label', item.level === 'blocker' && 'font-medium')}>{item.label}</p>
        {!compact && item.detail && <p className="text-footnote text-label-secondary">{item.detail}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </li>
  );
}

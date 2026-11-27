'use client';

import type { QuestionType } from '@athena/shared';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SkeletonRows } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useQuestionVersions } from '../../api';
import { RichText } from '../../components/rich-text';
import { formatWhen } from '../../lib/datetime';
import { plural } from '../../lib/format';
import type { QuestionVersion } from '../../types';
import type { Json, Option } from './draft';

/** A one-line answer key summary, so versions can be told apart without opening each. */
function keySummary(type: QuestionType, content: Json, key: Json): string {
  const text = (list: Option[] | undefined, id: string) => list?.find((o) => o.id === id)?.text ?? id;
  switch (type) {
    case 'single_choice':
      return `Correct: ${text(content.options, key.correct)}`;
    case 'multiple_choice':
      return `Correct: ${(key.correct as string[]).map((id) => text(content.options, id)).join(', ')}`;
    case 'true_false':
      return `Correct: ${key.correct ? 'True' : 'False'}`;
    case 'numeric':
      return key.formula
        ? `Formula: ${key.formula}${key.tolerance?.value ? ` (± ${key.tolerance.type === 'relative' ? `${key.tolerance.value * 100}%` : key.tolerance.value})` : ''}`
        : `Answer: ${key.answer}${key.tolerance?.value ? ` ± ${key.tolerance.type === 'relative' ? `${key.tolerance.value * 100}%` : key.tolerance.value}` : ''}`;
    case 'short_text':
      return `Accepts: ${(key.accepted as string[]).join(', ')}`;
    case 'fill_blanks':
      return Object.entries(key.blanks as Record<string, string[]>)
        .map(([id, a]) => `${id}: ${a.join(' / ')}`)
        .join('; ');
    case 'matching':
      return `${Object.keys(key.pairs ?? {}).length} pairs, ${(content.answers?.length ?? 0) - Object.keys(key.pairs ?? {}).length} distractors`;
    case 'ordering':
      return `Order: ${(key.order as string[]).map((id, i) => `${i + 1}. ${text(content.items, id)}`).join(', ')}`;
    default:
      return key.sampleAnswer ? 'Has a model answer' : 'No model answer';
  }
}

/**
 * Every saved version of a question, newest first. Exams pin a version, so this also shows which versions
 * are still in use. "Load into editor" copies an old version into the form; saving makes it the newest.
 */
export function VersionHistorySheet({
  questionId,
  type,
  open,
  onOpenChange,
  onLoad,
}: {
  questionId: string;
  type: QuestionType;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLoad: (v: QuestionVersion) => void;
}) {
  const versions = useQuestionVersions(questionId, open);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Version history" description="Each content change saves a new version. Exams keep the version they were built with until you update them.">
        {!versions.data ? (
          <SkeletonRows rows={4} />
        ) : versions.data.items.length === 0 ? (
          <EmptyState size="sm" icon={<History />} title="No versions" description="Save the question to create its first version." />
        ) : (
          <ol className="flex flex-col gap-2">
            {versions.data.items.map((v) => {
              const expanded = openId === v.id || (openId === null && v.isCurrent);
              return (
                <li key={v.id} className={cn('flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-xs', expanded && 'ring-1 ring-separator-strong')}>
                  <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpenId(expanded ? '' : v.id)} aria-expanded={expanded}>
                    <span className="text-headline tabular-nums text-label">v{v.version}</span>
                    {v.isCurrent && (
                      <Badge size="sm" tone="accent">
                        Current
                      </Badge>
                    )}
                    {v.pinnedBy > 0 && (
                      <Badge size="sm" tone="neutral">
                        In {plural(v.pinnedBy, 'exam')}
                      </Badge>
                    )}
                    <span className="ml-auto text-footnote text-label-secondary">{formatWhen(v.createdAt)}</span>
                  </button>
                  <p className="flex flex-col text-footnote text-label-secondary">
                    <span>{v.createdBy?.name ?? 'Someone'}</span>
                    <span className="text-label">{keySummary(type, v.content, v.key)}</span>
                  </p>
                  {expanded && (
                    <div className="flex flex-col gap-3 border-t border-separator pt-3">
                      <RichText className="text-callout">{String(v.content.stem ?? '')}</RichText>
                      {!v.isCurrent && (
                        <div>
                          <Button variant="tinted" size="sm" onClick={() => onLoad(v)}>
                            Load into editor
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { Library, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useExamStructure, useQuestions } from '../api';
import { DifficultyPill, ObservedBar, TypePill } from '../components/pills';
import { formatMarks, plural, stemExcerpt } from '../lib/format';
import type { ExamDetail, QuestionFilters, QuestionListItem } from '../types';
import { QuestionFilterBar } from '../questions/question-filters';

/**
 * Pick questions from the bank into a section. Questions already in this exam are hidden by the API
 * (excludeExamId), and selections survive filtering so you can gather from several searches.
 */
export function AddFromBankDialog({ exam, sectionId, onClose }: { exam: ExamDetail; sectionId: string; onClose: () => void }) {
  const [filters, setFilters] = useState<QuestionFilters>({ status: 'active', excludeExamId: exam.id, page: 1, pageSize: 50, sort: 'updated' });
  const [picked, setPicked] = useState<Map<string, QuestionListItem>>(new Map());
  const [target, setTarget] = useState(sectionId);
  const list = useQuestions(filters);
  const { addQuestions } = useExamStructure(exam.id);
  const items = list.data?.items ?? [];
  const pickedMarks = [...picked.values()].reduce((s, q) => s + q.defaultMarks, 0);

  const toggle = (q: QuestionListItem) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(q.id)) next.delete(q.id);
      else next.set(q.id, q);
      return next;
    });

  const add = () =>
    addQuestions.mutate(
      { sectionId: target, questionIds: [...picked.keys()] },
      {
        onSuccess: (r) => {
          const section = exam.sections.find((s) => s.id === target);
          toast.success(`Added ${plural(r.added.length, 'question')} to ${section?.title ?? 'the section'}`);
          if (r.skipped.length) toast.warning(`${plural(r.skipped.length, 'question')} skipped: ${r.skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}`);
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="xl" className="max-h-[min(52rem,calc(100dvh-2rem))]">
        <DialogHeader title="Add from the bank" description="Questions already in this exam are hidden. Each question is pinned at its current version with its default marks." />
        <DialogBody className="flex min-h-0 flex-col gap-4">
          <QuestionFilterBar filters={filters} onChange={(f) => setFilters({ ...f, excludeExamId: exam.id, status: 'active' })} showStatus={false} showSort={false} />
          <div className={cn('min-h-64 overflow-hidden rounded-xl bg-surface-sunken transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            {list.isError ? (
              <p className="p-6 text-center text-callout text-danger-text">{errorMessage(list.error)}</p>
            ) : !list.data ? (
              <div className="p-4">
                <SkeletonRows rows={6} />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                size="sm"
                surface={false}
                icon={<Library />}
                title="Nothing to add here"
                description="Every matching question is already in this exam, or none match these filters."
                action={
                  <Button asChild variant="tinted" size="sm">
                    <Link href="/questions/new" target="_blank">
                      Write a new question
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="max-h-[26rem] divide-y divide-separator overflow-y-auto" aria-label="Questions">
                {items.map((q) => {
                  const on = picked.has(q.id);
                  return (
                    <li key={q.id}>
                      <label className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-fill-secondary', on && 'bg-accent-tint hover:bg-accent-tint')}>
                        <Checkbox checked={on} onCheckedChange={() => toggle(q)} aria-label={`Select ${q.title}`} className="mt-0.5" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-callout font-medium text-label">{q.title}</span>
                          <span className="truncate text-footnote text-label-secondary">{stemExcerpt(q.stem, 140)}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 sm:flex">
                          <TypePill type={q.type} />
                          <DifficultyPill difficulty={q.difficulty} />
                          <span className="hidden w-32 md:block">
                            <ObservedBar p={q.observedP} n={q.observedN} />
                          </span>
                          <span className="w-14 text-right text-footnote tabular-nums text-label-secondary">{formatMarks(q.defaultMarks)} mk</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {list.data && list.data.total > items.length && (
            <p className="text-footnote text-label-secondary">Showing {items.length} of {list.data.total}. Narrow the filters to find more.</p>
          )}
        </DialogBody>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {exam.sections.length > 1 && (
              <Field label="Into section" className="w-56">
                <Select size="sm" value={target} onValueChange={setTarget} options={exam.sections.map((s) => ({ value: s.id, label: s.title }))} />
              </Field>
            )}
            <span className="text-footnote text-label-secondary">
              {picked.size ? `${plural(picked.size, 'question')} selected, ${formatMarks(pickedMarks)} marks` : 'Nothing selected'}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="filled" disabled={!picked.size} loading={addQuestions.isPending} onClick={add}>
              <Plus aria-hidden /> Add {picked.size ? plural(picked.size, 'question') : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

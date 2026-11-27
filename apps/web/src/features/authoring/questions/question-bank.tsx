'use client';

import { Archive, ArchiveRestore, FileUp, Fingerprint, Library, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { Can, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { useBulkQuestionStatus, useQuestions } from '../api';
import { LoadError } from '../components/load-error';
import { CategoryDot, DifficultyPill, ObservedBar, TypePill } from '../components/pills';
import { plural, stemExcerpt } from '../lib/format';
import type { QuestionFilters, QuestionListItem } from '../types';
import { QuestionFilterBar, hasActiveFilters } from './question-filters';

const PAGE_SIZE = 25;

export function QuestionBank() {
  const router = useRouter();
  const { can } = useAuth();
  const manage = can('questions.manage');
  const confirm = useConfirm();
  const [filters, setFilters] = useState<QuestionFilters>({ status: 'active', sort: 'updated', page: 1, pageSize: PAGE_SIZE });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const query = useQuestions(filters);
  const bulk = useBulkQuestionStatus();
  const data = query.data;
  const archivedView = filters.status === 'archived';
  const reduced = useReducedMotion();
  // Rows only rise in once the first batch has been seen; the shell already animates the page itself in.
  const seen = useRef(false);
  const hasRows = (query.data?.items.length ?? 0) > 0;
  useEffect(() => {
    if (hasRows) seen.current = true;
  }, [hasRows]);

  const changeFilters = (next: QuestionFilters) => {
    setFilters(next);
    setSelected(new Set());
  };
  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((q) => selected.has(q.id));
  const someOnPage = items.some((q) => selected.has(q.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async () => {
    const ids = [...selected];
    const action = archivedView ? 'restore' : 'archive';
    if (action === 'archive') {
      const ok = await confirm({
        title: `Archive ${plural(ids.length, 'question')}?`,
        description: 'Archived questions leave the bank and can’t be added to new exams. Exams that already use them keep their pinned version. You can restore them any time.',
        confirmLabel: 'Archive',
        destructive: true,
      });
      if (!ok) return;
    }
    bulk.mutate(
      { ids, action },
      {
        onSuccess: (r) => {
          toast.success(`${plural(r.updated, 'question')} ${action === 'archive' ? 'archived' : 'restored'}`);
          setSelected(new Set());
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Question bank"
        subtitle="Reusable questions for every exam in your organization. Each edit is a new version; exams keep the one they were built with."
        actions={
          <Can permission="questions.manage">
            <Button asChild variant="gray">
              <Link href="/questions/import">
                <FileUp aria-hidden /> Import
              </Link>
            </Button>
            <Button asChild variant="filled">
              <Link href="/questions/new">
                <Plus aria-hidden /> New question
              </Link>
            </Button>
          </Can>
        }
      />

      <QuestionFilterBar filters={filters} onChange={changeFilters} className="mb-4" />

      <AnimatePresence>
      {selected.size > 0 && (
        <motion.div
          key="bulk"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pl-[264px]"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 72 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 72 }}
          transition={reduced ? { duration: 0.15 } : spring.sheet}
        >
        <div className="material pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-4 py-2.5 shadow-lg ring-1 ring-separator" role="region" aria-label="Bulk actions">
          <span className="text-callout font-medium text-label">{plural(selected.size, 'question')} selected</span>
          <Button variant="plain" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button variant={archivedView ? 'tinted' : 'destructive-tinted'} size="sm" className="ml-auto" loading={bulk.isPending} onClick={runBulk}>
            {archivedView ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archivedView ? 'Restore' : 'Archive'}
          </Button>
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      {query.isError ? (
        <LoadError error={query.error} what="question bank" onRetry={() => void query.refetch()} />
      ) : !data ? (
        <div className="rounded-xl bg-surface p-4 shadow-xs" aria-busy aria-label="Loading questions">
          <SkeletonRows rows={8} />
        </div>
      ) : items.length === 0 ? (
        hasActiveFilters(filters) ? (
          <EmptyState
            icon={<SearchX />}
            title={archivedView ? 'No archived questions' : 'No questions match'}
            description={archivedView ? 'Questions you archive appear here and can be restored.' : 'Try fewer filters, or search for words in the question text.'}
            action={
              <Button variant="gray" onClick={() => changeFilters({ status: 'active', sort: filters.sort, page: 1, pageSize: PAGE_SIZE })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Library />}
            title="Your question bank is empty"
            description="Write questions one at a time, or import a spreadsheet of them. Each question keeps its versions and learns how hard it is from candidates’ answers."
            action={
              manage ? (
                <div className="flex gap-2">
                  <Button asChild variant="gray">
                    <Link href="/questions/import">Import a file</Link>
                  </Button>
                  <Button asChild variant="filled">
                    <Link href="/questions/new">New question</Link>
                  </Button>
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <Table containerClassName={cn('rounded-xl bg-surface shadow-xs transition-opacity', query.isPlaceholderData && 'opacity-60')}>
            <TableHeader>
              <TableRow>
                {manage && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          for (const q of items) v === true ? next.add(q.id) : next.delete(q.id);
                          return next;
                        })
                      }
                    />
                  </TableHead>
                )}
                <TableHead>Question</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Type</TableHead>
                <TableHead className="hidden w-32 sm:table-cell">
                  <span title="Authored difficulty, and the share of marks candidates earned against the target for that difficulty">Difficulty</span>
                </TableHead>
                <TableHead className="hidden w-36 xl:table-cell">Category</TableHead>
                <TableHead numeric className="hidden w-20 md:table-cell">
                  Used in
                </TableHead>
                <TableHead numeric className="hidden w-20 lg:table-cell">
                  <span title="Times shown to candidates">Exposure</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((q, i) => (
                <BankRow key={q.id} index={i} reduced={reduced} enter={seen.current} q={q} manage={manage} selected={selected.has(q.id)} onToggle={() => toggle(q.id)} onOpen={() => router.push(`/questions/${q.id}`)} />
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-center justify-between text-footnote text-label-secondary">
            <span className="tabular-nums">
              {data.total > PAGE_SIZE ? `${(data.page - 1) * PAGE_SIZE + 1}–${Math.min(data.page * PAGE_SIZE, data.total)} of ` : ''}
              {plural(data.total, archivedView ? 'archived question' : 'question')}
            </span>
            {data.total > PAGE_SIZE && (
              <div className="flex gap-2">
                <Button variant="gray" size="sm" disabled={data.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
                  Previous
                </Button>
                <Button variant="gray" size="sm" disabled={data.page * PAGE_SIZE >= data.total} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
                  Next
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Rows FLIP to their new place when filters or search change; rows that arrive rise in, staggered (enter only). */
const MotionRow = motion.create(TableRow);

function BankRow({ q, index, reduced, enter, manage, selected, onToggle, onOpen }: { q: QuestionListItem; index: number; reduced: boolean; enter: boolean; manage: boolean; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <MotionRow
      interactive
      selected={selected}
      onClick={onOpen}
      className="cursor-pointer"
      layout={reduced ? false : 'position'}
      initial={reduced || !enter ? false : { opacity: 0.25, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.smooth, delay: reduced ? 0 : Math.min(index, 8) * 0.03 }}
    >
      {manage && (
        <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
          <Checkbox aria-label={`Select ${q.title}`} checked={selected} onCheckedChange={onToggle} />
        </TableCell>
      )}
      <TableCell className="max-w-0">
        <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link href={`/questions/${q.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-callout font-medium text-label hover:underline">
              {q.title}
            </Link>
            {q.leakedAt && (
              <Badge size="sm" tone="danger" title="Marked as leaked by the leak tracer">
                <Fingerprint aria-hidden /> Leaked
              </Badge>
            )}
            {q.currentVersion > 1 && <span className="shrink-0 text-caption tabular-nums text-label-tertiary">v{q.currentVersion}</span>}
          </span>
          <span className="truncate text-footnote text-label-secondary">{stemExcerpt(q.stem, 160)}</span>
          {/* On phones the type and difficulty columns fold in here, so the title keeps the width. */}
          <span className="flex flex-wrap items-center gap-1.5 pt-1 sm:hidden">
            <TypePill type={q.type} />
            <DifficultyPill difficulty={q.difficulty} />
          </span>
          {q.tags.length > 0 && (
            <span className="flex gap-1.5 truncate text-caption text-label-tertiary">
              {q.tags.slice(0, 4).map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {q.tags.length > 4 && <span>+{q.tags.length - 4}</span>}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <TypePill type={q.type} />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="flex flex-col items-start gap-1.5 py-0.5">
          <DifficultyPill difficulty={q.difficulty} />
          {q.observedP !== null && q.observedN > 0 && <ObservedBar p={q.observedP} n={q.observedN} difficulty={q.difficulty} />}
        </div>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        {q.category ? (
          <span className="flex min-w-0 items-center gap-2 text-callout text-label-secondary">
            <CategoryDot color={q.category.color} />
            <span className="truncate">{q.category.name}</span>
          </span>
        ) : (
          <span className="text-callout text-label-tertiary">None</span>
        )}
      </TableCell>
      <TableCell numeric className="hidden md:table-cell">
        <span className={cn('text-callout', q.usageCount ? 'text-label' : 'text-label-tertiary')}>{q.usageCount || '–'}</span>
      </TableCell>
      <TableCell numeric className="hidden lg:table-cell">
        <span className={cn('text-callout', q.exposureCount ? 'text-label' : 'text-label-tertiary')} title="Times shown to candidates">
          {q.exposureCount || '–'}
        </span>
      </TableCell>
    </MotionRow>
  );
}

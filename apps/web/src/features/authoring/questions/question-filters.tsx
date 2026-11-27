'use client';

import { DIFFICULTIES, QUESTION_TYPES, QUESTION_TYPE_META, type Difficulty, type QuestionType } from '@athena/shared';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SearchField } from '@/features/admin/components/search-field';
import { cn } from '@/lib/cn';
import { useCategories, useTags } from '../api';
import { DIFFICULTY_LABEL } from '../components/pills';
import type { QuestionFilters } from '../types';

const ALL = '__all';

/** Search plus type, difficulty, category and tag filters. Shared by the bank and the "Add from bank" picker. */
export function QuestionFilterBar({
  filters,
  onChange,
  showStatus = true,
  showSort = true,
  className,
}: {
  filters: QuestionFilters;
  onChange: (next: QuestionFilters) => void;
  showStatus?: boolean;
  showSort?: boolean;
  className?: string;
}) {
  const categories = useCategories();
  const tags = useTags();
  const set = (patch: Partial<QuestionFilters>) => onChange({ ...filters, ...patch, page: 1 });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField label="Search questions" placeholder="Search titles and question text" value={filters.q ?? ''} onChange={(q) => set({ q: q || undefined })} className="md:max-w-sm" />
        <div className="-mx-1 overflow-x-auto px-1 scrollbar-none">
          <SegmentedControl<Difficulty | typeof ALL>
            aria-label="Difficulty"
            size="sm"
            value={filters.difficulty ?? ALL}
            onValueChange={(v) => set({ difficulty: v === ALL ? undefined : v })}
            options={[{ value: ALL, label: 'Any difficulty' }, ...DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))]}
          />
        </div>
        {showStatus && (
          <SegmentedControl<'active' | 'archived'>
            aria-label="Status"
            size="sm"
            value={filters.status === 'archived' ? 'archived' : 'active'}
            onValueChange={(v) => set({ status: v })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
            className="md:ml-auto"
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Select
          aria-label="Type"
          size="sm"
          className="sm:w-48"
          value={filters.type ?? ALL}
          onValueChange={(v) => set({ type: v === ALL ? undefined : (v as QuestionType) })}
          options={[{ value: ALL, label: 'All types' }, ...QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_META[t].label }))]}
        />
        <Select
          aria-label="Category"
          size="sm"
          className="sm:w-48"
          value={filters.categoryId ?? ALL}
          onValueChange={(v) => set({ categoryId: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: 'All categories' },
            { value: 'none', label: 'Uncategorized' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, description: `${c.questionCount} active` })),
          ]}
        />
        <Select
          aria-label="Tag"
          size="sm"
          className="sm:w-44"
          value={filters.tag ?? ALL}
          onValueChange={(v) => set({ tag: v === ALL ? undefined : v })}
          options={[{ value: ALL, label: 'Any tag' }, ...(tags.data ?? []).map((t) => ({ value: t.tag, label: `#${t.tag}`, description: `${t.count}` }))]}
        />
        {showSort && (
          <Select
            aria-label="Sort"
            size="sm"
            className="sm:ml-auto sm:w-48"
            value={filters.sort ?? 'updated'}
            onValueChange={(v) => onChange({ ...filters, sort: v as QuestionFilters['sort'] })}
            options={[
              { value: 'updated', label: 'Recently updated' },
              { value: 'title', label: 'Title A–Z' },
              { value: 'usage', label: 'Most used' },
              { value: 'difficulty', label: 'Difficulty' },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function hasActiveFilters(f: QuestionFilters): boolean {
  return !!(f.q || f.type || f.difficulty || f.categoryId || f.tag || (f.status && f.status !== 'active'));
}

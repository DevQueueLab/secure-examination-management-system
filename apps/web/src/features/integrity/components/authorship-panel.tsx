'use client';

import { FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { count, pct } from '../format';
import type { IntegrityOverview, WrittenAnswerView } from '../types';
import { CompositionBar } from './composition-bar';
import { ReplayPlayer } from './replay-player';

interface Entry extends WrittenAnswerView {
  candidateName: string;
  rollNumber: string | null;
  external: number;
}

/** Every written answer with an authorship log, most pasted first, next to the replay of the selected one. */
export function AuthorshipPanel({
  data,
  selected,
  onSelect,
}: {
  data: IntegrityOverview;
  selected: string | null;
  onSelect: (answerId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo<Entry[]>(() => {
    const all = data.attempts.flatMap((a) =>
      a.written.map((w) => {
        const c = w.composition;
        const external = c && c.total > 0 ? (c.pasted + c.burst) / c.total : (w.summary?.externalShare ?? 0);
        return { ...w, candidateName: a.candidate.name, rollNumber: a.candidate.rollNumber, external };
      }),
    );
    return all.sort((x, y) => y.external - x.external || x.candidateName.localeCompare(y.candidateName));
  }, [data.attempts]);

  const replayable = useMemo(() => entries.filter((e) => e.hasReplay), [entries]);
  const unlogged = entries.length - replayable.length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? replayable.filter((e) => e.candidateName.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)) : replayable;
  }, [replayable, query]);

  if (replayable.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No written answers yet"
        description="Essays, short answers, code and shown working record how they were written. Each one can be replayed here once a candidate starts typing."
      />
    );
  }

  const current = replayable.find((e) => e.answerId === selected) ?? replayable[0] ?? null;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-28">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a candidate or question" aria-label="Filter written answers" leading={<Search />} />
        <ul aria-label="Written answers" className="flex max-h-[34rem] flex-col overflow-y-auto rounded-xl bg-surface">
          {visible.map((e) => {
            const active = current?.answerId === e.answerId;
            return (
              <li key={e.answerId} className="border-b border-separator last:border-0">
                <button
                  type="button"
                  aria-current={active || undefined}
                  onClick={() => onSelect(e.answerId)}
                  className={cn(
                    'flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors duration-100 focus-visible:-outline-offset-2',
                    active ? 'bg-accent-tint' : 'hover:bg-fill-secondary',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={e.candidateName} size="xs" />
                    <span className="truncate text-callout font-medium text-label">{e.candidateName}</span>
                    <span className="ml-auto shrink-0 text-footnote tabular-nums text-label-secondary">
                      {e.external > 0 ? `${pct(e.external)} external` : 'Typed'}
                    </span>
                  </span>
                  <span className="truncate text-subheadline text-label-secondary">{e.label}</span>
                  <CompositionBar composition={e.composition} size="sm" labels={false} />
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-4 py-6 text-center text-callout text-label-secondary">Nothing matches “{query}”.</li>}
        </ul>
        {unlogged > 0 && (
          <p className="px-1 text-footnote text-label-tertiary">
            {count(unlogged, 'answer')} without an authorship log {unlogged === 1 ? 'is' : 'are'} not listed. One-line short answers don’t record
            one.
          </p>
        )}
      </div>
      {current ? (
        <ReplayPlayer answerId={current.answerId} />
      ) : (
        <EmptyState size="sm" icon={<FileText />} title="No replay available" description="None of these answers recorded an authorship log." />
      )}
    </div>
  );
}

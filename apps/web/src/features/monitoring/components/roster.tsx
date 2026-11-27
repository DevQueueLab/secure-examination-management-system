'use client';

import { AlarmClockPlus, Ban, Ellipsis, Flag, Megaphone, PanelRightOpen, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type SortDirection } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useServerNow } from '../clock';
import { PRIORITY_RANK, indicatorNoun } from '../format';
import type { LiveAttempt, RosterEntry } from '../types';
import type { DrawerActions } from './candidate-drawer';
import { ConnectionStatus, PriorityPill, TimeLeft, isLive } from './live-bits';
import { CountRule } from './rule';

export type StatusFilter = 'all' | 'in_progress' | 'submitted' | 'not_started' | 'awaiting_sync';
export type ConnectionFilter = 'any' | 'online' | 'offline';
export type PriorityFilter = 'any' | 'low' | 'medium' | 'high';

export interface RosterFilters {
  q: string;
  status: StatusFilter;
  connection: ConnectionFilter;
  priority: PriorityFilter;
  /** Only candidates with indicators nobody has reviewed. */
  openOnly: boolean;
}

export const NO_FILTERS: RosterFilters = { q: '', status: 'all', connection: 'any', priority: 'any', openOnly: false };

type SortKey = 'name' | 'progress' | 'time' | 'priority' | 'indicators';

const candidateOf = (e: RosterEntry) => (e.kind === 'attempt' ? e.attempt.candidate : e.candidate);

function matches(e: RosterEntry, f: RosterFilters, now: number): boolean {
  const c = candidateOf(e);
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    const email = e.kind === 'attempt' ? e.attempt.email : e.candidate.email;
    if (!c.name.toLowerCase().includes(q) && !(c.rollNumber ?? '').toLowerCase().includes(q) && !email.toLowerCase().includes(q)) return false;
  }
  if (f.status !== 'all') {
    if (f.status === 'not_started' ? e.kind !== 'not-started' : e.kind !== 'attempt' || e.attempt.status !== f.status) return false;
  }
  if (f.connection !== 'any') {
    if (e.kind !== 'attempt' || e.attempt.status !== 'in_progress') return false;
    if ((f.connection === 'online') !== isLive(e.attempt, now)) return false;
  }
  if (f.priority !== 'any' && (e.kind !== 'attempt' || PRIORITY_RANK[e.attempt.reviewPriority] < PRIORITY_RANK[f.priority])) return false;
  if (f.openOnly && (e.kind !== 'attempt' || e.attempt.incidents.open === 0)) return false;
  return true;
}

function sortValue(e: RosterEntry, key: SortKey): number | string {
  if (key === 'name') return candidateOf(e).name.toLowerCase();
  if (e.kind !== 'attempt') return -1;
  const a = e.attempt;
  switch (key) {
    case 'progress':
      return a.itemCount ? a.answeredCount / a.itemCount : 0;
    case 'time':
      // Ordering by deadline is ordering by time left, without depending on the clock.
      return a.status === 'in_progress' ? Date.parse(a.deadlineAt) : Number.MAX_SAFE_INTEGER;
    case 'priority':
      return PRIORITY_RANK[a.reviewPriority] * 1000 + a.incidents.open;
    case 'indicators':
      return a.incidents.open * 1000 + a.incidents.total;
  }
}

function Progress({ a }: { a: LiveAttempt }) {
  return (
    <div className="flex min-w-[10rem] items-center gap-3">
      <CountRule className="w-24 shrink-0" count={a.answeredCount} total={a.itemCount} muted={a.status === 'submitted'} label={`${a.candidate.name}: questions answered`} />
      <span className="text-subheadline tabular-nums text-label">
        {a.answeredCount}
        <span className="text-label-secondary">/{a.itemCount}</span>
      </span>
      {a.flaggedCount > 0 && (
        <Tooltip content={`${a.flaggedCount} flagged to revisit`}>
          <span tabIndex={0} className="inline-flex items-center gap-0.5 rounded-sm text-footnote text-label-secondary tabular-nums">
            <Flag aria-hidden className="size-3" />
            {a.flaggedCount}
            <span className="sr-only"> flagged</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function Indicators({ a }: { a: LiveAttempt }) {
  if (a.incidents.total === 0) return <span className="text-label-tertiary">—</span>;
  const breakdown = Object.entries(a.incidents.byType)
    .sort((x, y) => y[1] - x[1])
    .map(([type, n]) => indicatorNoun(type, n))
    .join(', ');
  return (
    <Tooltip content={breakdown}>
      <span tabIndex={0} className="inline-flex flex-col rounded-sm leading-tight">
        <span className={cn('text-subheadline tabular-nums', a.incidents.open ? 'font-semibold text-label' : 'text-label-secondary')}>
          {a.incidents.open ? `${a.incidents.open} to review` : 'Reviewed'}
        </span>
        <span className="text-footnote text-label-secondary tabular-nums">{a.incidents.total} total</span>
      </span>
    </Tooltip>
  );
}

function RowActions({ entry, canIntervene, onOpen, actions }: { entry: RosterEntry; canIntervene: boolean; onOpen: () => void; actions: DrawerActions }) {
  const c = candidateOf(entry);
  const a = entry.kind === 'attempt' ? entry.attempt : null;
  const active = a && a.status !== 'submitted';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<PanelRightOpen />} onSelect={onOpen}>
          {a ? 'Open timeline' : 'View details'}
        </DropdownMenuItem>
        {canIntervene && (
          <>
            <DropdownMenuItem icon={<Megaphone />} onSelect={() => actions.onMessage({ userId: c.userId, name: c.name })}>
              Message…
            </DropdownMenuItem>
            {active && (
              <>
                <DropdownMenuItem icon={<AlarmClockPlus />} onSelect={() => actions.onExtend(a)}>
                  Extend time…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Ban />} destructive onSelect={() => actions.onForceSubmit(a)}>
                  Force submit…
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Opens the drawer on a row click, but not when the click landed on a control inside the row. React events
 * bubble through portals, so a choice in the row's menu also arrives here and is ignored.
 */
const fromControl = (e: MouseEvent) => (e.target as HTMLElement).closest('button, a, [role="menuitem"], [role="menu"]') !== null;

function Toolbar({ filters, onChange, counts }: { filters: RosterFilters; onChange: (f: RosterFilters) => void; counts: Record<StatusFilter, number> }) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const filtered = filters.status !== 'all' || filters.connection !== 'any' || filters.priority !== 'any' || filters.openOnly || filters.q !== '';
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Input
        ref={searchRef}
        type="search"
        size="sm"
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filters.q) {
            e.preventDefault();
            onChange({ ...filters, q: '' });
          }
        }}
        placeholder="Name, roll number or email"
        aria-label="Search candidates"
        leading={<Search />}
        trailing={!filters.q ? <Kbd size="sm" className="mr-1.5" aria-hidden>/</Kbd> : undefined}
        containerClassName="sm:w-72"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          aria-label="Status"
          className="w-auto min-w-36"
          value={filters.status}
          onValueChange={(v) => onChange({ ...filters, status: v as StatusFilter })}
          options={[
            { value: 'all', label: `Everyone (${counts.all})` },
            { value: 'in_progress', label: `In progress (${counts.in_progress})` },
            { value: 'submitted', label: `Submitted (${counts.submitted})` },
            { value: 'not_started', label: `Not started (${counts.not_started})` },
            ...(counts.awaiting_sync ? [{ value: 'awaiting_sync', label: `Waiting for sync (${counts.awaiting_sync})` }] : []),
          ]}
        />
        <Select
          size="sm"
          aria-label="Connection"
          className="w-auto min-w-32"
          value={filters.connection}
          onValueChange={(v) => onChange({ ...filters, connection: v as ConnectionFilter })}
          options={[
            { value: 'any', label: 'Any connection' },
            { value: 'online', label: 'Online' },
            { value: 'offline', label: 'Offline' },
          ]}
        />
        <Select
          size="sm"
          aria-label="Review priority"
          className="w-auto min-w-32"
          value={filters.priority}
          onValueChange={(v) => onChange({ ...filters, priority: v as PriorityFilter })}
          options={[
            { value: 'any', label: 'Any priority' },
            { value: 'high', label: 'High priority' },
            { value: 'medium', label: 'Medium or higher' },
            { value: 'low', label: 'Low or higher' },
          ]}
        />
        {filtered && (
          <Button variant="plain" size="sm" onClick={() => onChange(NO_FILTERS)}>
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** The live roster: a sortable table on wide screens, cards on phones. */
export function Roster({
  entries,
  filters,
  onFiltersChange,
  onOpen,
  canIntervene,
  actions,
}: {
  entries: RosterEntry[];
  filters: RosterFilters;
  onFiltersChange: (f: RosterFilters) => void;
  onOpen: (entry: RosterEntry) => void;
  canIntervene: boolean;
  actions: DrawerActions;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  // Ticks once a second: someone who goes quiet leaves the "Online" filter without waiting for new data.
  const now = useServerNow();

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: entries.length, in_progress: 0, submitted: 0, not_started: 0, awaiting_sync: 0 };
    for (const e of entries) {
      if (e.kind === 'not-started') c.not_started++;
      else c[e.attempt.status]++;
    }
    return c;
  }, [entries]);

  const rows = useMemo(() => {
    const list = entries.filter((e) => matches(e, filters, now));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((x, y) => {
      const a = sortValue(x, sort.key);
      const b = sortValue(y, sort.key);
      const primary = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b);
      return primary * dir || candidateOf(x).name.localeCompare(candidateOf(y).name);
    });
  }, [entries, filters, sort, now]);

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'time' ? 'asc' : 'desc' }));
  const dirOf = (key: SortKey): SortDirection => (sort.key === key ? sort.dir : false);

  return (
    <div className="flex flex-col gap-3">
      <Toolbar filters={filters} onChange={onFiltersChange} counts={counts} />
      <p className="sr-only" role="status">
        {rows.length} of {entries.length} candidates shown
      </p>

      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Users />}
          title={entries.length ? 'No candidates match' : 'No candidates enrolled'}
          description={entries.length ? 'Try a different search or clear the filters.' : 'Enroll candidates from the Candidates tab and they appear here.'}
          action={entries.length ? <Button onClick={() => onFiltersChange(NO_FILTERS)}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          {/* Phones: one card per candidate. The name is the drawer button, stretched over the card. */}
          <ul className="flex flex-col divide-y divide-separator border-y border-separator md:hidden">
            {rows.map((e) => {
              const c = candidateOf(e);
              const a = e.kind === 'attempt' ? e.attempt : null;
              return (
                <li key={e.key} className="relative flex flex-col gap-3 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpen(e)} className="text-left text-headline text-label after:absolute after:inset-0">
                        {c.name}
                      </button>
                      <p className="text-footnote text-label-secondary tabular-nums">{c.rollNumber ?? '—'}</p>
                    </div>
                    <div className="relative z-10 flex items-center gap-1">
                      {a ? <TimeLeft attempt={a} /> : <span className="text-subheadline text-label-secondary">Not started</span>}
                      <RowActions entry={e} canIntervene={canIntervene} onOpen={() => onOpen(e)} actions={actions} />
                    </div>
                  </div>
                  {a && (
                    <>
                      <Progress a={a} />
                      {/* Only what has something to say: no placeholder dashes on a phone. */}
                      {(a.status === 'in_progress' || a.status === 'awaiting_sync' || a.reviewPriority !== 'none' || a.incidents.open > 0) && (
                        <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {(a.status === 'in_progress' || a.status === 'awaiting_sync') && <ConnectionStatus attempt={a} compact />}
                          {a.reviewPriority !== 'none' && <PriorityPill priority={a.reviewPriority} />}
                          {a.incidents.open > 0 && <span className="text-footnote font-medium text-label">{a.incidents.open} to review</span>}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <Table containerClassName="hidden rounded-none bg-transparent md:block">
            <TableHeader>
              <TableRow>
                <TableHead sort={dirOf('name')} onSort={() => sortBy('name')}>
                  Candidate
                </TableHead>
                <TableHead sort={dirOf('progress')} onSort={() => sortBy('progress')}>
                  Answered
                </TableHead>
                <TableHead sort={dirOf('time')} onSort={() => sortBy('time')}>
                  Time left
                </TableHead>
                <TableHead>Connection</TableHead>
                <TableHead sort={dirOf('priority')} onSort={() => sortBy('priority')} className="hidden lg:table-cell">
                  Priority
                </TableHead>
                <TableHead sort={dirOf('indicators')} onSort={() => sortBy('indicators')}>
                  Indicators
                </TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const c = candidateOf(e);
                const a = e.kind === 'attempt' ? e.attempt : null;
                return (
                  <TableRow key={e.key} interactive onClick={(ev) => !fromControl(ev) && onOpen(e)} className={cn(!a && 'text-label-secondary')}>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} size="sm" />
                        <div className="min-w-0">
                          <button type="button" onClick={() => onOpen(e)} className="block max-w-[14rem] truncate rounded-sm text-left font-medium text-label hover:underline">
                            {c.name}
                          </button>
                          <span className="block text-footnote text-label-secondary tabular-nums">{c.rollNumber ?? '—'}</span>
                        </div>
                      </div>
                    </TableCell>
                    {a ? (
                      <>
                        <TableCell className="py-2.5">
                          <Progress a={a} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <TimeLeft attempt={a} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <ConnectionStatus attempt={a} />
                        </TableCell>
                        <TableCell className="hidden py-2.5 lg:table-cell">
                          <PriorityPill priority={a.reviewPriority} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Indicators a={a} />
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="py-2.5 text-subheadline text-label-secondary" colSpan={2}>
                          Not started
                          {e.kind === 'not-started' && e.candidate.accommodation && <span className="text-label-secondary">, has extra time</span>}
                        </TableCell>
                        <TableCell className="py-2.5 text-label-tertiary">—</TableCell>
                        <TableCell className="hidden py-2.5 text-label-tertiary lg:table-cell">—</TableCell>
                        <TableCell className="py-2.5 text-label-tertiary">—</TableCell>
                      </>
                    )}
                    <TableCell className="py-2.5 pr-3">
                      <RowActions entry={e} canIntervene={canIntervene} onOpen={() => onOpen(e)} actions={actions} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

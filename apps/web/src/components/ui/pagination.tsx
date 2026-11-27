'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const countFormat = new Intl.NumberFormat('en-US');

/*
 * The page lives in the URL (`?page=2`) so reload and Back keep it. It is read through the
 * History API rather than `useSearchParams`, so static list pages need no Suspense boundary.
 * Next's router picks up native `replaceState` calls, so its own hooks stay in sync.
 */
const URL_EVENT = 'athena:urlparams';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(URL_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(URL_EVENT, callback);
  };
}

const readParam = (name: string) => () => new URLSearchParams(window.location.search).get(name);
const readNothing = () => null;

function toPositiveInt(raw: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/**
 * `[page, setPage]` backed by `?page=`. Page 1 drops the param to keep URLs clean.
 * Call `setPage(1)` whenever a search or filter changes.
 */
export function usePageParam(name = 'page') {
  const raw = useSyncExternalStore(subscribe, readParam(name), readNothing);
  const page = toPositiveInt(raw, 1);
  const setPage = useCallback(
    (next: number | ((current: number) => number)) => {
      const params = new URLSearchParams(window.location.search);
      const current = toPositiveInt(params.get(name), 1);
      const value = Math.max(1, Math.floor(typeof next === 'function' ? next(current) : next));
      if (value === current) return;
      if (value === 1) params.delete(name);
      else params.set(name, String(value));
      const search = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
      window.dispatchEvent(new Event(URL_EVENT));
    },
    [name],
  );
  return [page, setPage] as const;
}

/** Page size for a list: the screen's default, or `?pageSize=` (1 to `max`) when the URL sets one. */
export function usePageSizeParam(fallback: number, max = 100) {
  const raw = useSyncExternalStore(subscribe, readParam('pageSize'), readNothing);
  return toPositiveInt(raw, fallback, max);
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Names the navigation landmark, e.g. "People pages". */
  label?: string;
  className?: string;
}

/**
 * "1–25 of 132" with Previous and Next. Renders nothing when every row fits on one page,
 * and steps back to the last page when the current one runs past the end (after a delete, or a stale URL).
 */
export function Pagination({ page, pageSize, total, onPageChange, label = 'Pages', className }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const past = total > 0 && page > pages;

  useEffect(() => {
    if (past) onPageChange(pages);
  }, [past, pages, onPageChange]);

  if (total <= pageSize) return null;

  const shown = Math.min(page, pages);
  const from = (shown - 1) * pageSize + 1;
  const to = Math.min(shown * pageSize, total);

  return (
    <nav aria-label={label} className={cn('flex items-center justify-between gap-3', className)}>
      <p className="text-footnote tabular-nums text-label-secondary" aria-live="polite">
        {from === to ? countFormat.format(from) : `${countFormat.format(from)}–${countFormat.format(to)}`} of {countFormat.format(total)}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="gray" size="sm" aria-label="Previous page" disabled={shown <= 1} onClick={() => onPageChange(shown - 1)}>
          Previous
        </Button>
        <Button variant="gray" size="sm" aria-label="Next page" disabled={shown >= pages} onClick={() => onPageChange(shown + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

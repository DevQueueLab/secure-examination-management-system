'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { auditText, groupOf } from '../audit/audit-sentence';
import { settleEase } from '../components/motion-bits';
import type { AuditEntry, AuditPage } from '../types';

/** At most this many of today's events are drawn; the newest win. */
const CAP = 500;
const PAGE = 200;
const DAY_MS = 86_400_000;

type Kind = 'exam' | 'results' | 'admin';

/** Action groups that belong to running exams: authoring, sitting, monitoring, grading, integrity. */
const EXAM_GROUPS = new Set([
  'exam',
  'exams',
  'attempt',
  'attempts',
  'monitoring',
  'integrity',
  'grading',
  'rubric',
  'dispute',
  'disputes',
  'question',
  'questions',
  'question_category',
  'fairness',
  'report',
  'reports',
]);

function kindOf(action: string): Kind {
  if (/result/.test(action) && /publish/.test(action)) return 'results';
  return EXAM_GROUPS.has(groupOf(action)) ? 'exam' : 'admin';
}

const KIND: Record<Kind, { label: string; ink: string }> = {
  exam: { label: 'Exams and integrity', ink: 'bg-data-1' },
  results: { label: 'Results published', ink: 'bg-data-3' },
  admin: { label: 'Administration', ink: 'bg-data-2' },
};

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Today's audit entries, newest first, in pages of 200 until the cap. */
async function fetchToday(scope: 'org' | 'platform', from: number) {
  const path = scope === 'org' ? '/org/audit' : '/platform/audit';
  const items: AuditEntry[] = [];
  let total = 0;
  for (let page = 1; items.length < CAP; page++) {
    const res = await api.get<AuditPage>(path, {
      query: { from: new Date(from).toISOString(), page, pageSize: PAGE },
    });
    items.push(...res.items);
    total = res.total;
    if (res.items.length < PAGE || page * PAGE >= res.total) break;
  }
  return { items: items.slice(0, CAP), total };
}

/** The 24-hour scale: a tick every hour, majors every six with their time. */
function HourRule() {
  const lines = [];
  for (let h = 0; h <= 24; h++) {
    const major = h % 6 === 0;
    lines.push(
      <line
        key={h}
        x1={`${(h / 24) * 100}%`}
        x2={`${(h / 24) * 100}%`}
        y1={major ? 0 : 5}
        y2={12}
        className={major ? 'stroke-label-tertiary' : 'stroke-label-quaternary'}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />,
    );
  }
  return (
    <div aria-hidden>
      <svg className="block h-3 w-full overflow-visible">
        {lines}
        <line
          x1="0"
          x2="100%"
          y1={11.5}
          y2={11.5}
          className="stroke-separator-strong"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      </svg>
      <div className="relative mt-1 h-4 text-caption tabular-nums text-label-tertiary">
        {[0, 6, 12, 18, 24].map((h, i, all) => (
          <span
            key={h}
            className={cn(
              'absolute top-0 whitespace-nowrap',
              i === 0
                ? 'translate-x-0'
                : i === all.length - 1
                  ? '-translate-x-full'
                  : '-translate-x-1/2',
            )}
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Day at a glance: today's activity on a 24-hour Marks rule. One tick per audit entry, carmine for exams and
 * integrity, gold for published results, graphite for administration; a needle stands at now. Hovering a tick
 * reads the entry out, and clicking opens it in the audit log.
 */
export function DayAtAGlance({
  scope,
  className,
}: {
  scope: 'org' | 'platform';
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const start = startOfDay(now);
  const day = useQuery({
    queryKey: ['day-glance', scope, start],
    queryFn: () => fetchToday(scope, start),
    refetchInterval: 60_000,
  });
  const [active, setActive] = useState<AuditEntry | null>(null);
  const auditHref = scope === 'org' ? '/audit' : '/platform/audit';
  const at = (t: number) => Math.max(0, Math.min(100, ((t - start) / DAY_MS) * 100));
  const nowAt = at(now);

  const items = useMemo(
    () =>
      (day.data?.items ?? []).filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= start && t < start + DAY_MS;
      }),
    [day.data, start],
  );
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { exam: 0, results: 0, admin: 0 };
    for (const e of items) c[kindOf(e.action)]++;
    return c;
  }, [items]);
  const focusable = items.length <= 80;

  return (
    <section aria-labelledby="day-glance-title" className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-separator pb-3">
        <h2 id="day-glance-title" className="text-title-3 font-semibold text-label">
          Day at a glance
        </h2>
        <Link
          href={auditHref}
          className="rounded-sm text-footnote font-medium text-accent-text hover:underline"
        >
          Open the audit log
        </Link>
      </div>

      {day.isPending ? (
        <Skeleton className="mt-6 h-20" />
      ) : day.isError ? (
        <div className="flex flex-wrap items-center gap-3 py-6">
          <p className="text-callout text-label-secondary">
            Couldn’t load today’s activity. {errorMessage(day.error)}
          </p>
          <Button size="sm" variant="gray" onClick={() => void day.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="relative mt-6">
            {/* Event ticks stand on the rule; the layer sweeps in from midnight once. */}
            <motion.div
              className="relative h-10"
              initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={{ duration: 0.7, ease: settleEase, delay: 0.12 }}
              onPointerLeave={() => setActive(null)}
            >
              {items.map((e) => {
                const kind = kindOf(e.action);
                const label = `${clock.format(new Date(e.createdAt))}, ${auditText(e)}`;
                return (
                  <Link
                    key={e.id}
                    href={`${auditHref}#audit-${e.id}`}
                    aria-label={label}
                    tabIndex={focusable ? undefined : -1}
                    onPointerEnter={() => setActive(e)}
                    onFocus={() => setActive(e)}
                    onBlur={() => setActive(null)}
                    className="group absolute inset-y-0 w-2 -translate-x-1/2 outline-none"
                    style={{ left: `${at(new Date(e.createdAt).getTime())}%` }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'absolute bottom-0 left-1/2 h-6 w-[2px] -translate-x-1/2 origin-bottom rounded-full transition-transform duration-150 ease-out group-hover:scale-y-[1.6] group-focus-visible:scale-y-[1.6] motion-reduce:transition-none',
                        KIND[kind].ink,
                        active && active.id !== e.id && 'opacity-35',
                      )}
                    />
                  </Link>
                );
              })}
            </motion.div>

            {/* The needle at now travels from midnight and settles. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-10 overflow-hidden"
            >
              <motion.div
                className="absolute inset-0"
                initial={reduced ? false : { x: '-100%' }}
                animate={{ x: `${nowAt - 100}%` }}
                transition={{ type: 'spring', bounce: 0.18, visualDuration: 0.7, delay: 0.12 }}
              >
                <span className="absolute -top-0.5 right-0 h-[calc(100%+2px)] w-px translate-x-1/2 bg-label" />
                <span className="absolute -top-1 right-0 size-[7px] translate-x-1/2 rotate-45 bg-label" />
              </motion.div>
            </div>
            <HourRule />
          </div>

          <div className="mt-3 flex min-h-10 flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <p aria-live="polite" className="min-w-0 flex-1 text-footnote text-label-secondary">
              {active ? (
                <>
                  <span className="tabular-nums text-label">
                    {clock.format(new Date(active.createdAt))}
                  </span>{' '}
                  {auditText(active)}
                </>
              ) : items.length === 0 ? (
                'Nothing recorded yet today. Sign-ins, exam changes and results appear here as they happen.'
              ) : (
                `${items.length} ${items.length === 1 ? 'event' : 'events'} today${
                  (day.data?.total ?? 0) > CAP ? `, the latest ${CAP} shown` : ''
                }. Point at a tick to read it; select it to open the entry.`
              )}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-label-secondary">
              {(Object.keys(KIND) as Kind[]).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn('h-2.5 w-[2px] rounded-full', KIND[k].ink)} />
                  {KIND[k].label}
                  <span className="tabular-nums text-label">{counts[k]}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

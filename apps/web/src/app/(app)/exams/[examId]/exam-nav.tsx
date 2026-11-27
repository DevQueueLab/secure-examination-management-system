'use client';

import type { ExamPhase, ExamStatus } from '@athena/shared';
import { examPhase } from '@athena/shared';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { PhaseBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { visibleExamTabs } from '@/config/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useSpring } from '@/lib/motion';

/** The fields the header needs, read defensively from GET /exams/:id ({ exam } or the exam itself). */
interface ExamSummary {
  title?: string;
  status?: ExamStatus;
  windowOpensAt?: string;
  windowClosesAt?: string;
}

export function useExamSummary(examId: string) {
  return useQuery({
    queryKey: ['exams', examId, 'summary'],
    queryFn: async () => {
      const data = await api.get<{ exam?: ExamSummary } & ExamSummary>(`/exams/${examId}`);
      return (data && 'exam' in data && data.exam ? data.exam : data) as ExamSummary;
    },
    retry: false,
  });
}

export function ExamHeader({ examId }: { examId: string }) {
  const { data } = useExamSummary(examId);
  let phase: ExamPhase | null = null;
  if (data?.status && data.windowOpensAt && data.windowClosesAt) {
    phase = examPhase({ status: data.status, windowOpensAt: data.windowOpensAt, windowClosesAt: data.windowClosesAt });
  }
  return (
    <PageHeader
      className="pb-4"
      title={data?.title ?? 'Examination'}
      breadcrumbs={[{ label: 'Exams', href: '/exams' }, { label: data?.title ?? 'Examination' }]}
      meta={phase ? <PhaseBadge phase={phase} /> : undefined}
    />
  );
}

/** Route-level sections as a link nav (not ARIA tabs): each tab is a URL you can share. */
export function ExamTabsNav({ examId }: { examId: string }) {
  const { me } = useAuth();
  const pathname = usePathname();
  const transition = useSpring('snappy');
  const tabs = visibleExamTabs(me);
  const base = `/exams/${examId}`;
  const activeRef = useRef<HTMLAnchorElement>(null);

  const current = tabs.find((t) => (t.segment ? pathname.startsWith(`${base}/${t.segment}`) : pathname === base)) ?? tabs[0];

  // Keep the active tab in view when the strip scrolls on narrow screens.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current?.id]);

  return (
    <nav aria-label="Exam sections" className="sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 -mx-4 border-b bg-bg/85 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <ul className="-mb-px flex gap-0.5 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] lg:[mask-image:none]">
        {tabs.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.id === current?.id;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                ref={active ? activeRef : undefined}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-11 items-center px-3 text-callout font-medium transition-colors duration-150',
                  active ? 'text-label' : 'text-label-secondary hover:text-label',
                )}
              >
                {tab.label}
                {active && (
                  <motion.span
                    layoutId="exam-tab-indicator"
                    transition={transition}
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

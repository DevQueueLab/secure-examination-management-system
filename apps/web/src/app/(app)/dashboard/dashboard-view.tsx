'use client';

import { CalendarClock, CircleCheck, ClipboardCheck, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { givenName } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GroupedList, GroupedListItem, IconTile } from '@/components/ui/grouped-list';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { visibleQuickActions } from '@/config/navigation';
import { homePathFor, useAuth } from '@/lib/auth';

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}


/** Role-aware home. Feature work replaces the empty states with live data. */
export function DashboardView() {
  const { me, audience } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (me && homePathFor(me) === '/platform') router.replace('/platform');
  }, [me, router]);

  if (!me || homePathFor(me) === '/platform') return null;

  if (audience === 'candidate') {
    return (
      <>
        <PageHeader title="My exams" subtitle={`${greeting()}, ${givenName(me.user.name)}. Here is everything assigned to you.`} />
        <div className="flex flex-col gap-10">
          <Section title="Available now" description="Exams whose window is open. Start when you are ready.">
            <EmptyState size="sm" icon={<PlayCircle />} title="Nothing to take right now" description="When an exam opens, it appears here with a Start button." />
          </Section>
          <Section title="Upcoming" description="Scheduled exams and when their windows open.">
            <EmptyState size="sm" icon={<CalendarClock />} title="No upcoming exams" description="Your examiner hasn’t scheduled anything for you yet." />
          </Section>
          <Section title="Completed">
            <EmptyState
              size="sm"
              icon={<CircleCheck />}
              title="No completed exams"
              description="Submitted exams move here. Published results open from the Results tab."
              action={
                <Button asChild variant="tinted" size="sm">
                  <Link href="/results">Go to results</Link>
                </Button>
              }
            />
          </Section>
        </div>
      </>
    );
  }

  const actions = visibleQuickActions(me);
  return (
    <>
      <PageHeader title={`${greeting()}, ${givenName(me.user.name)}`} subtitle={me.organization ? `${me.organization.name} · ${me.role?.name ?? 'Member'}` : undefined} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section title="Today" description="Live and upcoming exams you are responsible for.">
          <EmptyState
            icon={<ClipboardCheck />}
            title="No exams need you today"
            description="Exams you author, proctor or grade show here with what needs attention first."
            action={
              <Button asChild variant="gray">
                <Link href="/exams">Open exams</Link>
              </Button>
            }
          />
        </Section>
        {actions.length > 0 && (
          <Section title="Start something">
            <GroupedList>
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <GroupedListItem
                    key={a.id}
                    href={a.href}
                    icon={
                      <IconTile tone="accent">
                        <Icon />
                      </IconTile>
                    }
                    title={a.label}
                  />
                );
              })}
            </GroupedList>
          </Section>
        )}
      </div>
    </>
  );
}

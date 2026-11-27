'use client';

import { Calculator, Megaphone, MessageCircleQuestion, MoreHorizontal, NotebookPen, Send, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { AthenaMark } from '@/components/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { usePreferences } from '../lib/preferences';
import { useEngineSelector } from '../lib/use-engine';
import { SyncPill } from './sync-pill';
import { Timer } from './timer';
import { FocusModeToggle } from '../focus/focus-mode';

export type ToolId = 'calculator' | 'scratchpad' | 'announcements' | 'ask' | 'preferences';

function ToolButton({ label, icon, onClick, active, badge }: { label: string; icon: ReactNode; onClick: () => void; active?: boolean; badge?: number }) {
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClick}
        aria-label={badge ? `${label}, ${badge} unread` : label}
        aria-pressed={active}
        className={cn('relative', active && 'bg-fill text-label')}
      >
        {icon}
        {badge ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-fill px-1 text-[0.6875rem] font-semibold leading-none text-white tabular-nums"
          >
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  );
}

/**
 * The exam's one bar: what this is, how long is left, whether work is saved, the tools, and the way out.
 * On phones the tools fold into one menu so the timer and save state keep their room.
 */
export function WorkspaceHeader({ onTool, onReview, active }: { onTool: (tool: ToolId) => void; onReview: () => void; active: Partial<Record<ToolId, boolean>> }) {
  const { prefs } = usePreferences();
  const view = useEngineSelector((s) => s.view);
  const unread = useEngineSelector((s) => s.announcements.filter((a) => !a.read).length);
  if (!view) return null;
  const { allowCalculator, allowScratchpad } = view.settings;

  return (
    <header className="material hairline-b sticky top-0 z-30 pt-safe">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <AthenaMark size={22} className="hidden shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-headline text-label">{view.examTitle}</h1>
            {view.isSandbox && (
              <Badge tone="warning" size="sm" className="shrink-0">
                Sandbox
              </Badge>
            )}
          </div>
          {view.examCode && <p className="truncate text-footnote text-label-secondary max-sm:hidden">{view.examCode}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="max-md:hidden">
            <SyncPill />
          </div>
          <div className="md:hidden">
            <SyncPill compact />
          </div>
          <Timer mode={prefs.timer} />
          <FocusModeToggle />

          <div aria-hidden data-ws-focus-hide className="mx-1 h-6 w-px bg-separator-strong max-lg:hidden" />

          <div className="flex items-center gap-0.5 max-lg:hidden" role="toolbar" aria-label="Exam tools">
            {allowCalculator && <ToolButton label="Calculator" icon={<Calculator aria-hidden />} onClick={() => onTool('calculator')} active={active.calculator} />}
            {allowScratchpad && <ToolButton label="Scratchpad" icon={<NotebookPen aria-hidden />} onClick={() => onTool('scratchpad')} active={active.scratchpad} />}
            <ToolButton label="Announcements" icon={<Megaphone aria-hidden />} onClick={() => onTool('announcements')} active={active.announcements} badge={unread} />
            <ToolButton label="Ask the proctor" icon={<MessageCircleQuestion aria-hidden />} onClick={() => onTool('ask')} active={active.ask} />
            <ToolButton label="Preferences" icon={<SlidersHorizontal aria-hidden />} onClick={() => onTool('preferences')} active={active.preferences} />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="relative lg:hidden" aria-label={unread ? `Exam tools, ${unread} unread announcements` : 'Exam tools'}>
                <MoreHorizontal aria-hidden />
                {unread > 0 && <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-danger-fill" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              {allowCalculator && (
                <DropdownMenuItem icon={<Calculator />} onSelect={() => onTool('calculator')}>
                  Calculator
                </DropdownMenuItem>
              )}
              {allowScratchpad && (
                <DropdownMenuItem icon={<NotebookPen />} onSelect={() => onTool('scratchpad')}>
                  Scratchpad
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon={<Megaphone />} onSelect={() => onTool('announcements')}>
                Announcements{unread ? ` (${unread} new)` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem icon={<MessageCircleQuestion />} onSelect={() => onTool('ask')}>
                Ask the proctor
              </DropdownMenuItem>
              <DropdownMenuItem icon={<SlidersHorizontal />} onSelect={() => onTool('preferences')}>
                Preferences
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Send />} onSelect={onReview}>
                Review and submit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="filled" size="md" onClick={onReview} className="ml-1 max-sm:hidden">
            Review &amp; submit
          </Button>
        </div>
      </div>
    </header>
  );
}

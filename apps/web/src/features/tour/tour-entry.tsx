'use client';

import { Command } from 'cmdk';
import { Compass } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useTour } from './tour';

/** "Take the tour" for the user menu. */
export function TourMenuItem() {
  const tour = useTour();
  return (
    <DropdownMenuItem icon={<Compass aria-hidden />} onSelect={() => tour.start()}>
      Take the tour
    </DropdownMenuItem>
  );
}

/** "Start the tour" for the command palette; `run` closes the palette before starting. */
export function TourCommandItem({
  run,
  className,
}: {
  run: (fn: () => void) => void;
  className?: string;
}) {
  const tour = useTour();
  return (
    <Command.Item
      value="Start the tour"
      keywords={['tour', 'guide', 'tutorial', 'onboarding', 'walkthrough']}
      onSelect={() => run(() => tour.start())}
      className={className}
    >
      <Compass aria-hidden />
      <span className="flex-1">Start the tour</span>
    </Command.Item>
  );
}

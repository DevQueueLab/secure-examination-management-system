'use client';

import { Search } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { Shortcut } from '@/components/ui/kbd';
import { isActive, visibleNav } from '@/config/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useReducedMotion, useSpring } from '@/lib/motion';
import { useCommandPalette } from './command-palette';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

/** Org switcher, search, permission-filtered navigation and the account menu. Shared by desktop and the mobile sheet. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useAuth();
  const pathname = usePathname();
  const palette = useCommandPalette();
  const sections = visibleNav(me);
  // One chip with its carmine needle glides between active items; a hover fill follows the pointer.
  // Each instance (desktop rail, mobile sheet) gets its own layout group so the two never trade elements.
  const group = useId();
  const glide = useSpring('glide');
  const follow = useSpring('snappy');
  // Reduced motion: no travel at all; the chip and the hover fill simply appear where they belong.
  const still = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-2">
        <OrgSwitcher />
      </div>

      <div className="px-3 pb-1 pt-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            palette.open();
          }}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-fill-secondary px-2.5 text-callout text-label-secondary shadow-[inset_0_0_0_0.5px_var(--separator)] transition-colors duration-150 hover:bg-fill hover:text-label active:bg-fill-strong"
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <Shortcut keys={['mod', 'K']} size="sm" />
        </button>
      </div>

      <LayoutGroup id={group}>
      <motion.nav
        layoutScroll
        aria-label="Main"
        className="flex-1 overflow-y-auto px-3 pb-4 pt-2"
        onPointerLeave={() => setHovered(null)}
      >
        {sections.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            {section.label && (
              <h2 className="px-2.5 pb-1.5 pt-1 text-footnote font-medium text-label-secondary">{section.label}</h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      onPointerEnter={(e) => {
                        if (e.pointerType === 'mouse') setHovered(item.id);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-callout font-[450] text-label',
                        'transition-transform duration-150 active:scale-[0.985]',
                      )}
                    >
                      {hovered === item.id && (
                        <motion.span
                          aria-hidden
                          layoutId={still ? undefined : 'nav-hover'}
                          transition={follow}
                          className="absolute inset-0 rounded-lg bg-fill-secondary"
                        />
                      )}
                      {active && (
                        // Selected: an inset chip of solid marble (or glass) set into the reeds, with the Marks
                        // needle at its edge. It travels to the next active item on a spring.
                        <motion.span
                          aria-hidden
                          layoutId={still ? undefined : 'nav-chip'}
                          transition={glide}
                          className="absolute inset-0 rounded-lg bg-chip [box-shadow:var(--chip-shadow),0_0_0_0.5px_var(--chip-ring)]"
                        >
                          <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
                        </motion.span>
                      )}
                      <Icon
                        aria-hidden
                        className={cn('relative size-[17px] shrink-0 transition-colors duration-150', active ? 'text-accent-text' : 'text-label-secondary group-hover:text-label')}
                        strokeWidth={active ? 2 : 1.75}
                      />
                      <span className="relative truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </motion.nav>
      </LayoutGroup>

      <div className="px-2 pb-2 pt-1.5 shadow-[inset_0_0.5px_0_var(--separator-strong)]">
        <UserMenu />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fluted fixed inset-y-0 left-0 z-30 hidden w-[264px] shadow-[inset_-0.5px_0_0_var(--separator-strong),inset_-1.5px_0_0_var(--fluted-edge)] lg:block">
      <SidebarContent />
    </aside>
  );
}

'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shortcut } from '@/components/ui/kbd';
import { isActive, visibleNav } from '@/config/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useCommandPalette } from './command-palette';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

/** Org switcher, search, permission-filtered navigation and the account menu. Shared by desktop and the mobile sheet. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useAuth();
  const pathname = usePathname();
  const palette = useCommandPalette();
  const sections = visibleNav(me);

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
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-fill-secondary px-2.5 text-callout text-label-secondary transition-colors hover:bg-fill hover:text-label"
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <Shortcut keys={['mod', 'K']} size="sm" />
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {sections.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            {section.label && (
              <h2 className="px-2.5 pb-1 pt-1 text-footnote font-semibold text-label-secondary">{section.label}</h2>
            )}
            <ul className="flex flex-col gap-px">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-callout transition-colors duration-100',
                        active ? 'bg-accent-tint font-semibold text-label' : 'text-label hover:bg-fill-secondary active:bg-fill',
                      )}
                    >
                      <Icon aria-hidden className="size-[17px] shrink-0 text-accent-text" strokeWidth={active ? 2.1 : 1.8} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t px-2 py-2">
        <UserMenu />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="material-sidebar fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r lg:block">
      <SidebarContent />
    </aside>
  );
}

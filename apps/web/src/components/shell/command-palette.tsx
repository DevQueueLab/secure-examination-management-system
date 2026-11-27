'use client';

import { Command } from 'cmdk';
import { ArrowRightLeft, CornerDownLeft, History, Keyboard, LogOut, Monitor, Moon, Search, Sun, SunMoon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Kbd, Shortcut } from '@/components/ui/kbd';
import { toast } from '@/components/ui/toaster';
import { ACCOUNT_ITEMS, isActive, visibleNav, visibleQuickActions, type NavSection } from '@/config/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { ORG_TYPE_LABEL } from './org-switcher';
import { TourCommandItem } from '@/features/tour/tour-entry';

const PaletteContext = createContext<{ open: () => void; close: () => void; isOpen: boolean }>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function useCommandPalette() {
  return useContext(PaletteContext);
}

/** g-chords: g then a letter goes to that page, when this person can see it. */
const CHORDS: { key: string; href: string; label: string }[] = [
  { key: 'h', href: '/dashboard', label: 'Home' },
  { key: 'e', href: '/exams', label: 'Exams' },
  { key: 'q', href: '/questions', label: 'Question bank' },
  { key: 'g', href: '/grading', label: 'Grading' },
];

function chordTargets(sections: NavSection[]) {
  const hrefs = new Set(sections.flatMap((s) => s.items.map((i) => i.href)));
  return CHORDS.filter((c) => hrefs.has(c.href));
}

type RecentPage = { href: string; label: string };

/** Recents belong to one person in one organization, so switching accounts never shows someone else's pages. */
function recentKey(me: ReturnType<typeof useAuth>['me']): string | null {
  return me ? `athena:recent-pages:${me.user.id}:${me.organization?.id ?? 'none'}` : null;
}

function readRecent(key: string | null): RecentPage[] {
  if (!key) return [];
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => typeof r?.href === 'string' && typeof r?.label === 'string') : [];
  } catch {
    return [];
  }
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  // Menus, listboxes and comboboxes use letters for typeahead.
  return !!target.closest('[role="menu"], [role="listbox"], [role="combobox"]');
}

/** Provides ⌘K / Ctrl+K, ? for the shortcuts sheet and g-chords, and renders the palette once for the whole shell. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const targets = useMemo(() => chordTargets(visibleNav(me)), [me]);

  useEffect(() => {
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      const key = e.key.toLowerCase();
      if (chordAt && performance.now() - chordAt < 1200) {
        chordAt = 0;
        const target = targets.find((c) => c.key === key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (key === 'g' && targets.length > 0) chordAt = performance.now();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, targets]);

  // Recent pages: the heading of each page visited this session, newest first.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const heading = document.querySelector('main h1')?.textContent?.trim();
      const nav = visibleNav(me)
        .flatMap((s) => s.items)
        .find((i) => isActive(pathname, i));
      const label = heading || nav?.label;
      const key = recentKey(me);
      if (!label || !key) return;
      try {
        const next = [{ href: pathname, label }, ...readRecent(key).filter((r) => r.href !== pathname)].slice(0, 6);
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage blocked: no recents */
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [pathname, me]);

  const value = useMemo(() => ({ open: () => setOpen(true), close: () => setOpen(false), isOpen }), [isOpen]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setOpen} onShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} chords={targets} />
    </PaletteContext.Provider>
  );
}

/** Only the shortcuts that really exist for this person. */
function ShortcutsSheet({ open, onOpenChange, chords }: { open: boolean; onOpenChange: (open: boolean) => void; chords: typeof CHORDS }) {
  const row = 'flex min-h-11 items-center justify-between gap-4 py-2 shadow-[inset_0_-0.5px_0_var(--separator)] last:shadow-none';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Keyboard shortcuts" />
        <DialogBody>
          <ul className="text-callout text-label">
            <li className={row}>
              <span>Search pages and actions</span>
              <Shortcut keys={['mod', 'K']} size="sm" />
            </li>
            <li className={row}>
              <span>Show keyboard shortcuts</span>
              <Kbd size="sm">?</Kbd>
            </li>
            {chords.map((c) => (
              <li key={c.key} className={row}>
                <span>Go to {c.label}</span>
                <span className="flex items-center gap-1 text-footnote text-label-secondary">
                  <Kbd size="sm">G</Kbd> then <Kbd size="sm">{c.key.toUpperCase()}</Kbd>
                </span>
              </li>
            ))}
            <li className={row}>
              <span>Close a dialog or sheet</span>
              <Kbd size="sm">Esc</Kbd>
            </li>
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const itemClass = cn(
  'flex h-10 cursor-default select-none items-center gap-3 rounded-[10px] px-3 text-body text-label outline-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-on-accent [&_svg]:size-[18px] [&_svg]:shrink-0',
  '[&_svg]:text-label-secondary data-[selected=true]:[&_svg]:text-on-accent',
);

const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-label-secondary';

function CommandPalette({ open, onOpenChange, onShortcuts }: { open: boolean; onOpenChange: (open: boolean) => void; onShortcuts: () => void }) {
  const { me, signOut, switchOrganization } = useAuth();
  const { setAppearance, resolved } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentPage[]>([]);
  useEffect(() => {
    if (open) setRecent(readRecent(recentKey(me)).filter((r) => r.href !== pathname).slice(0, 4));
  }, [open, pathname, me]);

  const run = useCallback(
    (fn: () => void) => {
      onOpenChange(false);
      setQuery('');
      fn();
    },
    [onOpenChange],
  );

  const sections = visibleNav(me);
  const actions = visibleQuickActions(me);
  const otherOrgs = (me?.memberships ?? []).filter((m) => m.organizationId !== me?.organization?.id);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-[36rem] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface-raised shadow-xl outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] duration-150 ease-out-expo data-[state=open]:duration-[260ms] data-[state=open]:ease-(--ease-spring)',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Search Athena</DialogPrimitive.Title>
          <Command label="Search Athena" loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b px-4">
              <Search aria-hidden className="size-[18px] shrink-0 text-label-tertiary" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages and actions"
                className="h-14 flex-1 bg-transparent text-title-3 font-normal tracking-[-0.01em] text-label outline-none placeholder:text-placeholder"
              />
            </div>
            <Command.List className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain p-2 scroll-py-2">
              <Command.Empty className="px-3 py-10 text-center text-callout text-label-secondary">
                Nothing matches “{query}”. Try a page name like “Grading”.
              </Command.Empty>

              {recent.length > 0 && (
                <Command.Group heading="Recent" className={groupClass}>
                  {recent.map((r) => (
                    <Command.Item key={r.href} value={`Recent ${r.label} ${r.href}`} onSelect={() => run(() => router.push(r.href))} className={itemClass}>
                      <History aria-hidden />
                      <span className="flex-1 truncate">{r.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {sections.map((section) => (
                <Command.Group key={section.id} heading={section.label ?? 'Go to'} className={groupClass}>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${section.label ?? ''}`}
                        keywords={item.keywords}
                        onSelect={() => run(() => router.push(item.href))}
                        className={itemClass}
                      >
                        <Icon aria-hidden />
                        <span className="flex-1 truncate">{item.label}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}

              {actions.length > 0 && (
                <Command.Group heading="Create" className={groupClass}>
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Command.Item
                        key={action.id}
                        value={action.label}
                        keywords={action.keywords}
                        onSelect={() => run(() => router.push(action.href))}
                        className={itemClass}
                      >
                        <Icon aria-hidden />
                        <span className="flex-1 truncate">{action.label}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}

              {otherOrgs.length > 0 && (
                <Command.Group heading="Switch organization" className={groupClass}>
                  {otherOrgs.map((m) => (
                    <Command.Item
                      key={m.organizationId}
                      value={`Switch to ${m.organizationName}`}
                      keywords={['organization', 'tenant', ORG_TYPE_LABEL[m.organizationType]]}
                      onSelect={() =>
                        run(() => {
                          switchOrganization(m.organizationId)
                            .then(() => toast.success(`Switched to ${m.organizationName}`))
                            .catch((e) => toast.error('Couldn’t switch organization', { description: errorMessage(e) }));
                        })
                      }
                      className={itemClass}
                    >
                      <ArrowRightLeft aria-hidden />
                      <span className="flex-1 truncate">{m.organizationName}</span>
                      <span className="text-footnote opacity-70">{m.roleName}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Account" className={groupClass}>
                {ACCOUNT_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item key={item.id} value={item.label} keywords={item.keywords} onSelect={() => run(() => router.push(item.href))} className={itemClass}>
                      <Icon aria-hidden />
                      <span className="flex-1">{item.label}</span>
                    </Command.Item>
                  );
                })}
                <Command.Item
                  value="Toggle theme"
                  keywords={['appearance', 'dark', 'light', 'mode']}
                  onSelect={() => run(() => setAppearance(resolved === 'dark' ? 'light' : 'dark'))}
                  className={itemClass}
                >
                  <SunMoon aria-hidden />
                  <span className="flex-1">Toggle theme</span>
                </Command.Item>
                <TourCommandItem run={run} className={itemClass} />
                <Command.Item value="Keyboard shortcuts" keywords={['keys', 'hotkeys', 'help']} onSelect={() => run(onShortcuts)} className={itemClass}>
                  <Keyboard aria-hidden />
                  <span className="flex-1">Keyboard shortcuts</span>
                  <Kbd size="sm">?</Kbd>
                </Command.Item>
                <Command.Item value="Use light appearance" keywords={['theme', 'mode']} onSelect={() => run(() => setAppearance('light'))} className={itemClass}>
                  <Sun aria-hidden />
                  <span className="flex-1">Light appearance</span>
                </Command.Item>
                <Command.Item value="Use dark appearance" keywords={['theme', 'mode', 'night']} onSelect={() => run(() => setAppearance('dark'))} className={itemClass}>
                  <Moon aria-hidden />
                  <span className="flex-1">Dark appearance</span>
                </Command.Item>
                <Command.Item value="Match system appearance" keywords={['theme', 'auto']} onSelect={() => run(() => setAppearance('system'))} className={itemClass}>
                  <Monitor aria-hidden />
                  <span className="flex-1">Match system appearance</span>
                </Command.Item>
                <Command.Item value="Sign out" keywords={['log out', 'logout', 'exit']} onSelect={() => run(() => void signOut())} className={itemClass}>
                  <LogOut aria-hidden />
                  <span className="flex-1">Sign out</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t px-4 py-2.5 text-footnote text-label-secondary">
              <span className="flex items-center gap-1.5">
                <CornerDownLeft aria-hidden className="size-3.5" /> to open
              </span>
              <span>↑↓ to move</span>
              <span className="ml-auto">esc to close</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

'use client';

import { Command } from 'cmdk';
import { ArrowRightLeft, CornerDownLeft, LogOut, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from '@/components/ui/toaster';
import { ACCOUNT_ITEMS, visibleNav, visibleQuickActions } from '@/config/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { ORG_TYPE_LABEL } from './org-switcher';

const PaletteContext = createContext<{ open: () => void; close: () => void; isOpen: boolean }>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function useCommandPalette() {
  return useContext(PaletteContext);
}

/** Provides ⌘K / Ctrl+K and renders the palette once for the whole shell. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ open: () => setOpen(true), close: () => setOpen(false), isOpen }), [isOpen]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

const itemClass = cn(
  'flex h-10 cursor-default select-none items-center gap-3 rounded-[10px] px-3 text-body text-label outline-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-on-accent [&_svg]:size-[18px] [&_svg]:shrink-0',
  '[&_svg]:text-label-secondary data-[selected=true]:[&_svg]:text-on-accent',
);

const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-label-secondary';

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { me, signOut, switchOrganization } = useAuth();
  const { setAppearance } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

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
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] duration-150 ease-out-expo',
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

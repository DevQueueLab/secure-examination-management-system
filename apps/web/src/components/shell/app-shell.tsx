'use client';

import { AnimatePresence, motion } from 'motion/react';
import { CircleHelp, KeyRound, Menu, Moon, RefreshCw, Search, ServerCrash, Sun, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, ViewTransition, type ReactNode } from 'react';
import { AthenaMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { candidateTabs, isActive } from '@/config/navigation';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useSpring } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { CommandPaletteProvider, useCommandPalette } from './command-palette';
import { TourProvider, useTour } from '@/features/tour/tour';
import { ShellTitleProvider, useShellTitle } from './shell-title';
import { Sidebar, SidebarContent } from './sidebar';
import { UserMenu } from './user-menu';

function subscribeScroll(cb: () => void) {
  window.addEventListener('scroll', cb, { passive: true });
  return () => window.removeEventListener('scroll', cb);
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** The browser's own connectivity signal: false means the device is offline, not that Athena is down. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Content has scrolled under the bar: show the material and its hairline (scroll edge effect). */
function useScrolled(): boolean {
  return useSyncExternalStore(subscribeScroll, () => window.scrollY > 2, () => false);
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const scrolled = useScrolled();
  const { title, condensed } = useShellTitle();
  const palette = useCommandPalette();
  const transition = useSpring('snappy');
  const { resolved, setAppearance } = useTheme();
  const tour = useTour();
  const dark = resolved === 'dark';

  return (
    <div
      data-scrolled={scrolled || undefined}
      className={cn(
        'sticky top-0 z-20 pt-safe transition-[background-color,box-shadow] duration-200',
        // Fluted glass arrives only once content passes beneath (the scroll edge effect).
        scrolled ? 'material-fluted hairline-b' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-13 w-full max-w-[1200px] items-center gap-2 px-4 sm:px-6 lg:px-10">
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open navigation" onClick={onMenu}>
          <Menu aria-hidden className="size-5" />
        </Button>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md lg:hidden" aria-label="Athena home">
          <AthenaMark size={24} />
        </Link>
        <div className="relative min-w-0 flex-1">
          <AnimatePresence initial={false}>
            {condensed && title && (
              <motion.p
                key={title}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={transition}
                aria-hidden
                className="truncate text-headline text-label lg:text-center"
              >
                {title}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {/* On wide screens the sidebar's search field does this job, so the bar offers appearance and the tour. */}
        <Tooltip content="Search" shortcut={['mod', 'K']}>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Search pages and actions" onClick={palette.open}>
            <Search aria-hidden className="size-[18px]" />
          </Button>
        </Tooltip>
        <Tooltip content={dark ? 'Light appearance' : 'Dark appearance'}>
          <Button variant="ghost" size="icon" aria-label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'} onClick={() => setAppearance(dark ? 'light' : 'dark')}>
            {dark ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
          </Button>
        </Tooltip>
        <Tooltip content="Guided tour">
          <Button variant="ghost" size="icon" aria-label="Guided tour" onClick={tour.start}>
            <CircleHelp aria-hidden className="size-[18px]" />
          </Button>
        </Tooltip>
        <NotificationBell />
        <div className="lg:hidden">
          <UserMenu compact />
        </div>
      </div>
    </div>
  );
}

function CandidateTabBar() {
  const { me, audience } = useAuth();
  const pathname = usePathname();
  if (audience !== 'candidate') return null;
  const tabs = candidateTabs(me);
  return (
    <nav aria-label="Tabs" className="material-fluted hairline-t fixed inset-x-0 bottom-0 z-30 pb-safe md:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          const Icon = tab.icon;
          return (
            <li key={tab.id} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[52px] flex-col items-center justify-center gap-0.5 text-caption font-medium transition-colors',
                  active ? 'text-accent-text' : 'text-label-secondary',
                )}
              >
                <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                <span>{tab.label === 'Profile & preferences' ? 'Profile' : tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh" role="status" aria-label="Loading Athena">
      <div className="fluted fixed inset-y-0 left-0 hidden w-[264px] flex-col gap-3 p-3 shadow-[inset_-0.5px_0_0_var(--separator-strong)] lg:flex">
        <div className="flex items-center gap-2.5 p-1">
          <Skeleton className="size-8 rounded-[9px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-8 w-full rounded-lg" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full rounded-lg" />
        ))}
      </div>
      <div className="lg:pl-[264px]">
        <div className="mx-auto max-w-[1200px] px-4 pt-20 sm:px-6 lg:px-10">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MustChangePasswordBanner() {
  const { me } = useAuth();
  const pathname = usePathname();
  if (!me?.user.mustChangePassword || pathname.startsWith('/settings/profile')) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl bg-warning-tint px-4 py-3 sm:flex-row sm:items-center">
      <KeyRound aria-hidden className="size-5 shrink-0 text-warning-text" />
      <p className="flex-1 text-callout text-label">
        <span className="font-semibold">Set a new password.</span> Your account is using a temporary password.
      </p>
      <Button asChild size="sm" variant="filled">
        <Link href="/settings/profile#password">Change password</Link>
      </Button>
    </div>
  );
}

/** The exam room (and its lobby) stays perfectly still between routes. */
const STILL_ROUTES = /^\/(take|attempt)(\/|$)/;

/** View-transition class for a route change: deeper (into a child route), back (up to an ancestor) or lateral. */
function routeTransition(from: string, to: string): string {
  if (STILL_ROUTES.test(from) || STILL_ROUTES.test(to)) return 'none';
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);
  const a = trim(from);
  const b = trim(to);
  if (b.startsWith(a === '/' ? '/' : `${a}/`) && b !== a) return 'page-deeper';
  if (a.startsWith(b === '/' ? '/' : `${b}/`) && a !== b) return 'page-back';
  return 'page';
}

/** Authenticated chrome: translucent sidebar, top bar, mobile nav sheet, candidate tab bar and ⌘K. */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, isLoading, isError, refetch, audience } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const online = useOnline();
  // The direction of the last route change, derived while rendering so the commit carries the right class.
  const [route, setRoute] = useState<{ path: string; cls: string }>({ path: pathname, cls: 'page' });
  if (route.path !== pathname) setRoute({ path: pathname, cls: routeTransition(route.path, pathname) });
  const routeClass = route.cls;
  // A slide belongs to the navigation that caused it; later updates on the same page only rise.
  useEffect(() => {
    if (route.cls !== 'page-deeper' && route.cls !== 'page-back') return;
    const timer = window.setTimeout(() => setRoute((r) => (r.path === route.path ? { ...r, cls: 'page' } : r)), 450);
    return () => window.clearTimeout(timer);
  }, [route]);

  useEffect(() => {
    if (!isLoading && !isError && !me) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isError, me, pathname, router]);

  if (isLoading || (!me && !isError)) return <ShellSkeleton />;

  if (!me) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        {/* Offline is the device; anything else is Athena failing (a 5xx or a server that didn't answer). */}
        <EmptyState
          surface={false}
          icon={online ? <ServerCrash /> : <WifiOff />}
          art="owl"
          title={online ? 'Athena hit a problem' : 'Can’t reach Athena'}
          description={
            online
              ? 'The server didn’t answer properly. Your work is safe; try again in a moment.'
              : 'You’re offline. Your work is safe; check your connection and try again.'
          }
          action={
            <Button variant="filled" onClick={refetch}>
              <RefreshCw aria-hidden /> Try again
            </Button>
          }
          className="w-full max-w-md"
        />
      </main>
    );
  }

  return (
    <TourProvider>
    <CommandPaletteProvider>
      <ShellTitleProvider>
        <a
          href="#main"
          className="fixed left-3 top-3 z-[80] -translate-y-20 rounded-lg bg-accent px-3 py-2 text-callout font-medium text-on-accent shadow-lg transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <Sidebar />
        <Sheet open={navOpen} onOpenChange={setNavOpen} side="left">
          <SheetContent title="Navigation" bare className="fluted lg:hidden">
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="min-h-dvh lg:pl-[264px]">
          <TopBar onMenu={() => setNavOpen(true)} />
          <main
            id="main"
            tabIndex={-1}
            className={cn(
              'mx-auto w-full max-w-[1200px] px-4 pb-16 outline-none sm:px-6 lg:px-10',
              audience === 'candidate' && 'pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-16',
            )}
          >
            <MustChangePasswordBanner />
            {/* Route transitions: the old page leaves at once, the new one springs in (deeper from the right, back from
                the left). Named elements (an exam's title) match-cut between pages. The exam room never animates. */}
            <ViewTransition update={routeClass} default="none">
              <div>{children}</div>
            </ViewTransition>
          </main>
        </div>
        <CandidateTabBar />
      </ShellTitleProvider>
    </CommandPaletteProvider>
    </TourProvider>
  );
}

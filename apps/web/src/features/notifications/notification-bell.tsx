'use client';

import { RT } from '@athena/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Building2,
  CheckCheck,
  KeyRound,
  Scale,
  Trophy,
  UserPlus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { getSocket } from '@/lib/socket';

/** Mirrors NotificationView in apps/api/src/modules/notifications/notify.ts. */
export interface AppNotification {
  id: string;
  organizationId: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  items: AppNotification[];
  unreadCount: number;
  hasMore: boolean;
}

const PAGE = 20;

function iconFor(kind: string): ReactNode {
  if (kind.startsWith('membership')) return <UserPlus />;
  if (kind.startsWith('role')) return <KeyRound />;
  if (kind.startsWith('organization')) return <Building2 />;
  if (kind.startsWith('dispute') || kind.startsWith('remed')) return <Scale />;
  if (kind.startsWith('result')) return <Trophy />;
  return <Bell />;
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/**
 * The bell in the top bar: unread badge, a popover list, mark-all-read, and live delivery over the
 * user's socket room (joined automatically on connect). Polls slowly as a fallback when the socket is down.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Notifications are per person and, inside a tenant, per organization: switching refetches.
  const key = ['notifications', me?.user.id ?? 'anon', me?.organization?.id ?? 'none'] as const;

  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api.get<NotificationPage>('/notifications', {
        query: { limit: PAGE, before: pageParam ?? undefined },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.hasMore ? (last.items[last.items.length - 1]?.createdAt ?? null) : null,
    enabled: !!me,
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!me) return;
    const socket = getSocket();
    const onNew = (n: AppNotification) => {
      // Ignore notifications for another tenant than the one being viewed.
      if (n.organizationId && me.organization && n.organizationId !== me.organization.id) return;
      qc.setQueryData<InfiniteData<NotificationPage, string | null>>(key, (prev) => {
        if (!prev || prev.pages.length === 0) return prev;
        if (prev.pages.some((p) => p.items.some((x) => x.id === n.id))) return prev;
        const [first, ...rest] = prev.pages;
        return {
          ...prev,
          pages: [
            { ...first!, items: [n, ...first!.items], unreadCount: first!.unreadCount + 1 },
            ...rest,
          ],
        };
      });
      toast(n.title, {
        description: n.body ?? undefined,
        action: n.link ? { label: 'Open', onClick: () => router.push(n.link!) } : undefined,
      });
    };
    socket.on(RT.notification, onNew);
    return () => {
      socket.off(RT.notification, onNew);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user.id, me?.organization?.id, qc, router]);

  const setPages = (fn: (p: NotificationPage) => NotificationPage) =>
    qc.setQueryData<InfiniteData<NotificationPage, string | null>>(key, (prev) =>
      prev ? { ...prev, pages: prev.pages.map(fn) } : prev,
    );

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: (id) => {
      const now = new Date().toISOString();
      let changed = false;
      setPages((p) => ({
        ...p,
        items: p.items.map((x) => {
          if (x.id !== id || x.readAt) return x;
          changed = true;
          return { ...x, readAt: now };
        }),
      }));
      if (changed) setPages((p) => ({ ...p, unreadCount: Math.max(0, p.unreadCount - 1) }));
    },
    onError: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onMutate: () => {
      const now = new Date().toISOString();
      setPages((p) => ({
        ...p,
        unreadCount: 0,
        items: p.items.map((x) => (x.readAt ? x : { ...x, readAt: now })),
      }));
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (!me) return null;
  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const unread = pages[0]?.unreadCount ?? 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  const openItem = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn('relative', className)}
        >
          <Bell aria-hidden className="size-[18px]" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-semibold leading-none tabular-nums text-white ring-2 ring-bg"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            'z-[60] flex max-h-[min(34rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl bg-surface-raised text-label shadow-lg',
            'origin-(--radix-popover-content-transform-origin) duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
          )}
        >
          <div className="flex items-center gap-2 border-b border-separator px-4 py-3">
            <h2 className="flex-1 text-headline">Notifications</h2>
            {unread > 0 && (
              <Button
                variant="plain"
                size="sm"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                <CheckCheck aria-hidden /> Mark all read
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {list.isPending ? (
              <div className="flex items-center justify-center py-10">
                <Spinner />
              </div>
            ) : list.isError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <p className="text-callout text-label-secondary">{errorMessage(list.error)}</p>
                <Button variant="gray" size="sm" onClick={() => void list.refetch()}>
                  Try again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-fill-secondary text-label-tertiary">
                  <BellOff aria-hidden className="size-5" />
                </span>
                <p className="text-headline text-label">You’re all caught up</p>
                <p className="text-footnote text-label-secondary">
                  Role changes, published results and dispute updates appear here.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col p-1.5">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-[calc(var(--radius-2xl)-6px)] px-2.5 py-2.5 text-left transition-colors hover:bg-fill-secondary focus-visible:bg-fill-secondary',
                        !n.readAt && 'bg-accent-tint/50',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4',
                          n.readAt ? 'bg-fill text-label-secondary' : 'bg-accent text-on-accent',
                        )}
                      >
                        {iconFor(n.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-callout',
                            n.readAt ? 'text-label' : 'font-semibold text-label',
                          )}
                        >
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 line-clamp-2 block text-footnote text-label-secondary">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-caption text-label-tertiary">
                          <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
                        </span>
                      </span>
                      {!n.readAt && (
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-accent">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {list.hasNextPage && (
                  <li className="flex justify-center p-2">
                    <Button
                      variant="plain"
                      size="sm"
                      loading={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      Show older
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default NotificationBell;

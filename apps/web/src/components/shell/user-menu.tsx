'use client';

import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun, SunMoon, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTheme, type Appearance } from '@/lib/theme';

export function AppearanceItems() {
  const { appearance, setAppearance } = useTheme();
  return (
    <DropdownMenuRadioGroup value={appearance} onValueChange={(v) => setAppearance(v as Appearance)}>
      <DropdownMenuRadioItem value="system" icon={<Monitor aria-hidden />}>
        System
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="light" icon={<Sun aria-hidden />}>
        Light
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark" icon={<Moon aria-hidden />}>
        Dark
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

/** Profile, settings, appearance and sign out. `compact` renders only the avatar (top bar on phones). */
export function UserMenu({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { me, can, signOut } = useAuth();
  const router = useRouter();
  if (!me) return null;
  const subtitle = me.role?.name ?? (me.user.isPlatformAdmin ? 'Platform administrator' : me.user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${me.user.name}`}
        className={cn(
          'flex items-center gap-2.5 rounded-[10px] text-left transition-colors hover:bg-fill-secondary data-[state=open]:bg-fill-secondary',
          compact ? 'rounded-full p-0.5' : 'w-full p-2',
          className,
        )}
      >
        <Avatar name={me.user.name} size={compact ? 'sm' : 'md'} />
        {!compact && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-callout font-medium text-label">{me.user.name}</span>
              <span className="truncate text-footnote text-label-secondary">{subtitle}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-label-tertiary" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? 'bottom' : 'top'} align={compact ? 'end' : 'start'} className="min-w-[15rem]">
        <DropdownMenuLabel className="flex flex-col gap-0.5 pb-2">
          <span className="text-callout font-semibold text-label">{me.user.name}</span>
          <span className="truncate font-normal">{me.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<UserRound aria-hidden />} onSelect={() => router.push('/settings/profile')}>
          Profile & preferences
        </DropdownMenuItem>
        {can('org.settings') && (
          <DropdownMenuItem icon={<Settings aria-hidden />} onSelect={() => router.push('/settings/organization')}>
            Organization settings
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<SunMoon aria-hidden />}>Appearance</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <AppearanceItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut aria-hidden />} onSelect={() => void signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

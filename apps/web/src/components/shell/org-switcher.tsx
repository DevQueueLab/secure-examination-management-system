'use client';

import type { OrganizationType } from '@athena/shared';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { AthenaMark } from '@/components/brand';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

export const ORG_TYPE_LABEL: Record<OrganizationType, string> = {
  institution: 'Institution',
  competition: 'Competition',
};

export function OrgTile({ name, type, size = 32 }: { name: string; type: OrganizationType; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        // Sits 8px inside the 18px sidebar corner region: 10px keeps it concentric.
        'inline-flex shrink-0 items-center justify-center rounded-[9px] font-semibold text-white',
        type === 'competition' ? 'bg-[linear-gradient(180deg,#ff9f0a,#f07800)]' : 'bg-[linear-gradient(180deg,#1585f2,#0064d2)]',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Shows the active tenant and its type; switches when the user belongs to several. */
export function OrgSwitcher({ className }: { className?: string }) {
  const { me, switchOrganization } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  if (!me) return null;

  const org = me.organization;
  const others = me.memberships.length > 1 || (!org && me.memberships.length > 0);

  const summary = org ? (
    <>
      <OrgTile name={org.name} type={org.type} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-callout font-semibold text-label" title={org.name}>
          {org.name}
        </span>
        <span className="flex items-center gap-1.5 truncate text-footnote text-label-secondary">
          <Badge size="sm" tone={org.type === 'competition' ? 'warning' : 'accent'}>
            {ORG_TYPE_LABEL[org.type]}
          </Badge>
          <span className="truncate">{me.role?.name}</span>
        </span>
      </span>
    </>
  ) : (
    <>
      <AthenaMark size={32} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-callout font-semibold text-label">Athena Platform</span>
        <span className="truncate text-footnote text-label-secondary">{me.user.isPlatformAdmin ? 'Platform administrator' : 'No organization'}</span>
      </span>
    </>
  );

  const base = cn('flex w-full items-center gap-2.5 rounded-[10px] p-2', className);

  if (!others) {
    return (
      <div className={base} aria-label="Current organization">
        {summary}
      </div>
    );
  }

  const choose = async (organizationId: string, name: string) => {
    if (organizationId === org?.id) return;
    setPending(organizationId);
    try {
      await switchOrganization(organizationId);
      toast.success(`Switched to ${name}`);
    } catch (error) {
      toast.error('Couldn’t switch organization', { description: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Organization: ${org?.name ?? 'none'}. Switch organization`}
        className={cn(base, 'transition-colors hover:bg-fill-secondary data-[state=open]:bg-fill-secondary')}
      >
        {summary}
        {pending ? <Spinner size={14} label="Switching" /> : <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-label-tertiary" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-[15rem]">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me.memberships.map((m) => {
          const active = m.organizationId === org?.id;
          return (
            <DropdownMenuItem
              key={m.organizationId}
              onSelect={() => void choose(m.organizationId, m.organizationName)}
              className="py-2"
              aria-current={active || undefined}
            >
              <span className="flex w-full min-w-0 items-center gap-2.5">
                <OrgTile name={m.organizationName} type={m.organizationType} size={24} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{m.organizationName}</span>
                  <span className="flex min-w-0 gap-2 text-footnote opacity-70">
                    <span className="truncate">{m.roleName}</span>
                    <span className="shrink-0">{ORG_TYPE_LABEL[m.organizationType]}</span>
                  </span>
                </span>
                {pending === m.organizationId ? <Spinner size={14} label={null} /> : active && <Check aria-hidden className="size-4 shrink-0" />}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

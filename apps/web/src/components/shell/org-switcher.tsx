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

/**
 * The tenant's monogram, cut in marble (light themes) or smoked glass (dark). The tenant's brand colour appears
 * only as a thin ring around it; without one the ring is a neutral hairline.
 */
export function OrgTile({
  name,
  type,
  size = 32,
  accent,
}: {
  name: string;
  type: OrganizationType;
  size?: number;
  /** The organisation's brand colour (hex). Drawn as a 1px ring, never as a fill. */
  accent?: string | null;
}) {
  const ring = accent && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : 'var(--separator-strong)';
  return (
    <span
      aria-hidden
      data-type={type}
      className="relative inline-flex shrink-0 select-none items-center justify-center font-semibold leading-none text-(--monogram)"
      style={{
        width: size,
        height: size,
        // Sits 8px inside the sidebar's corner region: the radius keeps it concentric with the row.
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.48),
        letterSpacing: '-0.02em',
        background:
          'linear-gradient(118deg, transparent 38%, var(--marble-vein) 40%, transparent 44%), linear-gradient(158deg, transparent 63%, var(--marble-vein) 64.5%, transparent 67%), radial-gradient(130% 100% at 22% 12%, var(--marble-a), var(--marble-b))',
        boxShadow: `inset 0 0.5px 0 rgb(255 255 255 / 0.35), inset 0 0 0 0.5px var(--chip-ring), 0 0 0 1.5px var(--fluted-ground), 0 0 0 2.5px ${ring}`,
      }}
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
  // The tenant's brand colour: a thin ring around the monogram, never a fill. Decorative (the tile is aria-hidden).
  const accent = org?.accentColor ?? null;
  const others = me.memberships.length > 1 || (!org && me.memberships.length > 0);

  const summary = org ? (
    <>
      <OrgTile name={org.name} type={org.type} accent={accent} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-callout font-semibold text-label" title={org.name}>
          {org.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-footnote text-label-secondary">
          <span className="truncate">{me.role?.name}</span>
          <Badge size="sm" tone={org.type === 'competition' ? 'gold' : 'neutral'} className="shrink-0">
            {ORG_TYPE_LABEL[org.type]}
          </Badge>
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

  // Row radius = tile radius (10) + inset (8): concentric with the monogram on hover.
  const base = cn('flex w-full items-center gap-3 rounded-[18px] p-2', className);

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

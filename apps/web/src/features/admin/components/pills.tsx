'use client';

import type { MembershipStatus, OrganizationStatus, OrganizationType } from '@athena/shared';
import { Building2, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { roleTone } from '../format';

export function RolePill({
  role,
  size = 'sm',
  className,
}: {
  role: { key: string; name: string; isSystem?: boolean };
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Badge size={size} tone={roleTone(role.key)} className={className}>
      {role.name}
    </Badge>
  );
}

/**
 * A membership's status, shown only when it is the exception: an active member shows nothing,
 * so a table of people does not repeat "Active" on every row.
 */
export function MemberStatus({
  status,
  accountStatus,
}: {
  status: MembershipStatus;
  accountStatus?: 'active' | 'disabled';
}) {
  if (accountStatus === 'disabled') {
    return <span className="text-footnote font-medium text-accent-text">Disabled</span>;
  }
  return status === 'active' ? null : (
    <span className="text-footnote font-medium text-accent-text">Suspended</span>
  );
}

export const ORG_TYPE_COPY: Record<
  OrganizationType,
  { label: string; plural: string; description: string }
> = {
  institution: {
    label: 'Institution',
    plural: 'Institutions',
    description: 'Schools, colleges and universities running courses and term exams.',
  },
  competition: {
    label: 'Competition',
    plural: 'Competitions',
    description: 'Organizers of contests, olympiads and qualifiers with ranked results.',
  },
};

export function OrgTypeBadge({
  type,
  size = 'sm',
}: {
  type: OrganizationType;
  size?: 'sm' | 'md';
}) {
  const Icon = type === 'competition' ? Trophy : Building2;
  return (
    <Badge size={size} tone="neutral">
      <Icon aria-hidden />
      {ORG_TYPE_COPY[type].label}
    </Badge>
  );
}

export function OrgStatusBadge({
  status,
  size = 'sm',
}: {
  status: OrganizationStatus;
  size?: 'sm' | 'md';
}) {
  return status === 'active' ? (
    <Badge size={size} tone="neutral">
      Active
    </Badge>
  ) : (
    <Badge size={size} tone="accent">
      Suspended
    </Badge>
  );
}

/**
 * The tenant's monogram on a marble chip (glass in dark themes), like the shell's organisation tile.
 * A tenant's brand colour shows only as a thin ring, never as a fill.
 */
export function TenantTile({
  name,
  type,
  accent,
  size = 36,
  className,
}: {
  name: string;
  type: OrganizationType;
  accent?: string | null;
  size?: number;
  className?: string;
}) {
  const ring = accent && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : null;
  const reduced = useReducedMotion();
  return (
    <span
      aria-hidden
      data-type={type}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center font-medium leading-none text-(--monogram)',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.48),
        letterSpacing: '-0.02em',
        background:
          'linear-gradient(118deg, transparent 38%, var(--marble-vein) 40%, transparent 44%), linear-gradient(158deg, transparent 63%, var(--marble-vein) 64.5%, transparent 67%), radial-gradient(130% 100% at 22% 12%, var(--marble-a), var(--marble-b))',
        boxShadow:
          'inset 0 0.5px 0 rgb(255 255 255 / 0.35), inset 0 0 0 0.5px var(--chip-ring), var(--chip-shadow)',
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
      {ring && (
        // The brand ring grows out from the tile on mount, and again in its new colour when the accent changes.
        <motion.span
          key={ring}
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ boxShadow: `0 0 0 1.5px ${ring}` }}
          initial={reduced ? false : { scale: 0.55, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.35, visualDuration: 0.38, delay: 0.12 }}
        />
      )}
    </span>
  );
}

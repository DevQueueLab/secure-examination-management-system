import type { MembershipStatus, OrganizationStatus, OrganizationType } from '@athena/shared';
import { Building2, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
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

export function MemberStatus({
  status,
  accountStatus,
}: {
  status: MembershipStatus;
  accountStatus?: 'active' | 'disabled';
}) {
  if (accountStatus === 'disabled') {
    return (
      <Badge size="sm" tone="danger" dot>
        Disabled
      </Badge>
    );
  }
  return status === 'active' ? (
    <Badge size="sm" tone="success" dot>
      Active
    </Badge>
  ) : (
    <Badge size="sm" tone="warning" dot>
      Suspended
    </Badge>
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
    <Badge size={size} tone={type === 'competition' ? 'warning' : 'accent'}>
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
    <Badge size={size} tone="success" dot>
      Active
    </Badge>
  ) : (
    <Badge size={size} tone="danger" dot>
      Suspended
    </Badge>
  );
}

/**
 * The tenant's monogram. Uses the tenant's own accent colour when it has set one (branding),
 * otherwise the type colour the shell uses.
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
  const fallback =
    type === 'competition'
      ? 'linear-gradient(180deg,#ff9f0a,#f07800)'
      : 'linear-gradient(180deg,#1585f2,#0064d2)';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-xs',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        fontSize: Math.round(size * 0.42),
        background: accent
          ? `linear-gradient(180deg, color-mix(in oklab, ${accent} 88%, white), ${accent})`
          : fallback,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

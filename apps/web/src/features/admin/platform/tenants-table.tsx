'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { edgeTable } from '../components/edge-table';
import { OrgStatusBadge, OrgTypeBadge, TenantTile } from '../components/pills';
import { formatCount, formatDate, formatDateTime, timeAgo } from '../format';
import type { TenantSummary } from '../types';

/** Tenants with their type, status and aggregate usage. Rows open the tenant. */
export function TenantsTable({
  tenants,
  compact = false,
}: {
  tenants: TenantSummary[];
  compact?: boolean;
}) {
  const router = useRouter();
  return (
    <Table {...edgeTable}>
      <TableHeader>
        <TableRow>
          <TableHead>Organization</TableHead>
          <TableHead className="hidden sm:table-cell">Type</TableHead>
          <TableHead className="hidden sm:table-cell">Status</TableHead>
          <TableHead numeric>People</TableHead>
          <TableHead numeric className="hidden sm:table-cell">
            Exams
          </TableHead>
          <TableHead className="hidden md:table-cell">Created</TableHead>
          {!compact && <TableHead className="hidden lg:table-cell">Last activity</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((t) => {
          const href = `/platform/organizations/${t.id}`;
          return (
            <TableRow
              key={t.id}
              interactive
              onClick={() => router.push(href)}
              className={t.status === 'suspended' ? '[&>td]:opacity-75' : undefined}
            >
              <TableCell className="py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <TenantTile
                    name={t.name}
                    type={t.type}
                    accent={t.branding?.accentColor}
                    size={32}
                  />
                  <div className="min-w-0">
                    <Link
                      href={href}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate font-medium text-label hover:underline"
                    >
                      {t.name}
                    </Link>
                    <p className="truncate font-mono text-caption text-label-tertiary">{t.slug}</p>
                    <p className="mt-1 flex items-center gap-1.5 sm:hidden">
                      <OrgTypeBadge type={t.type} />
                      {t.status === 'suspended' && <OrgStatusBadge status={t.status} />}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <OrgTypeBadge type={t.type} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {t.status === 'suspended' && <OrgStatusBadge status={t.status} />}
              </TableCell>
              <TableCell numeric>
                <span className="text-label">{formatCount(t.members)}</span>
                <span className="hidden text-caption text-label-tertiary sm:block">
                  {formatCount(t.candidates)}{' '}
                  {t.type === 'competition' ? 'competitors' : 'candidates'}
                </span>
              </TableCell>
              <TableCell numeric className="hidden sm:table-cell">
                <span className="text-label">{formatCount(t.exams)}</span>
                {t.liveExams > 0 && (
                  <span className="block text-caption font-medium text-accent-text">
                    {t.liveExams} live
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden text-label-secondary md:table-cell">
                {formatDate(t.createdAt)}
              </TableCell>
              {!compact && (
                <TableCell className="hidden text-label-secondary lg:table-cell">
                  {t.lastActivityAt ? (
                    <time dateTime={t.lastActivityAt} title={formatDateTime(t.lastActivityAt)}>
                      {timeAgo(t.lastActivityAt)}
                    </time>
                  ) : (
                    <span className="text-label-tertiary">None yet</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

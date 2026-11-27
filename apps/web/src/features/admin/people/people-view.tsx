'use client';

import type { MembershipStatus } from '@athena/shared';
import {
  FileUp,
  KeyRound,
  MoreHorizontal,
  PencilLine,
  UserMinus,
  UserPlus,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePeople, useResetPassword, useRoles, useUpdatePerson } from '../api';
import { MemberStatus, RolePill } from '../components/pills';
import { SearchField } from '../components/search-field';
import { formatCount, formatDateTime, timeAgo } from '../format';
import type { PeopleFilters, Person } from '../types';
import { PersonSheet, peopleVocabulary } from './person-sheet';
import { ResetPasswordDialog } from './reset-password-dialog';
import { edgeTable } from '../components/edge-table';
import { motion } from 'motion/react';
import { spring, useReducedMotion } from '@/lib/motion';

/** Rows glide to their new places when a filter changes (FLIP), and new arrivals land with a spring. */
const MotionRow = motion.create(TableRow);

const ALL = '__all';
const PAGE_SIZE = 25;
type StatusFilter = 'all' | MembershipStatus;

export function PeopleView() {
  const { me, can } = useAuth();
  const canManage = can('users.manage');
  const orgType = me?.organization?.type;
  const words = peopleVocabulary(orgType);

  const [q, setQ] = useState('');
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [cohort, setCohort] = useState(ALL);
  const [page, setPage] = useState(1);
  const filters: PeopleFilters = {
    q: q || undefined,
    role: role === ALL ? undefined : role,
    status: status === 'all' ? undefined : status,
    cohort: cohort === ALL ? undefined : cohort,
    page,
    pageSize: PAGE_SIZE,
  };
  const people = usePeople(filters);
  const roles = useRoles();
  const update = useUpdatePerson();
  const reset = useResetPassword();
  const confirm = useConfirm();

  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; person: Person } | null>(
    null,
  );
  const [issued, setIssued] = useState<{ person: Person; password: string } | null>(null);

  const data = people.data;
  const reduced = useReducedMotion();
  // Rows that appear while the filters stay put are arrivals (someone was just added); they land physically.
  const filterKey = JSON.stringify(filters);
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  const settled = data && !people.isPlaceholderData ? data.items : null;
  const arrivals = useMemo(() => {
    const prev = seen.current;
    if (!settled || !prev || prev.key !== filterKey) return new Set<string>();
    return new Set(settled.filter((p) => !prev.ids.has(p.membershipId)).map((p) => p.membershipId));
  }, [settled, filterKey]);
  useEffect(() => {
    if (settled)
      seen.current = { key: filterKey, ids: new Set(settled.map((p) => p.membershipId)) };
  }, [settled, filterKey]);
  const facets = data?.facets;
  const total = data?.total ?? 0;
  const everyone = facets ? facets.statuses.active + facets.statuses.suspended : 0;
  const candidates = facets?.roles.find((r) => r.key === 'candidate')?.count ?? 0;
  const cohorts = useMemo(() => facets?.cohorts.map((c) => c.cohort) ?? [], [facets]);
  const filtered = !!(q || role !== ALL || status !== 'all' || cohort !== ALL);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const change =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };
  const clear = () => {
    setQ('');
    setRole(ALL);
    setStatus('all');
    setCohort(ALL);
    setPage(1);
  };

  const setAccess = async (person: Person, next: MembershipStatus) => {
    if (next === 'suspended') {
      const ok = await confirm({
        title: `Suspend ${person.name}?`,
        description: `They lose access to ${me?.organization?.name ?? 'this organization'} on their next click, including any exam in progress. You can reactivate them at any time.`,
        confirmLabel: 'Suspend',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({ membershipId: person.membershipId, status: next });
      toast.success(
        next === 'suspended' ? `${person.name} is suspended` : `${person.name} can sign in again`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetPassword = async (person: Person) => {
    const ok = await confirm({
      title: `Reset ${person.name}’s password?`,
      description:
        'Athena creates a temporary password and signs them out on every device. They choose a new password at their next sign-in.',
      confirmLabel: 'Reset password',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await reset.mutateAsync(person.membershipId);
      setSheet(null);
      setIssued({ person, password: res.temporaryPassword });
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    }
  };

  const subtitle = facets
    ? everyone === 0
      ? 'Staff and candidates in your organization.'
      : `${formatCount(everyone)} ${everyone === 1 ? 'person' : 'people'}, ${formatCount(candidates)} ${orgType === 'competition' ? 'competitors' : 'candidates'}, ${formatCount(everyone - candidates)} staff`
    : 'Staff and candidates in your organization.';

  return (
    <>
      <PageHeader
        title="People"
        subtitle={subtitle}
        actions={
          canManage ? (
            <>
              <Button asChild variant="gray">
                <Link href="/people/import">
                  <FileUp aria-hidden /> Import
                </Link>
              </Button>
              <Button variant="filled" onClick={() => setSheet({ mode: 'create' })}>
                <UserPlus aria-hidden /> Add person
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
        <SearchField
          value={q}
          onChange={change(setQ)}
          label="Search people"
          placeholder={`Name, email or ${words.externalId.toLowerCase()}`}
          className="xl:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Role"
            className="w-48"
            value={role}
            onValueChange={change(setRole)}
            options={[
              { value: ALL, label: 'All roles' },
              ...(facets?.roles ?? []).map((r) => ({
                value: r.key,
                label: r.name,
                description: `${formatCount(r.count)} ${r.count === 1 ? 'person' : 'people'}`,
              })),
            ]}
          />
          {cohorts.length > 0 && (
            <Select
              aria-label={words.cohort}
              className="w-44"
              value={cohort}
              onValueChange={change(setCohort)}
              options={[
                { value: ALL, label: orgType === 'competition' ? 'All teams' : 'All classes' },
                ...(facets?.cohorts ?? []).map((c) => ({
                  value: c.cohort,
                  label: c.cohort,
                  description: `${formatCount(c.count)} people`,
                })),
              ]}
            />
          )}
          <SegmentedControl<StatusFilter>
            aria-label="Status"
            value={status}
            onValueChange={change(setStatus)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              {
                value: 'suspended',
                label: facets?.statuses.suspended
                  ? `Suspended (${facets.statuses.suspended})`
                  : 'Suspended',
              },
            ]}
          />
          {filtered && (
            <Button variant="plain" size="sm" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {people.isPending ? (
        <SkeletonRows rows={8} />
      ) : people.isError && !data ? (
        <EmptyState
          icon={<Users />}
          title="Couldn’t load people"
          description={errorMessage(people.error)}
          action={
            <Button variant="gray" onClick={() => void people.refetch()}>
              Try again
            </Button>
          }
        />
      ) : total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Users />}
            title="No one matches"
            description="Try a different name, role or status."
            action={
              <Button variant="gray" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title="Bring your people in"
            description="Add staff one at a time, or import every candidate from a spreadsheet with roll numbers and classes."
            action={
              canManage ? (
                <>
                  <Button asChild variant="gray">
                    <Link href="/people/import">Import from CSV</Link>
                  </Button>
                  <Button variant="filled" onClick={() => setSheet({ mode: 'create' })}>
                    Add person
                  </Button>
                </>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-3" aria-busy={people.isFetching || undefined}>
          <Table
            {...edgeTable}
            // Visible overflow so a row gliding to its new place (FLIP) is not clipped by the scroller.
            containerClassName={`${edgeTable.containerClassName} overflow-visible`}
          >
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="hidden md:table-cell">{words.externalId}</TableHead>
                <TableHead className="hidden lg:table-cell">{words.cohort}</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden sm:table-cell">Last sign-in</TableHead>
                {canManage && (
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.items.map((p) => {
                const self = p.userId === me?.user.id;
                return (
                  <MotionRow
                    key={p.membershipId}
                    layout={reduced ? false : 'position'}
                    transition={spring.gentle}
                    initial={
                      !reduced && arrivals.has(p.membershipId)
                        ? { opacity: 0, y: -14, scale: 0.985 }
                        : false
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    interactive={canManage}
                    onClick={canManage ? () => setSheet({ mode: 'edit', person: p }) : undefined}
                    className={p.status === 'suspended' ? '[&>td]:opacity-70' : undefined}
                  >
                    <TableCell className="py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={p.name} size="md" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium text-label">
                            {p.name}
                            {self && (
                              <Badge size="sm" tone="neutral">
                                You
                              </Badge>
                            )}
                          </p>
                          <p className="truncate text-footnote text-label-secondary">{p.email}</p>
                          <p className="mt-1 flex items-center gap-1.5 sm:hidden">
                            <RolePill role={p.role} />
                            {p.status === 'suspended' && (
                              <MemberStatus status={p.status} accountStatus={p.accountStatus} />
                            )}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <RolePill role={p.role} />
                    </TableCell>
                    <TableCell className="hidden tabular-nums text-label-secondary md:table-cell">
                      {p.externalId ?? <span className="text-label-tertiary">—</span>}
                    </TableCell>
                    <TableCell className="hidden text-label-secondary lg:table-cell">
                      {p.cohort ?? <span className="text-label-tertiary">—</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        <MemberStatus status={p.status} accountStatus={p.accountStatus} />
                        {p.mustChangePassword && (
                          <Tooltip content="Hasn’t set their own password yet">
                            <span tabIndex={0} className="inline-flex rounded-sm text-warning-text">
                              <KeyRound aria-label="Temporary password" className="size-3.5" />
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      {p.lastLoginAt ? (
                        <time dateTime={p.lastLoginAt} title={formatDateTime(p.lastLoginAt)}>
                          {timeAgo(p.lastLoginAt)}
                        </time>
                      ) : (
                        <span className="text-label-tertiary">Never</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="py-1.5" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${p.name}`}
                            >
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              icon={<PencilLine />}
                              onSelect={() => setSheet({ mode: 'edit', person: p })}
                            >
                              Edit
                            </DropdownMenuItem>
                            {!self && (
                              <DropdownMenuItem
                                icon={<KeyRound />}
                                onSelect={() => void resetPassword(p)}
                              >
                                Reset password
                              </DropdownMenuItem>
                            )}
                            {!self && <DropdownMenuSeparator />}
                            {!self &&
                              (p.status === 'active' ? (
                                <DropdownMenuItem
                                  destructive
                                  icon={<UserMinus />}
                                  onSelect={() => void setAccess(p, 'suspended')}
                                >
                                  Suspend
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  icon={<UserRoundCheck />}
                                  onSelect={() => void setAccess(p, 'active')}
                                >
                                  Reactivate
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </MotionRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-footnote tabular-nums text-label-secondary">
              {from}–{to} of {formatCount(total)}
            </p>
            {total > PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <Button
                  variant="gray"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="gray"
                  size="sm"
                  disabled={to >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <PersonSheet
        state={sheet}
        onClose={() => setSheet(null)}
        roles={roles.data}
        cohorts={cohorts}
        orgType={orgType}
        onResetPassword={(p) => void resetPassword(p)}
      />
      <ResetPasswordDialog result={issued} onClose={() => setIssued(null)} />
    </>
  );
}

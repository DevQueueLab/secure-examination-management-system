'use client';

import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type Permission,
  type SystemRoleKey,
} from '@athena/shared';
import {
  Activity,
  Building2,
  ClipboardCheck,
  GraduationCap,
  Lock,
  MoreHorizontal,
  PencilLine,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTile } from '@/components/ui/grouped-list';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
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
import { cn } from '@/lib/cn';
import { useDeleteRole, useRoles, useUpdateRole } from '../api';
import { formatCount } from '../format';
import type { Role } from '../types';
import { RoleSheet, type RoleSheetState } from './role-sheet';

const CANDIDATE: Permission[] = ['exams.take', 'results.view_own', 'disputes.raise'];
const LOCK_REASON =
  'Organization Admin always keeps every staff permission, so your organization can never lock itself out of its own settings.';

const ROLE_ICON: Record<
  string,
  { icon: ReactNode; tone: 'accent' | 'info' | 'success' | 'warning' | 'gray' }
> = {
  org_admin: { icon: <Building2 />, tone: 'accent' },
  examiner: { icon: <ClipboardCheck />, tone: 'info' },
  grader: { icon: <PencilLine />, tone: 'success' },
  proctor: { icon: <Activity />, tone: 'warning' },
  candidate: { icon: <GraduationCap />, tone: 'gray' },
};
const iconOf = (r: Role) => ROLE_ICON[r.key] ?? { icon: <UserCog />, tone: 'gray' as const };

const same = (a: readonly Permission[], b: readonly Permission[]) =>
  a.length === b.length && a.every((p) => b.includes(p));

function RolesTable({
  roles,
  countOf,
  onEdit,
}: {
  roles: Role[];
  countOf: (r: Role) => number;
  onEdit?: (r: Role) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Role</TableHead>
          <TableHead numeric>People</TableHead>
          <TableHead numeric>Permissions</TableHead>
          <TableHead className="hidden md:table-cell">Kind</TableHead>
          {onEdit && (
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => {
          const { icon, tone } = iconOf(role);
          const suspended = role.memberCount - role.activeMemberCount;
          return (
            <TableRow key={role.id}>
              <TableCell className="w-full max-w-0 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <IconTile tone={tone} size={32}>
                    {icon}
                  </IconTile>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium text-label">
                      <span className="min-w-0 break-words">{role.name}</span>
                      {role.locked && (
                        <Tooltip content={LOCK_REASON}>
                          <span tabIndex={0} className="inline-flex rounded-sm text-label-tertiary">
                            <Lock aria-label="Locked" className="size-3.5" />
                          </span>
                        </Tooltip>
                      )}
                    </p>
                    <p className="truncate text-footnote text-label-secondary">
                      {role.description || (role.isSystem ? 'Built in' : 'Custom role')}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell numeric>
                <span className="text-label">{formatCount(role.activeMemberCount)}</span>
                {suspended > 0 && (
                  <span className="block whitespace-nowrap text-caption text-label-tertiary">
                    {suspended} suspended
                  </span>
                )}
              </TableCell>
              <TableCell numeric>{countOf(role)}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-label-secondary md:table-cell">
                {role.isSystem ? 'Built in' : 'Custom'}
              </TableCell>
              {onEdit && (
                <TableCell className="py-0">
                  {!role.isSystem && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rename ${role.name}`}
                      onClick={() => onEdit(role)}
                    >
                      <PencilLine aria-hidden />
                    </Button>
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

function RolesSkeleton() {
  return (
    <div role="status" aria-label="Loading roles" className="flex flex-col gap-8">
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

export function RolesView() {
  const { me, can } = useAuth();
  const canManage = can('roles.manage');
  const roles = useRoles();
  const update = useUpdateRole();
  const remove = useDeleteRole();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});
  const [sheet, setSheet] = useState<RoleSheetState | null>(null);
  const [saving, setSaving] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const list = useMemo(() => roles.data ?? [], [roles.data]);
  const mine = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const grantable = (p: Permission) => CANDIDATE.includes(p) || mine.has(p);

  const permsOf = (r: Role) => draft[r.id] ?? r.permissions;
  const changed = list.filter((r) => draft[r.id] && !same(draft[r.id]!, r.permissions));
  const changedCells = (r: Role) => {
    const d = draft[r.id];
    if (!d) return new Set<Permission>();
    const out = new Set<Permission>();
    for (const p of d) if (!r.permissions.includes(p)) out.add(p);
    for (const p of r.permissions) if (!d.includes(p)) out.add(p);
    return out;
  };

  // Leaving with unsaved matrix edits asks first.
  useEffect(() => {
    if (changed.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed.length]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 2400);
    return () => clearTimeout(t);
  }, [fresh]);

  const toggle = (r: Role, p: Permission, on: boolean) =>
    setDraft((d) => {
      const base = d[r.id] ?? r.permissions;
      const next = on ? [...new Set([...base, p])] : base.filter((x) => x !== p);
      return { ...d, [r.id]: next };
    });

  const discard = () => setDraft({});

  const save = async () => {
    setSaving(true);
    const failed: string[] = [];
    for (const r of changed) {
      const perms = draft[r.id]!;
      if (perms.length === 0) {
        failed.push(r.id);
        toast.error(`${r.name} needs at least one permission`);
        continue;
      }
      try {
        await update.mutateAsync({ id: r.id, permissions: perms });
      } catch (err) {
        failed.push(r.id);
        toast.error(`${r.name}: ${errorMessage(err)}`);
      }
    }
    setSaving(false);
    const saved = changed.length - failed.length;
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([id]) => failed.includes(id))));
    if (saved > 0)
      toast.success(
        saved === 1
          ? `Saved ${changed.find((r) => !failed.includes(r.id))?.name}`
          : `Saved ${saved} roles`,
        { description: 'Takes effect on each person’s next click.' },
      );
  };

  const deleteRole = async (r: Role) => {
    if (r.memberCount > 0) {
      toast.error(
        `${r.name} is assigned to ${r.memberCount} ${r.memberCount === 1 ? 'person' : 'people'}`,
        { description: 'Give them another role first, then delete it.' },
      );
      return;
    }
    const ok = await confirm({
      title: `Delete the ${r.name} role?`,
      description: 'No one holds it. The change is recorded in the audit log.',
      confirmLabel: 'Delete role',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(r.id);
      setDraft((d) => {
        const { [r.id]: _, ...rest } = d;
        return rest;
      });
      toast.success(`${r.name} deleted`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const totalPerms = Object.keys(PERMISSIONS).length;
  const pending = changed.reduce((n, r) => n + changedCells(r).size, 0);

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a set of permissions. Each person holds one role in your organization; changes apply on their next click."
        actions={
          canManage ? (
            <Button variant="filled" onClick={() => setSheet({ mode: 'create' })}>
              <Plus aria-hidden /> New role
            </Button>
          ) : undefined
        }
      />

      {roles.isPending ? (
        <RolesSkeleton />
      ) : roles.isError ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Couldn’t load roles"
          description={errorMessage(roles.error)}
          action={
            <Button variant="gray" onClick={() => void roles.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <RolesTable
              roles={list}
              countOf={(r) => permsOf(r).length}
              onEdit={
                canManage && list.some((r) => !r.isSystem)
                  ? (r) => setSheet({ mode: 'edit', role: r })
                  : undefined
              }
            />
            {canManage && !list.some((r) => !r.isSystem) && (
              <p className="px-1 text-footnote text-label-secondary">
                Need a role in between?{' '}
                <button
                  type="button"
                  onClick={() => setSheet({ mode: 'create' })}
                  className="rounded-sm font-medium text-accent-text hover:underline"
                >
                  Add a custom role
                </button>
                , for example a Teaching Assistant who grades but can’t publish results.
              </p>
            )}
          </div>

          <Section
            title="Permissions"
            description={
              canManage
                ? `Tick what each role can do. ${totalPerms} permissions in ${PERMISSION_GROUPS.length} areas. Nothing changes until you save.`
                : 'What each role can do. Only people who can manage roles can change this.'
            }
          >
            <Table containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto">
              <TableHeader className="sticky top-0 z-20 bg-surface">
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-[10.5rem] bg-surface sm:min-w-[15rem]">
                    Permission
                  </TableHead>
                  {list.map((r) => (
                    <TableHead
                      key={r.id}
                      className={cn(
                        'min-w-[6.5rem] text-center align-top',
                        fresh === r.id && 'bg-accent-tint',
                      )}
                    >
                      <div className="flex flex-col items-center gap-1 py-1">
                        <span className="flex items-center gap-1">
                          <span
                            className="max-w-[7rem] truncate text-footnote font-semibold text-label"
                            title={r.name}
                          >
                            {r.name}
                          </span>
                          {r.locked && (
                            <Lock
                              aria-label="Locked"
                              className="size-3 shrink-0 text-label-tertiary"
                            />
                          )}
                        </span>
                        <span className="text-caption font-normal tabular-nums text-label-tertiary">
                          {permsOf(r).length} of {totalPerms}
                        </span>
                        {(!canManage || r.locked) && <span aria-hidden className="h-6" />}
                        {canManage && !r.locked && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${r.name} options`}
                                className="-my-1 size-6"
                              >
                                <MoreHorizontal aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center">
                              {r.isSystem ? (
                                <DropdownMenuItem
                                  icon={<RotateCcw />}
                                  disabled={same(
                                    permsOf(r),
                                    SYSTEM_ROLES[r.key as SystemRoleKey]?.permissions ?? permsOf(r),
                                  )}
                                  onSelect={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      [r.id]: [
                                        ...(SYSTEM_ROLES[r.key as SystemRoleKey]?.permissions ??
                                          r.permissions),
                                      ].filter((p) => grantable(p) || r.permissions.includes(p)),
                                    }))
                                  }
                                >
                                  Restore Athena defaults
                                </DropdownMenuItem>
                              ) : (
                                <>
                                  <DropdownMenuItem
                                    icon={<PencilLine />}
                                    onSelect={() => setSheet({ mode: 'edit', role: r })}
                                  >
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    icon={<Trash2 />}
                                    destructive
                                    onSelect={() => void deleteRole(r)}
                                  >
                                    Delete role
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSION_GROUPS.map((g) => (
                  <Fragment key={g.label}>
                    <TableRow className="bg-fill-secondary">
                      <TableCell className="sticky left-0 z-10 bg-surface-sunken py-2 text-footnote font-semibold text-label-secondary">
                        {g.label}
                      </TableCell>
                      <TableCell colSpan={list.length} className="bg-surface-sunken py-2" />
                    </TableRow>
                    {g.keys.map((p) => (
                      <TableRow key={p} className="hover:bg-fill-secondary/60">
                        <TableCell className="sticky left-0 z-10 bg-surface py-2.5">
                          <p className="text-callout text-label">{PERMISSIONS[p]}</p>
                          <p className="font-mono text-caption text-label-tertiary">{p}</p>
                        </TableCell>
                        {list.map((r) => {
                          const on = permsOf(r).includes(p);
                          const edited = changedCells(r).has(p);
                          const blocked = !grantable(p) && !on;
                          const disabled =
                            !canManage ||
                            r.locked ||
                            saving ||
                            (!grantable(p) && !r.permissions.includes(p));
                          const label = `${r.name}: ${PERMISSIONS[p]}`;
                          const box = (
                            <Checkbox
                              checked={on}
                              disabled={disabled}
                              aria-label={label}
                              onCheckedChange={(v) => toggle(r, p, v === true)}
                            />
                          );
                          return (
                            <TableCell
                              key={r.id}
                              className={cn(
                                'py-2.5 text-center transition-colors',
                                edited && 'bg-accent-tint',
                                fresh === r.id && 'bg-accent-tint/60',
                              )}
                            >
                              <span className="inline-flex justify-center">
                                {r.locked && canManage ? (
                                  <Tooltip content={LOCK_REASON}>
                                    <span tabIndex={-1}>{box}</span>
                                  </Tooltip>
                                ) : blocked && canManage ? (
                                  <Tooltip content="You don’t have this permission yourself, so you can’t grant it.">
                                    <span tabIndex={-1}>{box}</span>
                                  </Tooltip>
                                ) : (
                                  box
                                )}
                              </span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <p className="flex items-start gap-2 text-footnote text-label-secondary">
              <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
              {LOCK_REASON} Roles can’t grant access their editor doesn’t hold.
            </p>
          </Section>
        </div>
      )}

      {changed.length > 0 && (
        <div className="pointer-events-none sticky bottom-4 z-30 mt-6 flex justify-center pb-safe">
          <div
            role="region"
            aria-label="Unsaved changes"
            className="material pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl px-4 py-3 shadow-lg sm:flex-row sm:items-center"
          >
            <p className="min-w-0 flex-1 text-callout text-label">
              <span className="font-semibold tabular-nums">{pending}</span>{' '}
              {pending === 1 ? 'change' : 'changes'} to{' '}
              {changed.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 && (i === changed.length - 1 ? ' and ' : ', ')}
                  <span className="font-medium">{r.name}</span>
                </Fragment>
              ))}
            </p>
            <div className="flex gap-2">
              <Button variant="gray" size="sm" onClick={discard} disabled={saving}>
                Discard
              </Button>
              <Button variant="filled" size="sm" onClick={() => void save()} loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <RoleSheet
        state={sheet}
        roles={list}
        onClose={() => setSheet(null)}
        onCreated={(role) => {
          setSheet(null);
          setFresh(role.id);
        }}
      />
    </>
  );
}

'use client';

import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from '@athena/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCreateRole, useUpdateRole } from '../api';
import type { Role } from '../types';

const CANDIDATE: Permission[] = ['exams.take', 'results.view_own', 'disputes.raise'];
const NONE = '__none';

export type RoleSheetState = { mode: 'create'; from?: string } | { mode: 'edit'; role: Role };

/** Create a custom role (starting from an existing one), or rename a custom role. */
export function RoleSheet({
  state,
  roles,
  onClose,
  onCreated,
}: {
  state: RoleSheetState | null;
  roles: Role[];
  onClose: () => void;
  onCreated: (role: Role) => void;
}) {
  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onClose()}>
      {state?.mode === 'create' && (
        <CreateRole
          key="create"
          roles={roles}
          initialFrom={state.from}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
      {state?.mode === 'edit' && (
        <EditRole key={state.role.id} role={state.role} onClose={onClose} />
      )}
    </Sheet>
  );
}

function CreateRole({
  roles,
  initialFrom,
  onClose,
  onCreated,
}: {
  roles: Role[];
  initialFrom?: string;
  onClose: () => void;
  onCreated: (role: Role) => void;
}) {
  const { me } = useAuth();
  const id = useId();
  const create = useCreateRole();
  const mine = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const grantable = (p: Permission) => CANDIDATE.includes(p) || mine.has(p);
  const templates = roles.filter((r) => !r.locked);
  const startFrom = initialFrom ?? templates.find((r) => r.key === 'grader')?.id ?? NONE;
  const permsOf = (roleId: string) =>
    (roles.find((r) => r.id === roleId)?.permissions ?? []).filter(grantable);

  const [from, setFrom] = useState(startFrom);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Set<Permission>>(
    () => new Set(startFrom === NONE ? [] : permsOf(startFrom)),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggle = (p: Permission, on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Name the role, e.g. Teaching Assistant';
    if (perms.size === 0) next.permissions = 'Choose at least one permission';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const role = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        permissions: [...perms],
      });
      toast.success(`${role.name} role created`, {
        description: 'Assign it to people from the People page.',
      });
      onCreated(role);
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else if (isApiError(err) && err.code === 'ROLE_NAME_TAKEN') setErrors({ name: err.message });
      else toast.error(errorMessage(err));
    }
  };

  return (
    <SheetContent
      title="New role"
      description="A custom role is a named set of permissions. You can fine-tune it in the matrix afterwards."
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Teaching Assistant"
            maxLength={60}
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field
          label="Description"
          error={errors.description}
          hint="Shown when someone picks a role for a person."
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Grades written answers on assigned exams."
            maxLength={240}
            rows={2}
          />
        </Field>
        <Field label="Start from">
          <Select
            value={from}
            onValueChange={(v) => {
              setFrom(v);
              setPerms(new Set(v === NONE ? [] : permsOf(v)));
            }}
            options={[
              { value: NONE, label: 'Nothing', description: 'Pick every permission yourself' },
              ...templates.map((r) => ({
                value: r.id,
                label: r.name,
                description: `${r.permissions.length} permissions`,
              })),
            ]}
          />
        </Field>
        <fieldset
          className="flex flex-col gap-4"
          aria-describedby={errors.permissions ? `${id}-perm-error` : undefined}
        >
          <legend className="mb-1 text-callout font-medium text-label">
            Permissions
            <span className="ml-2 font-normal tabular-nums text-label-secondary">
              {perms.size} selected
            </span>
          </legend>
          {errors.permissions && (
            <p id={`${id}-perm-error`} className="-mt-2 text-footnote text-danger-text">
              {errors.permissions}
            </p>
          )}
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col gap-2.5">
              <p className="text-footnote font-semibold text-label-secondary">{g.label}</p>
              {g.keys.map((p) => (
                <Checkbox
                  key={p}
                  checked={perms.has(p)}
                  disabled={!grantable(p)}
                  onCheckedChange={(v) => toggle(p, v === true)}
                  label={PERMISSIONS[p]}
                  description={
                    grantable(p)
                      ? undefined
                      : 'You don’t have this permission yourself, so you can’t grant it.'
                  }
                />
              ))}
            </div>
          ))}
        </fieldset>
      </form>
      <SheetFooter>
        <Button variant="gray" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="filled"
          className="flex-1"
          type="submit"
          form={`${id}-form`}
          loading={create.isPending}
        >
          Create role
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

function EditRole({ role, onClose }: { role: Role; onClose: () => void }) {
  const id = useId();
  const update = useUpdateRole();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = name.trim() !== role.name || description.trim() !== (role.description ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return onClose();
    if (name.trim().length < 2) return setErrors({ name: 'Use at least 2 characters' });
    try {
      await update.mutateAsync({
        id: role.id,
        ...(name.trim() !== role.name ? { name: name.trim() } : {}),
        ...(description.trim() !== (role.description ?? '')
          ? { description: description.trim() || null }
          : {}),
      });
      toast.success('Role updated');
      onClose();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else if (isApiError(err) && err.code === 'ROLE_NAME_TAKEN') setErrors({ name: err.message });
      else toast.error(errorMessage(err));
    }
  };

  return (
    <SheetContent
      title={`Edit ${role.name}`}
      description="Renaming keeps everyone’s assignment. Permissions are edited in the matrix."
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label="Description" error={errors.description}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            rows={3}
          />
        </Field>
      </form>
      <SheetFooter>
        <Button variant="gray" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="filled"
          className="flex-1"
          type="submit"
          form={`${id}-form`}
          loading={update.isPending}
          disabled={!dirty}
        >
          Save
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

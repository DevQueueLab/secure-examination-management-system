'use client';

import type { OrganizationType, Permission } from '@athena/shared';
import { CircleCheck, KeyRound, UserRoundCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCreatePerson, useUpdatePerson } from '../api';
import { CredentialCard } from '../components/credentials';
import { RolePill } from '../components/pills';
import { formatDate, timeAgo } from '../format';
import type { CreatePersonResult, Person, Role } from '../types';

const CANDIDATE_PERMS: Permission[] = ['exams.take', 'results.view_own', 'disputes.raise'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Words that fit the tenant: a school has roll numbers and classes, a contest has competitor ids and teams. */
export function peopleVocabulary(type: OrganizationType | undefined) {
  return type === 'competition'
    ? {
        externalId: 'Competitor ID',
        externalIdHint: 'Shown on results and reports.',
        cohort: 'Team',
        cohortHint: 'Used to enroll a whole team at once.',
      }
    : {
        externalId: 'Roll number',
        externalIdHint: 'Shown on results and reports.',
        cohort: 'Class or batch',
        cohortHint: 'Used to enroll a whole class at once, e.g. BCS-5A.',
      };
}

/** Role options, with roles that grant more than the caller holds disabled (the API refuses them too). */
export function useRoleOptions(roles: Role[] | undefined) {
  const { me } = useAuth();
  return useMemo(() => {
    const mine = new Set(me?.permissions ?? []);
    return (roles ?? []).map((r) => {
      const beyond = r.permissions.some((p) => !CANDIDATE_PERMS.includes(p) && !mine.has(p));
      return {
        value: r.id,
        label: r.name,
        description: beyond ? 'Has access you don’t have' : (r.description ?? undefined),
        disabled: beyond,
      };
    });
  }, [roles, me]);
}

type Mode = { mode: 'create' } | { mode: 'edit'; person: Person };

interface Props {
  state: Mode | null;
  onClose: () => void;
  roles: Role[] | undefined;
  cohorts: string[];
  orgType: OrganizationType | undefined;
  onResetPassword: (person: Person) => void;
}

/** Add a person, or edit one person's role, identifiers and access. */
export function PersonSheet({ state, onClose, roles, cohorts, orgType, onResetPassword }: Props) {
  const open = !!state;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      {state?.mode === 'create' && (
        <CreateForm
          key="create"
          onClose={onClose}
          roles={roles}
          cohorts={cohorts}
          orgType={orgType}
        />
      )}
      {state?.mode === 'edit' && (
        <EditForm
          key={state.person.membershipId}
          person={state.person}
          onClose={onClose}
          roles={roles}
          cohorts={cohorts}
          orgType={orgType}
          onResetPassword={onResetPassword}
        />
      )}
    </Sheet>
  );
}

function CohortInput({
  id,
  value,
  onChange,
  cohorts,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  cohorts: string[];
  placeholder: string;
}) {
  const listId = `${id}-cohorts`;
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder}
        maxLength={64}
      />
      <datalist id={listId}>
        {cohorts.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

function CreateForm({
  onClose,
  roles,
  cohorts,
  orgType,
}: {
  onClose: () => void;
  roles: Role[] | undefined;
  cohorts: string[];
  orgType: OrganizationType | undefined;
}) {
  const words = peopleVocabulary(orgType);
  const options = useRoleOptions(roles);
  const create = useCreatePerson();
  const id = useId();
  const candidateRole = roles?.find((r) => r.key === 'candidate');
  const [form, setForm] = useState({ name: '', email: '', roleId: '', externalId: '', cohort: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<CreatePersonResult | null>(null);
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!form.roleId && candidateRole) setForm((f) => ({ ...f, roleId: candidateRole.id }));
  }, [candidateRole, form.roleId]);

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter their full name';
    if (!EMAIL.test(form.email.trim())) next.email = 'Enter a valid email address';
    if (!form.roleId) next.roleId = 'Choose a role';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    try {
      const result = await create.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim(),
        roleId: form.roleId,
        externalId: form.externalId.trim() || null,
        cohort: form.cohort.trim() || null,
      });
      setDone(result);
      toast.success(`${result.person.name} added as ${result.person.role.name}`);
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else if (isApiError(err) && err.code === 'EXTERNAL_ID_TAKEN')
        setErrors({ externalId: err.message });
      else toast.error(errorMessage(err));
    }
  };

  const close = async () => {
    if (done?.temporaryPassword && !copied) {
      const ok = await confirm({
        title: 'Close without copying the password?',
        description:
          'It can’t be shown again. You can always reset it later from the person’s menu.',
        confirmLabel: 'Close',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  if (done) {
    return (
      <SheetContent
        closable={false}
        title="Person added"
        description={`${done.person.name} can now sign in to Athena.`}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          void close();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          void close();
        }}
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-xl bg-success-tint px-4 py-3">
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success-text" />
            <p className="text-callout text-label">
              <span className="font-semibold">{done.person.name}</span> joined as{' '}
              <RolePill role={done.person.role} />
            </p>
          </div>
          {done.temporaryPassword ? (
            <CredentialCard
              credential={{
                name: done.person.name,
                email: done.person.email,
                temporaryPassword: done.temporaryPassword,
              }}
              onCopied={() => setCopied(true)}
            />
          ) : (
            <div className="flex gap-3 rounded-xl bg-fill-secondary px-4 py-3">
              <UserRoundCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-label-secondary" />
              <p className="text-callout text-label-secondary">
                {done.person.name} already has an Athena account, so no new password was created.
                They’ll see this organization in their organization menu and were sent a
                notification.
              </p>
            </div>
          )}
        </div>
        <SheetFooter>
          <Button
            variant="gray"
            className="flex-1"
            onClick={() => {
              setDone(null);
              setCopied(false);
              setForm({
                name: '',
                email: '',
                roleId: form.roleId,
                externalId: '',
                cohort: form.cohort,
              });
            }}
          >
            Add another
          </Button>
          <Button variant="filled" className="flex-1" onClick={() => void close()}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    );
  }

  return (
    <SheetContent
      title="Add a person"
      description="They get a temporary password and choose their own at first sign-in."
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Full name" required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="Ayesha Khan"
            autoComplete="off"
            maxLength={120}
            autoFocus
          />
        </Field>
        <Field
          label="Email"
          required
          error={errors.email}
          hint="Their sign-in. One person keeps one account across organizations."
        >
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
            placeholder="ayesha.khan@northfield.edu"
            autoComplete="off"
            maxLength={254}
          />
        </Field>
        <Field label="Role" required error={errors.roleId ?? errors.roleKey}>
          <Select
            options={options}
            value={form.roleId}
            onValueChange={set('roleId')}
            placeholder="Choose a role"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={words.externalId} error={errors.externalId} hint={words.externalIdHint}>
            <Input
              value={form.externalId}
              onChange={(e) => set('externalId')(e.target.value)}
              maxLength={64}
              placeholder={orgType === 'competition' ? 'CS-2026-0042' : 'FA24-BCS-001'}
            />
          </Field>
          <Field label={words.cohort} error={errors.cohort} hint={words.cohortHint}>
            <CohortInput
              id={id}
              value={form.cohort}
              onChange={set('cohort')}
              cohorts={cohorts}
              placeholder={orgType === 'competition' ? 'Team Byte' : 'BCS-5A'}
            />
          </Field>
        </div>
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
          Add person
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

function EditForm({
  person,
  onClose,
  roles,
  cohorts,
  orgType,
  onResetPassword,
}: {
  person: Person;
  onClose: () => void;
  roles: Role[] | undefined;
  cohorts: string[];
  orgType: OrganizationType | undefined;
  onResetPassword: (person: Person) => void;
}) {
  const { me } = useAuth();
  const words = peopleVocabulary(orgType);
  const options = useRoleOptions(roles);
  const update = useUpdatePerson();
  const confirm = useConfirm();
  const id = useId();
  const isSelf = me?.user.id === person.userId;
  const initial = {
    roleId: person.role.id,
    externalId: person.externalId ?? '',
    cohort: person.cohort ?? '',
    active: person.status === 'active',
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty =
    form.roleId !== initial.roleId ||
    form.externalId !== initial.externalId ||
    form.cohort !== initial.cohort ||
    form.active !== initial.active;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return onClose();
    if (!form.active && initial.active) {
      const ok = await confirm({
        title: `Suspend ${person.name}?`,
        description: `They lose access to ${me?.organization?.name ?? 'this organization'} on their next click, including any exam in progress. Their history is kept and you can reactivate them at any time.`,
        confirmLabel: 'Suspend',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({
        membershipId: person.membershipId,
        ...(form.roleId !== initial.roleId ? { roleId: form.roleId } : {}),
        ...(form.externalId !== initial.externalId
          ? { externalId: form.externalId.trim() || null }
          : {}),
        ...(form.cohort !== initial.cohort ? { cohort: form.cohort.trim() || null } : {}),
        ...(form.active !== initial.active
          ? { status: form.active ? ('active' as const) : ('suspended' as const) }
          : {}),
      });
      toast.success(`Saved changes to ${person.name}`);
      onClose();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else if (isApiError(err) && err.code === 'EXTERNAL_ID_TAKEN')
        setErrors({ externalId: err.message });
      else toast.error(errorMessage(err));
    }
  };

  return (
    <SheetContent title={person.name} description={person.email}>
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar name={person.name} size="lg" />
          <div className="min-w-0 text-footnote text-label-secondary">
            <p className="flex flex-wrap gap-x-3">
              <span>Joined {formatDate(person.joinedAt)}</span>
              <span>Last sign-in {person.lastLoginAt ? timeAgo(person.lastLoginAt) : 'never'}</span>
            </p>
            {person.mustChangePassword && (
              <p className="mt-0.5 flex items-center gap-1 text-warning-text">
                <KeyRound aria-hidden className="size-3.5" /> Still using a temporary password
              </p>
            )}
          </div>
        </div>
        <Field
          label="Role"
          error={errors.roleId ?? errors.roleKey}
          hint="Takes effect on their next click. Changes are recorded in the audit log."
        >
          <Select
            options={options}
            value={form.roleId}
            onValueChange={(v) => setForm((f) => ({ ...f, roleId: v }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={words.externalId} error={errors.externalId}>
            <Input
              value={form.externalId}
              onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              maxLength={64}
            />
          </Field>
          <Field label={words.cohort} error={errors.cohort}>
            <CohortInput
              id={id}
              value={form.cohort}
              onChange={(v) => setForm((f) => ({ ...f, cohort: v }))}
              cohorts={cohorts}
              placeholder=""
            />
          </Field>
        </div>
        <div className="rounded-xl bg-fill-secondary px-4 py-3">
          <Switch
            label="Access"
            description={
              isSelf
                ? 'You can’t suspend yourself.'
                : form.active
                  ? `Can sign in and work in ${me?.organization?.name ?? 'this organization'}.`
                  : 'Suspended: cannot open anything in this organization.'
            }
            checked={form.active}
            disabled={isSelf}
            onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
          />
        </div>
        {!isSelf && (
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="min-w-0">
              <p className="text-callout font-medium text-label">Password</p>
              <p className="text-footnote text-label-secondary">
                Issue a temporary password and sign them out everywhere.
              </p>
            </div>
            <Button variant="gray" size="sm" onClick={() => onResetPassword(person)}>
              <KeyRound aria-hidden /> Reset
            </Button>
          </div>
        )}
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
          Save changes
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

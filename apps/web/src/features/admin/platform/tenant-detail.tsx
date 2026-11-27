'use client';

import { EXAM_PHASES } from '@athena/shared';
import {
  Activity,
  Ban,
  Building2,
  CirclePlay,
  LockKeyhole,
  PencilLine,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/alert-dialog';
import { errorMessage, isApiError } from '@/lib/api';
import { MetricStrip } from '../components/metric-strip';
import { useReactivateTenant, useSuspendTenant, useTenant, useUpdateTenant } from '../api';
import {
  MemberStatus,
  OrgStatusBadge,
  OrgTypeBadge,
  RolePill,
  TenantTile,
} from '../components/pills';
import { formatCount, formatDate, formatDateTime, timeAgo } from '../format';
import type { TenantDetail as Tenant } from '../types';

function SuspendDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: Tenant;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const suspend = useSuspendTenant();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const live = tenant.counts.attempts.inProgressNow;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5)
      return setError('Say why, in a few words. The organization’s admins see this reason.');
    try {
      await suspend.mutateAsync({ id: tenant.id, reason: reason.trim() });
      toast.success(`${tenant.name} is suspended`, {
        description: 'Its members were signed out of it immediately.',
      });
      setReason('');
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err) && err.fields.reason) setError(err.fields.reason);
      else toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate>
          <DialogHeader
            title={`Suspend ${tenant.name}?`}
            description="Everyone in it loses access on their next click. Nothing is deleted, and you can reactivate it at any time."
          />
          <DialogBody className="flex flex-col gap-4">
            {live > 0 && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg bg-danger-tint px-3.5 py-3"
              >
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />
                <p className="text-callout text-label">
                  <span className="font-semibold">
                    {live} {live === 1 ? 'candidate is' : 'candidates are'} in an exam right now.
                  </span>{' '}
                  Their answers are kept, but they can’t continue until you reactivate.
                </p>
              </div>
            )}
            <Field label="Reason" required error={error} hint="Recorded in the platform audit log.">
              <Textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                placeholder="Contract ended on 30 November"
                maxLength={500}
                rows={3}
                autoFocus
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="gray" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" type="submit" loading={suspend.isPending}>
              Suspend organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSheet({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: Tenant;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useUpdateTenant();
  const init = {
    name: tenant.name,
    contactEmail: tenant.contactEmail ?? '',
    accent: tenant.branding?.accentColor ?? '',
    tagline: tenant.branding?.tagline ?? '',
  };
  const [form, setForm] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: tenant.id,
        ...(form.name.trim() !== init.name ? { name: form.name.trim() } : {}),
        ...(form.contactEmail.trim() !== init.contactEmail
          ? { contactEmail: form.contactEmail.trim() || null }
          : {}),
        branding: {
          ...(form.accent.trim() !== init.accent
            ? { accentColor: form.accent.trim() || null }
            : {}),
          ...(form.tagline.trim() !== init.tagline ? { tagline: form.tagline.trim() || null } : {}),
        },
      });
      toast.success('Organization updated');
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) {
        setErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([k, v]) => [
              k.replace(/^branding\./, '').replace('accentColor', 'accent'),
              v,
            ]),
          ),
        );
      } else toast.error(errorMessage(err));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent
          title={`Edit ${tenant.name}`}
          description="The address and type are fixed once a tenant is onboarded."
        >
          <form id="tenant-edit" onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field label="Name" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Contact email" error={errors.contactEmail}>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail')(e.target.value)}
                maxLength={254}
              />
            </Field>
            <Field
              label="Accent colour"
              error={errors.accent}
              hint="Hex, for example #9C1220. Leave empty for Athena’s colour."
            >
              <Input
                value={form.accent}
                onChange={(e) => set('accent')(e.target.value)}
                maxLength={7}
                className="font-mono"
                leading={
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-separator"
                    style={{
                      background: /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(form.accent)
                        ? form.accent.startsWith('#')
                          ? form.accent
                          : `#${form.accent}`
                        : 'transparent',
                    }}
                  />
                }
              />
            </Field>
            <Field label="Tagline" error={errors.tagline}>
              <Input
                value={form.tagline}
                onChange={(e) => set('tagline')(e.target.value)}
                maxLength={120}
              />
            </Field>
          </form>
          <SheetFooter>
            <Button variant="gray" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="filled"
              className="flex-1"
              type="submit"
              form="tenant-edit"
              loading={update.isPending}
            >
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      )}
    </Sheet>
  );
}

const ACTIVITY_VERB: Record<string, string> = {
  'platform.organization_onboarded': 'Onboarded',
  'platform.organization_suspended': 'Suspended',
  'platform.organization_reactivated': 'Reactivated',
  'platform.organization_updated': 'Updated',
};

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading organization" className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function TenantDetail({ id }: { id: string }) {
  const tenant = useTenant(id);
  const reactivate = useReactivateTenant();
  const confirm = useConfirm();
  const [suspending, setSuspending] = useState(false);
  const [editing, setEditing] = useState(false);

  if (tenant.isPending) return <DetailSkeleton />;
  if (tenant.isError) {
    const notFound =
      isApiError(tenant.error) && (tenant.error.status === 404 || tenant.error.status === 422);
    return (
      <>
        <PageHeader
          title={notFound ? 'Organization not found' : 'Organization'}
          breadcrumbs={[
            { label: 'Platform', href: '/platform' },
            { label: 'Organizations', href: '/platform/organizations' },
          ]}
        />
        <EmptyState
          icon={<Building2 />}
          title={notFound ? 'This organization doesn’t exist' : 'Couldn’t load this organization'}
          description={
            notFound
              ? 'It may have been removed, or the link is wrong.'
              : errorMessage(tenant.error)
          }
          action={
            notFound ? undefined : (
              <Button variant="gray" onClick={() => void tenant.refetch()}>
                Try again
              </Button>
            )
          }
        />
      </>
    );
  }

  const t = tenant.data;
  const c = t.counts;
  const suspended = t.status === 'suspended';
  const people = t.type === 'competition' ? 'competitors' : 'candidates';

  const doReactivate = async () => {
    const ok = await confirm({
      title: `Reactivate ${t.name}?`,
      description:
        'Its members can sign in again straight away, and its administrators are notified.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    try {
      await reactivate.mutateAsync(t.id);
      toast.success(`${t.name} is active again`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title={t.name}
        breadcrumbs={[
          { label: 'Platform', href: '/platform' },
          { label: 'Organizations', href: '/platform/organizations' },
          { label: t.name },
        ]}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <OrgTypeBadge type={t.type} />
            <OrgStatusBadge status={t.status} />
            <span className="font-mono text-footnote text-label-tertiary">athena.app/{t.slug}</span>
          </span>
        }
        actions={
          <>
            <Button variant="gray" onClick={() => setEditing(true)}>
              <PencilLine aria-hidden /> Edit
            </Button>
            {suspended ? (
              <Button
                variant="filled"
                onClick={() => void doReactivate()}
                loading={reactivate.isPending}
              >
                <CirclePlay aria-hidden /> Reactivate
              </Button>
            ) : (
              <Button variant="destructive-tinted" onClick={() => setSuspending(true)}>
                <Ban aria-hidden /> Suspend
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-10">
        {suspended && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl bg-danger-tint px-4 py-3.5"
          >
            <Ban aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-text" />
            <div className="min-w-0">
              <p className="text-callout font-semibold text-label">
                Suspended{t.suspension ? ` ${timeAgo(t.suspension.at)}` : ''}
                {t.suspension?.by ? ` by ${t.suspension.by}` : ''}
              </p>
              {t.suspension?.reason && (
                <p className="mt-0.5 text-callout text-label-secondary">“{t.suspension.reason}”</p>
              )}
              <p className="mt-1 text-footnote text-label-secondary">
                No one in {t.name} can open anything until it’s reactivated. Its data is untouched.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <TenantTile name={t.name} type={t.type} accent={t.branding?.accentColor} size={56} />
          <div className="min-w-0 text-callout text-label-secondary">
            {t.branding?.tagline && (
              <p className="text-headline text-label">{t.branding.tagline}</p>
            )}
            <p>
              On Athena since {formatDate(t.createdAt)}
              {t.createdBy ? `, onboarded by ${t.createdBy}` : ''}
            </p>
            <p className="flex flex-wrap gap-x-3">
              {t.contactEmail ? (
                <a className="text-accent-text hover:underline" href={`mailto:${t.contactEmail}`}>
                  {t.contactEmail}
                </a>
              ) : (
                <span>No contact email</span>
              )}
              {t.lastActivityAt && <span>Last activity {timeAgo(t.lastActivityAt)}</span>}
            </p>
          </div>
        </div>

        <MetricStrip
          metrics={[
            {
              label: 'People',
              value: formatCount(c.members),
              detail: `${formatCount(t.candidates)} ${people}${c.suspendedMembers ? `, ${c.suspendedMembers} suspended` : ''}`,
            },
            {
              label: 'Exams',
              value: formatCount(c.exams.total),
              detail:
                t.liveExams > 0
                  ? `${t.liveExams} live now`
                  : `${c.exams.byPhase.scheduled} scheduled`,
            },
            {
              label: 'Attempts',
              value: formatCount(c.attempts.total),
              detail: `${formatCount(c.attempts.lastWeek)} this week, ${formatCount(c.attempts.inProgressNow)} in progress`,
            },
            { label: 'Questions', value: formatCount(c.questions), detail: 'In the question bank' },
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Administrators" description="People with the Organization Admin role.">
            {t.admins.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Users />}
                title="No administrators"
                description="This organization has no Organization Admin."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
                {t.admins.map((a) => (
                  <li key={a.membershipId} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={a.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-callout font-medium text-label">{a.name}</p>
                      <p className="truncate text-footnote text-label-secondary">{a.email}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <MemberStatus status={a.status} />
                      <span className="text-caption text-label-tertiary">
                        {a.lastLoginAt ? `Signed in ${timeAgo(a.lastLoginAt)}` : 'Never signed in'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="People by role">
            <ul className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
              {c.byRole.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <RolePill role={r} />
                  <span className="text-callout tabular-nums text-label">
                    {formatCount(r.members)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Exams by phase">
            <ul className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
              {EXAM_PHASES.map((p) => (
                <li key={p} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <PhaseBadge phase={p} />
                  <span className="text-callout tabular-nums text-label">
                    {formatCount(c.exams.byPhase[p] ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Platform activity"
            description="What Athena administrators have done to this organization."
          >
            {t.activity.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Activity />}
                title="No platform activity"
                description="Onboarding, edits and suspensions show here."
              />
            ) : (
              <ol className="flex flex-col divide-y divide-separator rounded-xl bg-surface">
                {t.activity.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <p className="text-callout text-label">
                      <span className="font-semibold">
                        {ACTIVITY_VERB[a.action] ??
                          a.action.replace(/^platform\./, '').replace(/_/g, ' ')}
                      </span>
                      {a.actorName ? (
                        <span className="text-label-secondary"> by {a.actorName}</span>
                      ) : null}
                    </p>
                    {typeof a.metadata.reason === 'string' && a.metadata.reason && (
                      <p className="text-footnote text-label-secondary">“{a.metadata.reason}”</p>
                    )}
                    <time
                      className="text-caption text-label-tertiary"
                      dateTime={a.createdAt}
                      title={formatDateTime(a.createdAt)}
                    >
                      {timeAgo(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <p className="flex items-start gap-2 text-footnote text-label-secondary">
          <LockKeyhole aria-hidden className="mt-px size-3.5 shrink-0" />
          Platform administrators see these counts only. Exam content, answers, grades and the
          organization’s own audit log stay private to {t.name}.
        </p>
      </div>

      <SuspendDialog tenant={t} open={suspending} onOpenChange={setSuspending} />
      <EditSheet key={`${t.id}-${editing}`} tenant={t} open={editing} onOpenChange={setEditing} />
    </>
  );
}

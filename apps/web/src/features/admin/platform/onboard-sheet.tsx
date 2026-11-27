'use client';

import type { OrganizationType } from '@athena/shared';
import { Building2, CircleAlert, CircleCheck, Trophy, UserRoundCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { checkSlug, useOnboard } from '../api';
import { CredentialCard } from '../components/credentials';
import { ORG_TYPE_COPY } from '../components/pills';
import { slugify } from '../format';
import type { OnboardResult, SlugCheck } from '../types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type SlugState =
  | { state: 'idle' }
  | { state: 'checking'; slug: string }
  | { state: 'done'; result: SlugCheck }
  | { state: 'error' };

function localSlugProblem(slug: string): string | null {
  if (!slug) return null;
  if (slug.length < 3) return 'Use at least 3 characters';
  if (slug.length > 40) return 'Use at most 40 characters';
  if (!SLUG.test(slug)) return 'Use lowercase letters, numbers and single hyphens';
  return null;
}

/** Debounced server check of an address, ignoring answers to stale requests. */
function useSlugCheck(slug: string): SlugState {
  const [state, setState] = useState<SlugState>({ state: 'idle' });
  const seq = useRef(0);
  useEffect(() => {
    if (!slug || localSlugProblem(slug)) {
      setState({ state: 'idle' });
      return;
    }
    const n = ++seq.current;
    const ctrl = new AbortController();
    setState({ state: 'checking', slug });
    const t = setTimeout(async () => {
      try {
        const result = await checkSlug(slug, ctrl.signal);
        if (n === seq.current) setState({ state: 'done', result });
      } catch {
        if (n === seq.current && !ctrl.signal.aborted) setState({ state: 'error' });
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug]);
  return state;
}

function TypeOption({
  type,
  selected,
  onSelect,
}: {
  type: OrganizationType;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = type === 'competition' ? Trophy : Building2;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-1 flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150',
        selected
          ? 'border-accent bg-accent-tint shadow-[inset_0_0_0_1px_var(--color-accent)]'
          : 'border-separator bg-surface hover:bg-fill-secondary',
      )}
    >
      <span className="flex items-center gap-2 text-callout font-semibold text-label">
        <Icon
          aria-hidden
          className={cn(
            'size-4',
            type === 'competition' ? 'text-warning-text' : 'text-accent-text',
          )}
        />
        {ORG_TYPE_COPY[type].label}
      </span>
      <span className="text-footnote text-label-secondary">{ORG_TYPE_COPY[type].description}</span>
    </button>
  );
}

function Form({ onDone, onCancel }: { onDone: (r: OnboardResult) => void; onCancel: () => void }) {
  const id = useId();
  const onboard = useOnboard();
  const [type, setType] = useState<OrganizationType>('institution');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const check = useSlugCheck(effectiveSlug);
  const local = localSlugProblem(effectiveSlug);
  const taken = check.state === 'done' && !check.result.available ? check.result : null;

  const clear = (k: string) => errors[k] && setErrors((e) => ({ ...e, [k]: '' }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Enter the organization’s name';
    if (!effectiveSlug) next.slug = 'Choose an address';
    else if (local) next.slug = local;
    else if (taken) next.slug = taken.reason ?? 'This address isn’t available';
    if (!EMAIL.test(contactEmail.trim())) next.contactEmail = 'Enter a valid email address';
    if (adminName.trim().length < 2) next.adminName = 'Enter the administrator’s full name';
    if (!EMAIL.test(adminEmail.trim())) next.adminEmail = 'Enter a valid email address';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    try {
      const result = await onboard.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        type,
        contactEmail: contactEmail.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
      });
      onDone(result);
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    }
  };

  let slugStatus: React.ReactNode = null;
  if (local && effectiveSlug) slugStatus = <span className="text-danger-text">{local}</span>;
  else if (check.state === 'checking')
    slugStatus = (
      <span className="inline-flex items-center gap-1.5 text-label-secondary">
        <Spinner size={12} label={null} /> Checking availability…
      </span>
    );
  else if (check.state === 'done' && check.result.available)
    slugStatus = (
      <span className="inline-flex items-center gap-1.5 text-success-text">
        <CircleCheck aria-hidden className="size-3.5" /> Available
      </span>
    );
  else if (taken)
    slugStatus = (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-danger-text">
        <CircleAlert aria-hidden className="size-3.5" /> {taken.reason}
        {taken.suggestion && (
          <button
            type="button"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
            onClick={() => {
              setSlugTouched(true);
              setSlug(taken.suggestion!);
              clear('slug');
            }}
          >
            Use {taken.suggestion}
          </button>
        )}
      </span>
    );

  return (
    <SheetContent
      title="Onboard an organization"
      description="Creates the tenant with Athena’s standard roles and its first administrator."
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div
          role="radiogroup"
          aria-label="Organization type"
          className="flex flex-col gap-2 sm:flex-row"
        >
          <TypeOption
            type="institution"
            selected={type === 'institution'}
            onSelect={() => setType('institution')}
          />
          <TypeOption
            type="competition"
            selected={type === 'competition'}
            onSelect={() => setType('competition')}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Organization name" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clear('name');
                if (!slugTouched) clear('slug');
              }}
              placeholder={type === 'competition' ? 'CodeSprint Pakistan' : 'Lahore Grammar School'}
              maxLength={120}
              autoFocus
              autoComplete="off"
            />
          </Field>
          <Field
            label="Address"
            required
            error={errors.slug}
            hint={
              errors.slug
                ? undefined
                : (slugStatus ??
                  'Lowercase letters, numbers and hyphens. It can’t be changed later.')
            }
          >
            <Input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                clear('slug');
              }}
              leading={
                <span className="whitespace-nowrap pl-0.5 text-label-tertiary">athena.app/</span>
              }
              placeholder="lahore-grammar"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className="pl-[6.6rem] font-mono"
            />
          </Field>
          {errors.slug && slugStatus && !local && (
            <p className="-mt-2 text-footnote">{slugStatus}</p>
          )}
          <Field
            label="Contact email"
            required
            error={errors.contactEmail}
            hint="For platform notices such as maintenance or a suspension."
          >
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => {
                setContactEmail(e.target.value);
                clear('contactEmail');
              }}
              placeholder="exams@lgs.edu.pk"
              maxLength={254}
              autoComplete="off"
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-4 border-t pt-5">
          <legend className="sr-only">First administrator</legend>
          <div>
            <p className="text-headline text-label">First administrator</p>
            <p className="text-footnote text-label-secondary">
              Gets the Organization Admin role and invites everyone else.
            </p>
          </div>
          <Field label="Full name" required error={errors.adminName}>
            <Input
              value={adminName}
              onChange={(e) => {
                setAdminName(e.target.value);
                clear('adminName');
              }}
              placeholder="Sana Iqbal"
              maxLength={120}
              autoComplete="off"
            />
          </Field>
          <Field
            label="Email"
            required
            error={errors.adminEmail}
            hint="If they already use Athena, the organization is added to their account."
          >
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => {
                setAdminEmail(e.target.value);
                clear('adminEmail');
              }}
              placeholder="sana.iqbal@lgs.edu.pk"
              maxLength={254}
              autoComplete="off"
            />
          </Field>
        </fieldset>
      </form>
      <SheetFooter>
        <Button variant="gray" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="filled"
          className="flex-1"
          type="submit"
          form={`${id}-form`}
          loading={onboard.isPending}
        >
          Onboard organization
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

function Success({ result, onClose }: { result: OnboardResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();
  const close = async () => {
    if (result.temporaryPassword && !copied) {
      const ok = await confirm({
        title: 'Close without copying the password?',
        description: `It can’t be shown again. You could reset it later from ${result.organization.name}’s People page.`,
        confirmLabel: 'Close',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  };
  return (
    <SheetContent
      closable={false}
      title={`${result.organization.name} is ready`}
      description="Its standard roles are in place. Send the administrator their sign-in."
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
        <div className="flex items-start gap-3 rounded-xl bg-success-tint px-4 py-3">
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-text" />
          <p className="text-callout text-label">
            <span className="font-semibold">{result.admin.name}</span> is the Organization Admin of{' '}
            {result.organization.name} at{' '}
            <span className="font-mono text-footnote">athena.app/{result.organization.slug}</span>.
          </p>
        </div>
        {result.temporaryPassword ? (
          <div className="flex flex-col gap-2">
            <p className="text-headline text-label">Administrator sign-in</p>
            <CredentialCard
              credential={{
                name: result.admin.name,
                email: result.admin.email,
                temporaryPassword: result.temporaryPassword,
              }}
              onCopied={() => setCopied(true)}
            />
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl bg-fill-secondary px-4 py-3">
            <UserRoundCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-label-secondary" />
            <p className="text-callout text-label-secondary">
              {result.admin.email} already has an Athena account, so no password was created.
              They’ll find {result.organization.name} in their organization menu, and were sent a
              notification.
            </p>
          </div>
        )}
      </div>
      <SheetFooter>
        <Button asChild variant="gray" className="flex-1">
          <Link
            href={`/platform/organizations/${result.organization.id}`}
            onClick={(e) => {
              if (result.temporaryPassword && !copied) {
                e.preventDefault();
                void close();
              }
            }}
          >
            Open organization
          </Link>
        </Button>
        <Button variant="filled" className="flex-1" onClick={() => void close()}>
          Done
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

/** "Onboard organization": the form, then the one-time administrator credentials. */
export function OnboardSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [round, setRound] = useState(0);
  const close = () => {
    onOpenChange(false);
    // Reset after the sheet has animated out.
    setTimeout(() => {
      setResult(null);
      setRound((r) => r + 1);
    }, 300);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : result ? undefined : close())}
      dismissible={!result}
    >
      {result ? (
        <Success result={result} onClose={close} />
      ) : (
        <Form key={round} onDone={setResult} onCancel={close} />
      )}
    </Sheet>
  );
}

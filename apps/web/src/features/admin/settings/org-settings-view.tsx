'use client';

import { Check, Settings, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useOrgSettings, useUpdateOrgSettings } from '../api';
import { OrgStatusBadge, OrgTypeBadge, TenantTile } from '../components/pills';
import { formatDate } from '../format';
import type { OrgSettings } from '../types';

/** Curated accents that keep white initials legible (contrast at least 3:1). */
const PRESETS = [
  '#0A66D8',
  '#3F51B5',
  '#6E44C9',
  '#B4237A',
  '#C2362F',
  '#B85C00',
  '#1E7A46',
  '#0B7A86',
  '#1D3557',
  '#4A4A4F',
];
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1]!;
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return `#${full.toUpperCase()}`;
}

/** WCAG contrast of white text on the colour. */
function whiteContrast(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return 1.05 / (lum + 0.05);
}

function formOf(s: OrgSettings) {
  return {
    name: s.name,
    contactEmail: s.contactEmail ?? '',
    accent: s.branding.accentColor ?? '',
    tagline: s.branding.tagline ?? '',
  };
}

function SettingsForm({ settings }: { settings: OrgSettings }) {
  const save = useUpdateOrgSettings();
  const [form, setForm] = useState(() => formOf(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initial = formOf(settings);

  useEffect(() => setForm(formOf(settings)), [settings]);

  const accent = form.accent ? normalizeHex(form.accent) : null;
  const accentInvalid = !!form.accent && !accent;
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(
    (k) => form[k].trim() !== initial[k],
  );
  const contrast = accent ? whiteContrast(accent) : null;

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k === 'accent' ? 'accentColor' : k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (accentInvalid) return setErrors({ accentColor: 'Use a hex colour like #0A66D8' });
    try {
      await save.mutateAsync({
        ...(form.name.trim() !== initial.name ? { name: form.name.trim() } : {}),
        ...(form.contactEmail.trim() !== initial.contactEmail
          ? { contactEmail: form.contactEmail.trim() || null }
          : {}),
        branding: {
          ...(form.accent.trim() !== initial.accent ? { accentColor: accent } : {}),
          ...(form.tagline.trim() !== initial.tagline
            ? { tagline: form.tagline.trim() || null }
            : {}),
        },
      });
      toast.success('Organization settings saved');
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) {
        setErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([k, v]) => [k.replace(/^branding\./, ''), v]),
          ),
        );
      } else toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-10">
        <Section
          title="Identity"
          description="How your organization is named across Athena, including on results and reports."
        >
          <div className="flex flex-col gap-4 rounded-xl bg-surface p-5">
            <Field label="Name" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                maxLength={120}
                autoComplete="organization"
              />
            </Field>
            <Field
              label="Contact email"
              error={errors.contactEmail}
              hint="Where Athena sends platform notices about your organization."
            >
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail')(e.target.value)}
                maxLength={254}
                placeholder="exams@northfield.edu"
              />
            </Field>
            <dl className="grid gap-3 border-t pt-4 text-callout sm:grid-cols-3">
              <div>
                <dt className="text-footnote text-label-secondary">Address</dt>
                <dd className="mt-0.5 font-mono text-footnote text-label">{settings.slug}</dd>
              </div>
              <div>
                <dt className="text-footnote text-label-secondary">Type</dt>
                <dd className="mt-1">
                  <OrgTypeBadge type={settings.type} />
                </dd>
              </div>
              <div>
                <dt className="text-footnote text-label-secondary">On Athena since</dt>
                <dd className="mt-0.5 text-label">{formatDate(settings.createdAt)}</dd>
              </div>
            </dl>
            <p className="text-footnote text-label-tertiary">
              The address and type are set when Athena onboards an organization. Contact Athena
              support to change them.
            </p>
          </div>
        </Section>

        <Section
          title="Branding"
          description="Your colour and tagline appear beside your organization’s name on the home page your staff see."
        >
          <div className="flex flex-col gap-5 rounded-xl bg-surface p-5">
            <Field
              label="Accent colour"
              error={
                errors.accentColor ?? (accentInvalid ? 'Use a hex colour like #0A66D8' : undefined)
              }
            >
              <div className="flex flex-col gap-3">
                <div role="radiogroup" aria-label="Preset colours" className="flex flex-wrap gap-2">
                  {PRESETS.map((c) => {
                    const selected = accent === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={c}
                        onClick={() => set('accent')(c)}
                        className={cn(
                          'inline-flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface transition-transform duration-100 active:scale-90',
                          selected && 'ring-2 ring-label',
                        )}
                        style={{ background: c }}
                      >
                        {selected && <Check aria-hidden className="size-4" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <label
                    className="relative inline-flex size-9 shrink-0 cursor-default overflow-hidden rounded-lg border border-separator-strong"
                    title="Pick any colour"
                  >
                    <span className="sr-only">Pick any colour</span>
                    <input
                      type="color"
                      value={accent ?? '#0A66D8'}
                      onChange={(e) => set('accent')(e.target.value.toUpperCase())}
                      className="absolute inset-0 size-full cursor-default opacity-0"
                    />
                    <span
                      aria-hidden
                      className="size-full"
                      style={{ background: accent ?? 'var(--color-fill)' }}
                    />
                  </label>
                  <Input
                    value={form.accent}
                    onChange={(e) => set('accent')(e.target.value)}
                    onBlur={() => accent && set('accent')(accent)}
                    placeholder="#0A66D8"
                    maxLength={7}
                    aria-label="Hex colour"
                    className="w-32 font-mono"
                  />
                  {form.accent && (
                    <Button variant="plain" size="sm" onClick={() => set('accent')('')}>
                      Use Athena default
                    </Button>
                  )}
                </div>
                {contrast !== null && contrast < 3 && (
                  <p className="flex items-center gap-1.5 text-footnote text-warning-text">
                    <TriangleAlert aria-hidden className="size-3.5" /> White initials are hard to
                    read on this colour ({contrast.toFixed(1)}:1). Choose a deeper shade.
                  </p>
                )}
              </div>
            </Field>
            <Field label="Tagline" error={errors.tagline} hint={`${form.tagline.length}/120`}>
              <Input
                value={form.tagline}
                onChange={(e) => set('tagline')(e.target.value)}
                maxLength={120}
                placeholder="Learning, examined fairly"
              />
            </Field>
          </div>
        </Section>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="gray"
            disabled={!dirty || save.isPending}
            onClick={() => setForm(formOf(settings))}
          >
            Reset
          </Button>
          <Button variant="filled" type="submit" disabled={!dirty} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </div>

      <aside aria-label="Preview" className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 px-1 text-footnote font-semibold text-label-secondary">Preview</p>
        <div className="flex flex-col gap-4 rounded-xl bg-surface p-5">
          <div className="flex items-center gap-3">
            <TenantTile
              name={form.name || settings.name}
              type={settings.type}
              accent={accent}
              size={44}
            />
            <div className="min-w-0">
              <p className="truncate text-headline text-label">{form.name || settings.name}</p>
              <p className="truncate text-footnote text-label-secondary">
                {form.tagline || 'No tagline'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <OrgTypeBadge type={settings.type} />
            <OrgStatusBadge status={settings.status} />
          </div>
        </div>
      </aside>
    </form>
  );
}

export function OrgSettingsView() {
  const settings = useOrgSettings();
  return (
    <>
      <PageHeader
        title="Organization settings"
        subtitle="Your organization’s name, contact and branding."
      />
      {settings.isPending ? (
        <div
          role="status"
          aria-label="Loading settings"
          className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]"
        >
          <div className="flex flex-col gap-6">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : settings.isError ? (
        <EmptyState
          icon={<Settings />}
          title="Couldn’t load settings"
          description={errorMessage(settings.error)}
          action={
            <Button variant="gray" onClick={() => void settings.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </>
  );
}

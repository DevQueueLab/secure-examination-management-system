'use client';

import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspacePreferences } from '@athena/shared';
import {
  Check,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Monitor,
  Moon,
  Sun,
  TriangleAlert,
} from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { ORG_TYPE_LABEL } from '@/components/shell/org-switcher';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { GroupedList, GroupedListItem } from '@/components/ui/grouped-list';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTheme, type Appearance } from '@/lib/theme';

const RULES: { label: string; test: (pw: string, current: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (pw) => pw.length >= 10 },
  { label: 'A letter and a number', test: (pw) => /[A-Za-z]/.test(pw) && /[0-9]/.test(pw) },
  {
    label: 'Different from your current password',
    test: (pw, current) => pw.length > 0 && pw !== current,
  },
];

function PasswordInput({
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <Input
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      maxLength={128}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="mr-1 inline-flex size-7 items-center justify-center rounded-md text-label-tertiary transition-colors hover:bg-fill hover:text-label"
        >
          {show ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </button>
      }
    />
  );
}

function ChangePassword({ mustChange, onChanged }: { mustChange: boolean; onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!current) local.currentPassword = 'Enter your current password';
    if (confirm !== next) local.confirm = 'The passwords don’t match';
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      await api.post('/auth/me/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed', {
        description: 'Other devices were signed out. You stay signed in here.',
      });
      onChanged();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-surface p-5">
      {mustChange && (
        <div className="flex items-start gap-3 rounded-lg bg-warning-tint px-3.5 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <p className="text-callout text-label">
            You’re signed in with a temporary password. Choose your own to secure your account.
          </p>
        </div>
      )}
      <Field
        label={mustChange ? 'Temporary password' : 'Current password'}
        required
        error={errors.currentPassword}
      >
        <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
      </Field>
      <Field label="New password" required error={errors.newPassword}>
        <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
      </Field>
      <ul aria-label="Password requirements" className="-mt-1 flex flex-col gap-1">
        {RULES.map((r) => {
          const ok = r.test(next, current);
          return (
            <li
              key={r.label}
              className={cn(
                'flex items-center gap-2 text-footnote',
                ok ? 'text-success-text' : 'text-label-secondary',
              )}
            >
              {ok ? (
                <Check aria-hidden className="size-3.5" strokeWidth={3} />
              ) : (
                <Circle aria-hidden className="size-3" />
              )}
              {r.label}
              <span className="sr-only">{ok ? '(met)' : '(not met yet)'}</span>
            </li>
          );
        })}
      </ul>
      <Field label="Confirm new password" required error={errors.confirm}>
        <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-footnote text-label-secondary">
          Changing it signs you out on your other devices.
        </p>
        <Button
          variant="filled"
          type="submit"
          loading={pending}
          disabled={!current || !next || !confirm}
        >
          Change password
        </Button>
      </div>
    </form>
  );
}

const FONT_STACK: Record<WorkspacePreferences['font'], string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  readable: "'Atkinson Hyperlegible', Verdana, 'Segoe UI', sans-serif",
};
const LEADING: Record<WorkspacePreferences['lineSpacing'], number> = {
  compact: 1.4,
  normal: 1.6,
  relaxed: 1.85,
};

function WorkspacePreview({ prefs }: { prefs: WorkspacePreferences }) {
  const theme = prefs.theme === 'system' ? undefined : prefs.theme;
  const style: CSSProperties = {
    fontFamily: FONT_STACK[prefs.font],
    fontSize: `${prefs.fontScale}rem`,
    lineHeight: LEADING[prefs.lineSpacing],
  };
  return (
    <div
      data-theme={theme}
      className="overflow-hidden rounded-xl border border-separator bg-bg text-label"
      aria-label="Preview of the exam workspace"
    >
      <div className="flex items-center justify-between border-b border-separator bg-surface px-4 py-2 text-footnote text-label-secondary">
        <span className="flex gap-3">
          <span>Question 3 of 12</span>
          <span>5 marks</span>
        </span>
        {prefs.timer !== 'last5' && (
          <span className="tabular-nums">{prefs.timer === 'minimal' ? '42 min' : '00:42:18'}</span>
        )}
      </div>
      <div className="px-4 py-4" style={style}>
        <p className="font-semibold">
          Explain why a hash table offers constant-time lookups on average, and when it degrades.
        </p>
        <p className="mt-2 text-label-secondary">
          A good answer mentions the hash function, collisions and the load factor.
        </p>
        {prefs.showWordCount && (
          <p className="mt-3 text-right text-[0.8em] tabular-nums text-label-tertiary">0 words</p>
        )}
      </div>
    </div>
  );
}

function WorkspacePreferencesForm() {
  const { me, updatePreferences } = useAuth();
  const prefs: WorkspacePreferences = {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    ...(me?.user.preferences ?? {}),
  } as WorkspacePreferences;
  const [local, setLocal] = useState<Partial<WorkspacePreferences>>({});
  const merged = { ...prefs, ...local };

  const change = async <K extends keyof WorkspacePreferences>(
    key: K,
    value: WorkspacePreferences[K],
  ) => {
    setLocal((l) => ({ ...l, [key]: value }));
    try {
      await updatePreferences({ [key]: value } as Partial<WorkspacePreferences>);
    } catch (err) {
      toast.error(`Couldn’t save: ${errorMessage(err)}`);
    } finally {
      setLocal((l) => {
        const { [key]: _, ...rest } = l;
        return rest;
      });
    }
  };

  const isDefault = (
    Object.keys(DEFAULT_WORKSPACE_PREFERENCES) as (keyof WorkspacePreferences)[]
  ).every((k) => merged[k] === DEFAULT_WORKSPACE_PREFERENCES[k]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        <GroupedList header="Reading">
          <GroupedListItem
            title="Theme"
            accessory={
              <SegmentedControl<WorkspacePreferences['theme']>
                aria-label="Exam theme"
                size="sm"
                value={merged.theme}
                onValueChange={(v) => void change('theme', v)}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'sepia', label: 'Sepia' },
                  { value: 'contrast', label: 'Contrast' },
                ]}
              />
            }
          />
          <GroupedListItem
            title="Text size"
            accessory={
              <span className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.85}
                  max={1.6}
                  step={0.05}
                  value={merged.fontScale}
                  aria-label="Text size"
                  aria-valuetext={`${Math.round(merged.fontScale * 100)}%`}
                  onChange={(e) => setLocal((l) => ({ ...l, fontScale: Number(e.target.value) }))}
                  onPointerUp={(e) =>
                    void change('fontScale', Number((e.target as HTMLInputElement).value))
                  }
                  onKeyUp={(e) =>
                    void change('fontScale', Number((e.target as HTMLInputElement).value))
                  }
                  className="w-32 accent-[var(--color-accent)] sm:w-40"
                />
                <span className="w-10 text-right text-footnote tabular-nums text-label-secondary">
                  {Math.round(merged.fontScale * 100)}%
                </span>
              </span>
            }
          />
          <GroupedListItem
            title="Font"
            accessory={
              <SegmentedControl<WorkspacePreferences['font']>
                aria-label="Font"
                size="sm"
                value={merged.font}
                onValueChange={(v) => void change('font', v)}
                options={[
                  { value: 'sans', label: 'Sans' },
                  { value: 'serif', label: 'Serif' },
                  { value: 'readable', label: 'Readable' },
                ]}
              />
            }
          />
          <GroupedListItem
            title="Line spacing"
            accessory={
              <SegmentedControl<WorkspacePreferences['lineSpacing']>
                aria-label="Line spacing"
                size="sm"
                value={merged.lineSpacing}
                onValueChange={(v) => void change('lineSpacing', v)}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'relaxed', label: 'Relaxed' },
                ]}
              />
            }
          />
        </GroupedList>

        <GroupedList
          header="Layout"
          footer="These are your defaults. You can still change them inside an exam, and an exam’s own rules always come first."
        >
          <GroupedListItem
            title="Questions"
            accessory={
              <SegmentedControl<WorkspacePreferences['layout']>
                aria-label="Question layout"
                size="sm"
                value={merged.layout}
                onValueChange={(v) => void change('layout', v)}
                options={[
                  { value: 'paged', label: 'One at a time' },
                  { value: 'scroll', label: 'All on one page' },
                ]}
              />
            }
          />
          <GroupedListItem
            title="Question navigator"
            accessory={
              <Select
                aria-label="Question navigator"
                size="sm"
                className="w-36"
                value={merged.navigator}
                onValueChange={(v) =>
                  void change('navigator', v as WorkspacePreferences['navigator'])
                }
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'hidden', label: 'Hidden' },
                ]}
              />
            }
          />
          <GroupedListItem
            title="Timer"
            accessory={
              <Select
                aria-label="Timer"
                size="sm"
                className="w-44"
                value={merged.timer}
                onValueChange={(v) => void change('timer', v as WorkspacePreferences['timer'])}
                options={[
                  { value: 'always', label: 'Always visible' },
                  { value: 'minimal', label: 'Minutes only' },
                  {
                    value: 'last5',
                    label: 'Last 5 minutes',
                    description: 'Hidden until time is nearly up',
                  },
                ]}
              />
            }
          />
        </GroupedList>

        <GroupedList header="Behaviour">
          <GroupedListItem
            title="Reduce motion"
            description="Fades instead of slides."
            accessory={
              <Switch
                aria-label="Reduce motion"
                checked={merged.reduceMotion}
                onCheckedChange={(v) => void change('reduceMotion', v)}
              />
            }
          />
          <GroupedListItem
            title="Show word count"
            description="On written answers."
            accessory={
              <Switch
                aria-label="Show word count"
                checked={merged.showWordCount}
                onCheckedChange={(v) => void change('showWordCount', v)}
              />
            }
          />
          <GroupedListItem
            title="Confirm before submitting"
            description="Lists unanswered and flagged questions first."
            accessory={
              <Switch
                aria-label="Confirm before submitting"
                checked={merged.confirmBeforeSubmit}
                onCheckedChange={(v) => void change('confirmBeforeSubmit', v)}
              />
            }
          />
        </GroupedList>
      </div>

      <aside
        aria-label="Workspace preview"
        className="flex flex-col gap-3 xl:sticky xl:top-20 xl:self-start"
      >
        <p className="px-1 text-footnote font-semibold text-label-secondary">Preview</p>
        <WorkspacePreview prefs={merged} />
        <Button
          variant="plain"
          size="sm"
          className="self-start"
          disabled={isDefault}
          onClick={async () => {
            try {
              await updatePreferences(DEFAULT_WORKSPACE_PREFERENCES);
              toast.success('Workspace preferences reset');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Reset to defaults
        </Button>
      </aside>
    </div>
  );
}

export function ProfileView() {
  const { me, refetch } = useAuth();
  const { appearance, setAppearance } = useTheme();
  if (!me) return null;
  return (
    <>
      <PageHeader
        title="Profile & preferences"
        subtitle="Your account, how Athena looks, how exams feel, and how you sign in."
      />
      <div className="flex flex-col gap-10">
        <div className="flex max-w-2xl flex-col gap-8">
          <GroupedList
            header="Account"
            footer="Your name and email are managed by your organization. Ask an administrator to correct them."
          >
            <GroupedListItem
              icon={<Avatar name={me.user.name} size="lg" />}
              title={me.user.name}
              description={me.user.email}
            />
            {me.organization && (
              <GroupedListItem
                title="Organization"
                value={`${me.organization.name}, ${ORG_TYPE_LABEL[me.organization.type]}`}
              />
            )}
            {me.role && <GroupedListItem title="Role" value={me.role.name} />}
            {me.user.isPlatformAdmin && !me.organization && (
              <GroupedListItem title="Access" value="Athena platform administrator" />
            )}
          </GroupedList>

          <GroupedList
            header="Appearance"
            footer="System follows your device’s light or dark setting. Exams can also use sepia and high-contrast themes below."
          >
            <GroupedListItem
              title="Theme"
              accessory={
                <SegmentedControl<Appearance>
                  aria-label="Theme"
                  size="sm"
                  value={appearance}
                  onValueChange={setAppearance}
                  options={[
                    { value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
                    { value: 'light', label: 'Light', icon: <Sun aria-hidden /> },
                    { value: 'dark', label: 'Dark', icon: <Moon aria-hidden /> },
                  ]}
                />
              }
            />
          </GroupedList>
        </div>

        <section
          id="password"
          aria-labelledby="password-title"
          className="flex max-w-2xl scroll-mt-24 flex-col gap-2"
        >
          <h2
            id="password-title"
            className="flex items-center gap-2 px-1 text-footnote font-semibold text-label-secondary"
          >
            <KeyRound aria-hidden className="size-3.5" /> Password
          </h2>
          <ChangePassword
            mustChange={me.user.mustChangePassword}
            onChanged={() => void refetch()}
          />
        </section>

        <section aria-labelledby="workspace-title" className="flex flex-col gap-3">
          <div className="px-1">
            <h2 id="workspace-title" className="text-title-3 text-label">
              Exam workspace
            </h2>
            <p className="mt-0.5 text-callout text-label-secondary">
              How questions look while you take an exam. Changes save as you make them.
            </p>
          </div>
          <WorkspacePreferencesForm />
        </section>
      </div>
    </>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Activity,
  ArrowRight,
  Building2,
  CircleAlert,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  Gauge,
  GraduationCap,
  Info,
  PenLine,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AthenaMark, AthenaWordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { GroupedList, GroupedListItem, IconTile } from '@/components/ui/grouped-list';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from '@/config/demo-accounts';
import { isApiError } from '@/lib/api';
import { homePathFor, safeNextPath, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

type Problem = { kind: 'credentials' | 'locked' | 'network' | 'forbidden' | 'other'; title: string; detail?: string };

function describe(error: unknown): Problem {
  if (!isApiError(error)) return { kind: 'other', title: 'Something went wrong', detail: 'Try again in a moment.' };
  if (error.isNetwork) {
    return { kind: 'network', title: 'Can’t reach Athena', detail: 'Check your connection, then try again. Nothing was sent.' };
  }
  if (error.code === 'ACCOUNT_LOCKED') return { kind: 'locked', title: 'Account temporarily locked', detail: error.message };
  if (error.code === 'RATE_LIMITED') return { kind: 'locked', title: 'Too many attempts', detail: error.message };
  if (error.status === 401) return { kind: 'credentials', title: 'Email or password is incorrect', detail: 'Check both and try again.' };
  if (error.status === 403) return { kind: 'forbidden', title: 'Access unavailable', detail: error.message };
  return { kind: 'other', title: 'Couldn’t sign you in', detail: error.message };
}

const problemIcon: Record<Problem['kind'], ReactNode> = {
  credentials: <CircleAlert aria-hidden className="size-[18px] text-danger" />,
  locked: <Clock aria-hidden className="size-[18px] text-warning" />,
  network: <WifiOff aria-hidden className="size-[18px] text-label-secondary" />,
  forbidden: <CircleAlert aria-hidden className="size-[18px] text-danger" />,
  other: <CircleAlert aria-hidden className="size-[18px] text-danger" />,
};

const demoIcon: Record<DemoAccount['icon'], ReactNode> = {
  platform: <Gauge />,
  admin: <Building2 />,
  examiner: <ClipboardCheck />,
  grader: <PenLine />,
  proctor: <Activity />,
  candidate: <GraduationCap />,
};

/** Concentric rounded squares: the security-print pattern behind certificates, drawn as geometry. */
function SealPattern({ className }: { className?: string }) {
  const rings = Array.from({ length: 16 }, (_, i) => i);
  return (
    <svg viewBox="0 0 800 800" aria-hidden className={className} fill="none">
      {rings.map((i) => {
        const size = 120 + i * 44;
        const offset = (800 - size) / 2;
        return (
          <rect
            key={i}
            x={offset}
            y={offset}
            width={size}
            height={size}
            rx={size * 0.24}
            stroke="currentColor"
            strokeWidth={1}
            opacity={0.5 - i * 0.026}
          />
        );
      })}
    </svg>
  );
}

export function SignInView() {
  const { me, signIn, signOut } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const expired = params.get('reason') === 'expired';

  const [problem, setProblem] = useState<Problem | null>(null);
  const [demoPending, setDemoPending] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const busy = isSubmitting || demoPending !== null;

  const finish = (signedIn: Awaited<ReturnType<typeof signIn>>, useNext: boolean) => {
    router.replace(useNext && next ? next : homePathFor(signedIn));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    try {
      const signedIn = await signIn(values.email, values.password);
      finish(signedIn, true);
    } catch (error) {
      if (isApiError(error) && error.isValidation && Object.keys(error.fields).length > 0) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'email' || field === 'password') form.setError(field, { message });
        }
        return;
      }
      const p = describe(error);
      setProblem(p);
      if (p.kind === 'credentials') form.setFocus('password');
    }
  });

  const tryDemo = async (account: DemoAccount) => {
    setProblem(null);
    setDemoPending(account.id);
    try {
      const signedIn = await signIn(account.email, DEMO_PASSWORD);
      finish(signedIn, false);
    } catch (error) {
      setProblem(describe(error));
      setDemoPending(null);
    }
  };

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,14fr)]">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r bg-surface p-10 lg:sticky lg:top-0 lg:flex lg:h-dvh xl:p-12">
        <SealPattern className="pointer-events-none absolute -bottom-[38%] -right-[30%] w-[130%] text-accent" />
        <AthenaWordmark size={30} className="relative" />
        <div className="relative max-w-md">
          <h1 className="text-[2.75rem] font-bold leading-[1.08] tracking-[-0.028em] text-label">Examinations with integrity you can prove.</h1>
          <p className="mt-4 text-body text-label-secondary">
            Northfield Institute of Technology and CodeSprint League run their exams on Athena.
          </p>
        </div>
      </aside>

      {/* Form */}
      <main className="flex flex-col items-center px-5 pb-10 pt-8 sm:px-8 lg:min-h-dvh lg:justify-center lg:py-4">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col gap-4 lg:hidden">
            <AthenaMark size={40} />
            <p className="text-title-2 text-label">Examinations with integrity you can prove.</p>
          </div>

          <div className="mb-5">
            <h2 className="text-title-1 text-label">Sign in</h2>
            <p className="mt-1 text-body text-label-secondary">Use the email your organization gave you.</p>
          </div>

          {me && (
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-callout">
              <span className="min-w-0 flex-1 truncate text-label-secondary">
                Signed in as <span className="font-medium text-label">{me.user.name}</span>
              </span>
              <Button asChild size="sm" variant="tinted">
                <Link href={homePathFor(me)}>
                  Continue <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button size="sm" variant="plain" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          )}

          {expired && !problem && !me && (
            <div role="status" className="mb-5 flex items-start gap-3 rounded-xl bg-info-tint px-4 py-3">
              <Info aria-hidden className="mt-px size-[18px] shrink-0 text-info-text" />
              <p className="text-callout text-label">Your session ended. Sign in again to pick up where you left off.</p>
            </div>
          )}

          {problem && (
            <div
              role="alert"
              className={cn(
                'mb-5 flex items-start gap-3 rounded-xl px-4 py-3',
                problem.kind === 'locked' ? 'bg-warning-tint' : problem.kind === 'network' ? 'bg-fill' : 'bg-danger-tint',
              )}
            >
              <span className="mt-px shrink-0">{problemIcon[problem.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-callout font-semibold text-label">{problem.title}</p>
                {problem.detail && <p className="text-subheadline text-label-secondary">{problem.detail}</p>}
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Sign in">
            <Field label="Email" error={errors.email?.message}>
              <Input
                type="email"
                size="lg"
                className="lg:h-10"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@institution.edu"
                {...form.register('email')}
              />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <Input
                type={reveal ? 'text' : 'password'}
                size="lg"
                className="lg:h-10"
                autoComplete="current-password"
                placeholder="Your password"
                trailing={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                    aria-pressed={reveal}
                    onClick={() => setReveal((v) => !v)}
                    className="rounded-[calc(var(--radius-lg)-4px)]"
                  >
                    {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                }
                {...form.register('password')}
              />
            </Field>
            <Button type="submit" variant="filled" size="lg" block loading={isSubmitting} disabled={busy && !isSubmitting}>
              Sign in
            </Button>
          </form>

          <GroupedList
            className="mt-5"
            header="Try a demo account"
            footer={
              <>
                Signs in instantly. Every demo account uses the password <span className="font-mono text-label">{DEMO_PASSWORD}</span>.
              </>
            }
          >
            {DEMO_ACCOUNTS.map((account) => (
              <GroupedListItem
                key={account.id}
                onClick={() => void tryDemo(account)}
                disabled={busy && demoPending !== account.id}
                icon={<IconTile tone={account.tone}>{demoIcon[account.icon]}</IconTile>}
                title={
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{account.role}</span>
                    <span className="truncate text-subheadline text-label-secondary">{account.name}</span>
                  </span>
                }
                description={account.email}
                accessory={demoPending === account.id ? <Spinner size={16} label={`Signing in as ${account.role}`} /> : undefined}
                chevron={demoPending !== account.id}
                className="py-1.5"
              />
            ))}
          </GroupedList>
        </div>
      </main>
    </div>
  );
}

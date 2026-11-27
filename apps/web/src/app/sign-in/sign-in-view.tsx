'use client';

import { WrittenText } from '@/components/ui/written-text';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Clock, Eye, EyeOff, Info, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, ViewTransition, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount, type DemoOrganization } from '@/config/demo-accounts';
import type { ResolvedImage } from '@/features/landing/brand-assets';
import { isApiError } from '@/lib/api';
import { homePathFor, safeNextPath, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import styles from './sign-in.module.css';

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

const problemTone: Record<Problem['kind'], string | undefined> = {
  credentials: styles.noticeDanger,
  locked: styles.noticeLocked,
  network: styles.noticeNetwork,
  forbidden: styles.noticeDanger,
  other: styles.noticeDanger,
};

/** A file that has not arrived yet hides its <img>, so the box keeps showing the ground instead of a broken image. */
function hideIfBroken(img: HTMLImageElement | null) {
  if (img && img.complete && img.naturalWidth === 0) img.dataset.failed = '';
}

/** One twin of the bust, in the renditions the server found. */
function BustPicture({ image, className }: { image: ResolvedImage | null; className?: string }) {
  if (!image) return null;
  return (
    <picture className={className}>
      {image.sources.map((s) => (
        <source key={s.type} type={s.type} srcSet={s.srcSet} sizes="(min-width: 1024px) 36vw, 96px" />
      ))}
      <img
        // An error before hydration fires no React event, so the ref checks once as well.
        ref={hideIfBroken}
        src={image.src}
        width={image.width}
        height={image.height}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={(e) => {
          e.currentTarget.dataset.failed = '';
        }}
      />
    </picture>
  );
}

export interface SignInViewProps {
  /** The marble twin, shown on the light ground. */
  marble: ResolvedImage | null;
  /** The glass twin, shown on the dark ground. */
  glass: ResolvedImage | null;
  /** The raw `next` search param, read by the server page. Checked with safeNextPath before use. */
  next?: string | null;
  /** `reason=expired`: the session ended, so say so above the form. */
  expired?: boolean;
}

/** Demo accounts grouped by where they live, tenants first. */
const DEMO_GROUPS: { organization: DemoOrganization; label: string }[] = [
  { organization: 'Northfield Institute of Technology', label: 'Northfield Institute of Technology' },
  { organization: 'CodeSprint League', label: 'CodeSprint League' },
  { organization: 'Platform', label: 'Athena platform' },
];

/** The Marks ruler along the art's edge, as on the landing hero: a tick every 2, a numbered tick every 10. */
function EdgeTicks({ className }: { className?: string }) {
  const ticks = Array.from({ length: 51 }, (_, i) => i * 2);
  return (
    <svg aria-hidden className={className} width="24" height="100%">
      {ticks.map((v) => {
        const major = v % 10 === 0;
        const y = `${100 - v}%`;
        // The strip is 24px wide (see .ticks): ticks hang left from its right edge, the seam.
        return <line key={v} x1={24} x2={major ? 10 : 17} y1={y} y2={y} stroke="currentColor" strokeOpacity={major ? 0.7 : 0.4} strokeWidth={1} shapeRendering="crispEdges" />;
      })}
    </svg>
  );
}

export function SignInView({ marble, glass, next: nextParam = null, expired = false }: SignInViewProps) {
  const { me, signIn, signOut } = useAuth();
  const router = useRouter();
  const next = safeNextPath(nextParam);

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
    <div className={styles.page}>
      <header className={styles.brand}>
        <ViewTransition name="athena-wordmark" share="morph" default="none">
          <Link href="/" className={cn(styles.wordmark, 'font-display')} aria-label="Athena, home">
            {/* Writes itself on a direct load; arriving through the morph from / it is already written. */}
            <WrittenText text="Athena" />
          </Link>
        </ViewTransition>
        <p className={styles.statement}>
          Secure online examinations for institutions and competitions: written, delivered, proctored and graded in one place.
        </p>
        <div className={styles.bustStage}>
          <EdgeTicks className={styles.ticks} />
          <ViewTransition name="athena-glass" share="morph" default="none">
            <div className={styles.bust}>
              <BustPicture image={marble} className={styles.marble} />
              <BustPicture image={glass} className={styles.glass} />
            </div>
          </ViewTransition>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.column}>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.lede}>Use the email your organization gave you.</p>

          {me && (
            <div className={styles.signedIn}>
              <p className={styles.signedInText}>
                Signed in as <span className={styles.signedInName}>{me.user.name}</span>
              </p>
              <Button asChild variant="tinted" className={styles.rowButton}>
                <Link href={homePathFor(me)}>Continue</Link>
              </Button>
              <Button variant="plain" className={styles.rowButton} onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          )}

          {expired && !problem && !me && (
            <div role="status" className={cn(styles.notice, styles.noticeExpired)}>
              <span className={styles.noticeGlyph}>
                <Info aria-hidden className="size-[18px]" />
              </span>
              <p>Your session ended. Sign in again to pick up where you left off.</p>
            </div>
          )}

          {problem && (
            <div role="alert" className={cn(styles.notice, problemTone[problem.kind])}>
              <span className={styles.noticeGlyph}>{problemIcon[problem.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className={styles.noticeTitle}>{problem.title}</p>
                {problem.detail && <p className={styles.noticeDetail}>{problem.detail}</p>}
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate className={styles.form} aria-label="Sign in">
            <Field label="Email" error={errors.email?.message}>
              <Input
                type="email"
                size="lg"
                className={styles.input}
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
                className={styles.input}
                autoComplete="current-password"
                placeholder="Your password"
                trailing={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                    aria-pressed={reveal}
                    onClick={() => setReveal((v) => !v)}
                    className={styles.reveal}
                  >
                    {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                }
                {...form.register('password')}
              />
            </Field>
            <Button
              type="submit"
              variant="filled"
              size="lg"
              block
              loading={isSubmitting}
              disabled={busy && !isSubmitting}
              className={styles.submit}
            >
              Sign in
            </Button>
          </form>

          <section className={styles.demo} aria-labelledby="demo-accounts-title">
            <h2 id="demo-accounts-title" className={styles.demoTitle}>
              Try a demo account
            </h2>
            <p className={styles.demoNote}>
              One click signs you in. Every demo account uses the password{' '}
              <span className={styles.password}>{DEMO_PASSWORD}</span>.
            </p>
            <div className="mt-5 flex flex-col gap-6">
              {DEMO_GROUPS.map((group) => {
                const accounts = DEMO_ACCOUNTS.filter((a) => a.organization === group.organization);
                if (accounts.length === 0) return null;
                const id = `demo-${group.organization.replace(/\W+/g, '-').toLowerCase()}`;
                return (
                  <div key={group.organization} role="group" aria-labelledby={id}>
                    <h3 id={id} className="pb-1.5 text-footnote font-medium text-label-secondary">
                      {group.label}
                    </h3>
                    <ul role="list" className="divide-y divide-separator border-y border-separator">
                      {accounts.map((account) => {
                        const pending = demoPending === account.id;
                        return (
                          <li key={account.id}>
                            <button
                              type="button"
                              onClick={() => void tryDemo(account)}
                              disabled={busy && !pending}
                              aria-busy={pending || undefined}
                              className={cn(
                                'group relative flex min-h-11 w-full items-center gap-x-4 px-2 py-2 text-left transition-colors duration-150',
                                'hover:bg-fill-secondary active:bg-fill focus-visible:z-10 disabled:opacity-50',
                              )}
                            >
                              {/* The spaces between the parts keep the button's spoken name readable. */}
                              <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-baseline">
                                <span className="shrink-0 text-callout font-medium text-label transition-colors group-hover:text-accent-text sm:w-36">
                                  {account.role}
                                </span>{' '}
                                <span className="min-w-0 truncate text-callout text-label">{account.name}</span>{' '}
                                <span className="min-w-0 truncate text-footnote text-label-secondary sm:ml-auto sm:text-right">
                                  {account.blurb}
                                </span>
                              </span>
                              <span className="flex w-14 shrink-0 justify-end text-footnote font-medium text-accent-text">
                                {pending ? (
                                  <Spinner size={16} label={`Signing in as ${account.role}`} />
                                ) : (
                                  <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                                    Sign in
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

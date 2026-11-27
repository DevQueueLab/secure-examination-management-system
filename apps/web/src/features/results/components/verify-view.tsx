'use client';

import { CircleAlert, CircleCheck, Search, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtMarks, fmtPercent } from '../../analytics/format';
import { useVerification } from '../api';
import type { VerifyResponse } from '../types';

const CODE_SHAPE = /^ATH-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

function normalise(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = compact.startsWith('ATH') ? compact.slice(3) : compact;
  if (body.length !== 12) return raw.trim().toUpperCase();
  return `ATH-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

function CodeForm({ initial, onSame }: { initial: string; onSame: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalise(value);
        if (!CODE_SHAPE.test(code)) return setError('Codes look like ATH-7K2P-9QXM-4D8R: the letters ATH and three groups of four.');
        setError(null);
        // The same code again is a retry, not a navigation.
        if (code === initial) onSame();
        else router.push(`/verify/${code}`);
      }}
    >
      <Field label="Verification code" error={error ?? undefined} className="flex-1">
        <Input
          size="lg"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ATH-XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="font-mono tracking-wide"
        />
      </Field>
      <Button type="submit" size="lg" variant="filled" className="sm:mt-[1.625rem]">
        <Search /> Check
      </Button>
    </form>
  );
}

function Status({ tone, icon, title, children }: { tone: 'success' | 'warning' | 'danger'; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-2xl px-5 py-4',
        tone === 'success' && 'bg-success-tint',
        tone === 'warning' && 'bg-warning-tint',
        tone === 'danger' && 'bg-danger-tint',
      )}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-6', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{icon}</span>
      <div className="min-w-0">
        <p className="text-title-3 text-label">{title}</p>
        <div className="mt-0.5 text-callout text-label-secondary">{children}</div>
      </div>
    </div>
  );
}

function Details({ v }: { v: VerifyResponse }) {
  const rows: [string, ReactNode][] = [
    ['Candidate', <span key="c" className="font-mono tracking-wider">{v.candidate}</span>],
    ['Examination', v.exam],
    ['Issued by', v.organization],
    ['Score', `${fmtMarks(v.score)} of ${fmtMarks(v.maxScore)} (${fmtPercent(v.percent, 1)})`],
    ['Issued', fmtDate(v.issuedAt)],
    ['Results version', `Version ${v.resultsVersion}`],
    [
      'Signature',
      v.signatureValid ? (
        <span key="s">
          Valid {v.signature.algorithm} signature <span className="font-mono text-footnote text-label-secondary">key {v.signature.keyId}</span>
        </span>
      ) : (
        <span key="s" className="font-medium text-danger-text">
          Does not match the institution’s key
        </span>
      ),
    ],
  ];
  return (
    <dl className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
      {rows.map(([k, val]) => (
        <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="text-subheadline text-label-secondary">{k}</dt>
          <dd className="text-callout text-label">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VerifyView({ code }: { code: string }) {
  const normalised = normalise(code);
  const { data, isPending, error, refetch, isFetching } = useVerification(normalised);

  let body: ReactNode;
  if (isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-label="Checking" role="status">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  } else if (error || !data) {
    const notFound = isApiError(error) && error.isNotFound;
    const limited = isApiError(error) && error.status === 429;
    body = (
      <Status tone={limited ? 'warning' : 'danger'} icon={limited ? <TriangleAlert /> : <CircleAlert />} title={limited ? 'Too many checks' : notFound ? 'Not found' : 'Couldn’t check this code'}>
        {limited
          ? 'Wait a minute, then try again.'
          : notFound
            ? 'No report carries this code. Check it against the document; codes look like ATH-7K2P-9QXM-4D8R.'
            : errorMessage(error)}
        {!limited && !notFound && (
          <div className="mt-3">
            <Button size="sm" variant="gray" loading={isFetching} onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
      </Status>
    );
  } else if (data.valid) {
    body = (
      <>
        <Status tone="success" icon={<CircleCheck />} title="Authentic">
          This result was issued by {data.organization}, its signature matches, and it is still the candidate’s current result.
        </Status>
        <Details v={data} />
      </>
    );
  } else if (data.status === 'superseded') {
    body = (
      <>
        <Status tone="warning" icon={<TriangleAlert />} title="Superseded">
          This report was genuine, but a newer version of the result replaced it {data.supersededAt ? `on ${fmtDateTime(data.supersededAt)}` : 'after it was issued'}, after a regrade or a correction. Ask the candidate for their current report.
        </Status>
        <Details v={data} />
      </>
    );
  } else {
    body = (
      <>
        <Status tone="danger" icon={<CircleAlert />} title={data.status === 'revoked' ? 'Revoked' : 'Not authentic'}>
          {data.status === 'revoked'
            ? `${data.organization} withdrew this report. Don’t rely on it.`
            : 'The details stored for this code don’t match the institution’s signature. Don’t rely on this report.'}
        </Status>
        <Details v={data} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">{body}</div>
      <CodeForm initial={CODE_SHAPE.test(normalised) ? normalised : ''} onSame={() => void refetch()} />
      <section aria-labelledby="privacy" className="flex flex-col gap-2 border-t pt-6">
        <h2 id="privacy" className="text-headline text-label">
          What this page shows
        </h2>
        <p className="text-callout text-label-secondary">
          Only what is printed on the report: the candidate’s initials, the examination, the score and the issue date. Answers, contact details and other results are never shown here.
        </p>
        <p className="text-callout text-label-secondary">
          Each report is signed with the institution’s Ed25519 key when it is issued. This check recomputes the signature against the published key, so an edited PDF or a made-up code fails.
        </p>
      </section>
    </div>
  );
}

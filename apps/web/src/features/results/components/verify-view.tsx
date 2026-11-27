'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtMarks, fmtPercent } from '../../analytics/format';
import { decodeFrame, useMoment } from '../../analytics/components/moment';
import { useVerification } from '../api';
import type { VerifyResponse } from '../types';
import { Seal } from './seal';

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

type VerdictKind = 'authentic' | 'superseded' | 'void' | 'missing' | 'waiting' | 'error';

/** The code as checked, decoded once the first time this tab shows it. */
function CheckedCode({ code }: { code: string }) {
  const t = useMoment(`verify:${code}`, 750);
  return (
    <p className="font-mono text-headline font-medium tracking-wide text-label-secondary">
      <span className="sr-only">Code {code}</span>
      <span aria-hidden>{decodeFrame(code, t)}</span>
    </p>
  );
}

/**
 * The verdict is this page's one moment: a ruled seal and the word itself in the display face.
 * Gold appears only when the API says the report is valid; every other state is graphite, and a forged or
 * revoked report reads in the danger colour.
 */
function Verdict({ kind, title, code, children }: { kind: VerdictKind; title: string; code: string | null; children: ReactNode }) {
  const gold = kind === 'authentic';
  return (
    <div role="status" className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-8">
      <Seal tone={gold ? 'gold' : 'graphite'} glyph={gold ? 'check' : 'none'} size={104} className="sm:size-[7.5rem]" />
      <div className="min-w-0">
        <h2
          className={cn(
            'font-display text-[3rem] font-normal normal-case leading-[1.02] tracking-normal sm:text-[4.25rem]',
            gold ? 'text-gold-text' : kind === 'void' ? 'text-danger-text' : 'text-label',
          )}
        >
          {title}
        </h2>
        {code && (
          <div className="mt-2">
            <CheckedCode code={code} />
          </div>
        )}
        <div className="mt-3 max-w-xl text-body text-label-secondary">{children}</div>
      </div>
    </div>
  );
}

function Details({ v }: { v: VerifyResponse }) {
  const rows: [string, ReactNode][] = [
    ['Candidate', <span key="c" className="font-mono tracking-wider">{v.candidate}</span>],
    ['Examination', v.exam],
    ['Issued by', v.organization],
    [
      'Score',
      <span key="score" className="flex flex-wrap items-baseline gap-x-2">
        <span className="numeral text-title-1 text-label">{fmtMarks(v.score)}</span>
        <span className="text-callout text-label-secondary">
          of {fmtMarks(v.maxScore)}, {fmtPercent(v.percent, 1)}
        </span>
      </span>,
    ],
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
    <dl className="divide-y divide-separator border-y border-separator">
      {rows.map(([k, val]) => (
        <div key={k} className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-4">
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

  const shown = CODE_SHAPE.test(normalised) ? normalised : null;
  let body: ReactNode;
  if (isPending) {
    body = (
      <div className="flex flex-col gap-6" aria-label="Checking" role="status">
        <div className="flex items-center gap-8">
          <Skeleton className="size-[7.5rem] rounded-full" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-64" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  } else if (error || !data) {
    const notFound = isApiError(error) && error.isNotFound;
    const limited = isApiError(error) && error.status === 429;
    body = (
      <Verdict kind={limited ? 'waiting' : notFound ? 'missing' : 'error'} title={limited ? 'Too many checks' : notFound ? 'Not found' : 'Couldn’t check'} code={shown}>
        {limited
          ? 'Wait a minute, then try again.'
          : notFound
            ? 'No report carries this code. Check it against the document; codes look like ATH-7K2P-9QXM-4D8R.'
            : errorMessage(error)}
        {!limited && !notFound && (
          <div className="mt-4">
            <Button size="sm" variant="gray" loading={isFetching} onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
      </Verdict>
    );
  } else if (data.valid) {
    body = (
      <>
        <Verdict kind="authentic" title="Authentic" code={data.code}>
          This result was issued by {data.organization}, its signature matches, and it is still the candidate’s current result.
        </Verdict>
        <Details v={data} />
      </>
    );
  } else if (data.status === 'superseded') {
    body = (
      <>
        <Verdict kind="superseded" title="Superseded" code={data.code}>
          This report was genuine, but a newer version of the result replaced it {data.supersededAt ? `on ${fmtDateTime(data.supersededAt)}` : 'after it was issued'}, after a regrade or a correction. Ask the candidate for their current report.
        </Verdict>
        <Details v={data} />
      </>
    );
  } else {
    body = (
      <>
        <Verdict kind="void" title={data.status === 'revoked' ? 'Revoked' : 'Not authentic'} code={data.code}>
          {data.status === 'revoked'
            ? `${data.organization} withdrew this report. Don’t rely on it.`
            : 'The details stored for this code don’t match the institution’s signature. Don’t rely on this report.'}
        </Verdict>
        <Details v={data} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-10">{body}</div>
      <CodeForm initial={CODE_SHAPE.test(normalised) ? normalised : ''} onSame={() => void refetch()} />
      <section aria-labelledby="privacy" className="flex flex-col gap-2 border-t border-separator pt-6">
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

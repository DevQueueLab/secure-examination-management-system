'use client';

import { Award, Printer, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScoreRule } from '@/components/ui/marks-rule';
import { Breadcrumbs } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { WrittenText } from '@/components/ui/written-text';
import { ShellTitle } from '@/components/shell/shell-title';
import { errorMessage, isApiError } from '@/lib/api';
import { fmtMarks, fmtPercent } from '../../analytics/format';
import { useIssueReport, useMyResult } from '../api';
import { Seal } from '../components/seal';

/**
 * Print as one A4 landscape page: everything but the certificate is hidden, the sheet fills the page, and colours
 * print as shown (gold seal, carmine needle). On screen the sheet keeps the paper (light) palette in every theme.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 0; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #athena-certificate, #athena-certificate * { visibility: visible !important; }
  #athena-certificate {
    position: fixed !important; inset: 0 !important; width: 297mm !important; height: 210mm !important;
    max-width: none !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
}`;

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' }) : null;

export function CertificateView({ attemptId }: { attemptId: string }) {
  const { data, isPending, error } = useMyResult(attemptId);
  const issue = useIssueReport(attemptId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-5 pt-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="aspect-[297/210] w-full max-w-[68rem] rounded-2xl" />
      </div>
    );
  }
  if (error || !data) {
    const missing = isApiError(error) && (error.isNotFound || error.isForbidden);
    return (
      <EmptyState
        className="mt-6"
        icon={<Award />}
        art={missing ? 'column' : undefined}
        title={missing ? 'Result not found' : 'Couldn’t load this result'}
        description={missing ? 'It may belong to another account, or the link is wrong.' : errorMessage(error)}
        action={
          <Button variant="gray" asChild>
            <Link href="/results">All results</Link>
          </Button>
        }
      />
    );
  }
  if (!data.published || data.result.pass !== true) {
    return (
      <EmptyState
        className="mt-6"
        icon={<Award />}
        art="laurel"
        title="No certificate for this result"
        description="A certificate is issued for a published result at or above the pass mark."
        action={
          <Button variant="gray" asChild>
            <Link href={`/results/${attemptId}`}>Back to the result</Link>
          </Button>
        }
      />
    );
  }

  const card = data.result;
  const v = data.verification ?? (issue.data ? { code: issue.data.code, url: issue.data.url, issuedAt: issue.data.issuedAt, qrDataUrl: issue.data.qrDataUrl } : null);
  const passMark = card.exam.passPercent;
  const date = longDate(data.publishedAt ?? card.exam.publishedAt);
  const name = card.candidate.name;

  return (
    <div className="flex flex-col gap-6 pb-10 pt-2 sm:pt-4">
      <style>{PRINT_CSS}</style>
      <ShellTitle title="Certificate" />
      <header className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: 'Results', href: '/results' }, { label: card.exam.title, href: `/results/${attemptId}` }, { label: 'Certificate' }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-title-2 text-label">Certificate</h1>
          <div className="flex flex-wrap gap-2">
            {!v && (
              <Button variant="tinted" loading={issue.isPending} onClick={() => issue.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
                <ShieldCheck /> Add a verification code
              </Button>
            )}
            <Button variant="filled" onClick={() => window.print()}>
              <Printer /> Print or save as PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <article
          id="athena-certificate"
          data-theme="light"
          aria-label={`Certificate for ${name}, ${card.exam.title}`}
          className="relative mx-auto flex w-full max-w-[68rem] flex-col justify-between gap-8 sm:aspect-[297/210] sm:min-w-[40rem] sm:gap-0 overflow-hidden rounded-2xl bg-white p-[5.5%] text-label shadow-[0_1px_2px_rgb(20_24_31/0.06),0_12px_40px_-12px_rgb(20_24_31/0.18)]"
        >
          {/* A hairline double frame, the edge of a printed certificate. */}
          <div aria-hidden className="pointer-events-none absolute inset-[2.2%] rounded-[0.6rem] border border-gold/60" />
          <div aria-hidden className="pointer-events-none absolute inset-[2.9%] rounded-[0.45rem] border border-gold/25" />

          <div className="relative flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-headline text-label">{card.organization.name}</p>
              <p className="mt-1 text-subheadline text-label-secondary">Certificate of result</p>
            </div>
            <Seal tone="gold" size={96} />
          </div>

          <div className="relative flex flex-col gap-3">
            <p className="text-callout text-label-secondary">This certifies that</p>
            <WrittenText
              as="p"
              text={name}
              once={`certificate:${attemptId}`}
              className="font-display text-[clamp(2.25rem,5.2vw,4.25rem)] font-normal leading-[1.05] tracking-normal text-label"
            />
            <p className="max-w-[44rem] text-title-3 font-normal text-label">
              passed {card.exam.title}
              {card.exam.code ? ` (${card.exam.code})` : ''} with{' '}
              <span className="numeral">{fmtMarks(card.score)}</span> of {fmtMarks(card.maxScore)} marks,{' '}
              <span className="numeral">{fmtPercent(card.percent, card.percent % 1 ? 1 : 0)}</span>.
            </p>
            <ScoreRule className="mt-2 max-w-[40rem]" score={card.score} max={card.maxScore} pass={passMark === null ? undefined : (passMark / 100) * card.maxScore} size="md" label="Score on the marks rule" />
          </div>

          <div className="relative flex items-end justify-between gap-6">
            <dl className="flex flex-wrap gap-x-10 gap-y-2">
              {date && (
                <div>
                  <dt className="text-footnote text-label-secondary">Published</dt>
                  <dd className="text-callout text-label">{date}</dd>
                </div>
              )}
              <div>
                <dt className="text-footnote text-label-secondary">Verification code</dt>
                <dd className="font-mono text-callout font-medium tracking-wide text-label">{v ? v.code : 'Not issued yet'}</dd>
              </div>
              {v && (
                <div className="min-w-0">
                  <dt className="text-footnote text-label-secondary">Check it at</dt>
                  <dd className="break-all text-callout text-label">{v.url}</dd>
                </div>
              )}
            </dl>
            {v && (
              // eslint-disable-next-line @next/next/no-img-element -- server-rendered QR data URL
              <img src={v.qrDataUrl} alt={`QR code for verification code ${v.code}`} className="size-24 shrink-0 rounded-lg bg-white p-1 ring-1 ring-separator" />
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

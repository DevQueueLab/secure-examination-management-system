'use client';

import { Check, CircleAlert, Fingerprint, Info } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MarksRule } from '@/components/ui/marks-rule';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useLeakTrace, useScopeExam } from '../api';
import { count, dateTime } from '../format';
import type { CandidateRef, LeakConfidence, LeakExactMatch, LeakExamFinding, LeakObservationView, LeakTraceResult } from '../types';
import { MathText } from './math-text';

const MAX_CHARS = 20_000;

const CONFIDENCE: Record<LeakConfidence, { label: string; tone: Tone; meaning: string }> = {
  exact: { label: 'Exact', tone: 'accent', meaning: 'An invisible mark or watermark code identifies the paper.' },
  strong: { label: 'Strong', tone: 'info', meaning: 'Only one paper fits, on two or more independent details.' },
  weak: { label: 'Weak', tone: 'warning', meaning: 'A few papers fit, or a single detail tells them apart.' },
  none: { label: 'Not traceable', tone: 'neutral', meaning: 'Nothing in the text points to particular papers.' },
};

const LEAD = 'Treat it as a lead, not a verdict. Papers travel: a screenshot gets forwarded, a phone gets borrowed.';
const REPLACE = 'If the exam is still open, consider replacing the leaked questions for candidates who haven’t started.';
const NEXT_STEPS: Record<LeakConfidence, string[]> = {
  exact: [LEAD, 'Speak with the candidate through your academic-integrity process before deciding anything.', REPLACE, 'This trace is in the audit log, so the check can be shown later.'],
  strong: [
    LEAD,
    'Ask whoever found the leak for the original message. A pasted copy may still carry the invisible mark, which would settle it exactly.',
    'Speak with the candidate through your academic-integrity process before deciding anything.',
    REPLACE,
  ],
  weak: [
    'Don’t contact anyone on this alone: more than one paper fits, or only one detail sets a paper apart.',
    'Ask whoever found the leak for the original message or screenshot. A pasted copy may still carry the invisible mark, and a screenshot may show the faint code across the paper.',
    REPLACE,
  ],
  none: [
    'Ask for the original message or screenshot rather than a retyped copy.',
    'If you have a screenshot of the paper, type the faint code tiled across it into the code field.',
    REPLACE,
  ],
};

/** The leak tracer (challenge 5.5): paste text or type a code, get the paper it came from and how sure that is. */
export function LeakTracer({ examId = null }: { examId?: string | null }) {
  const { can } = useAuth();
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const trace = useLeakTrace();
  const scopeExam = useScopeExam(examId);
  const resultRef = useRef<HTMLElement>(null);
  const fields = isApiError(trace.error) ? trace.error.fields : {};
  const scopeLost = !!examId && isApiError(trace.error) && trace.error.status === 404;
  const formError = scopeLost
    ? 'You can’t open that exam, so the trace can’t be limited to it. Search every exam you can open instead.'
    : trace.error && !fields.text && !fields.code
      ? errorMessage(trace.error, 'The trace didn’t run. Try again.')
      : null;

  // A new scope (another exam, or widened to every exam) makes the last result stale.
  const lastScope = useRef(examId);
  useEffect(() => {
    if (lastScope.current === examId) return;
    lastScope.current = examId;
    trace.reset();
  });

  // Move focus to the new result so keyboard and screen reader users land on it.
  useEffect(() => {
    if (trace.data) resultRef.current?.focus();
  }, [trace.data]);

  if (!can('integrity.review')) {
    return (
      <EmptyState
        icon={<Fingerprint />}
        title="For integrity reviewers"
        description="Tracing a leak needs integrity review access. Ask an administrator if your role should include it."
      />
    );
  }

  const empty = !text.trim() && !code.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (empty) return;
    trace.mutate({ text, code, ...(examId ? { examId } : {}) });
  };

  return (
    <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          {examId && (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-subheadline text-label-secondary">
              <span>
                Comparing with <span className="font-medium text-label">{scopeExam.data?.title ?? 'one exam'}</span> only
              </span>
              <Link href="/integrity/leak-tracer" scroll={false} className="font-medium text-accent-text hover:underline">
                Search every exam you can open
              </Link>
            </p>
          )}
          <Field
            label="Paste the leaked text: from a group chat, a forum, or a screenshot’s OCR"
            error={fields.text}
            hint={`${text.length.toLocaleString()} of ${MAX_CHARS.toLocaleString()} characters. Paste it as it was shared: copying keeps the invisible marks, retyping loses them.`}
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoGrow={false}
              rows={10}
              maxLength={MAX_CHARS}
              spellCheck={false}
              className="min-h-64 resize-y"
            />
          </Field>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Field
              label="Watermark code"
              hint="Optional. The faint code tiled across a screenshot of the paper, like 7F3K9Q."
              error={fields.code}
              className="sm:max-w-80 sm:flex-1"
            >
              <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} />
            </Field>
            <div className="flex gap-2 sm:mt-[1.625rem]">
              <Button type="submit" variant="filled" loading={trace.isPending} disabled={empty}>
                Trace
              </Button>
              {(text || code || trace.data) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setText('');
                    setCode('');
                    trace.reset();
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          {formError && (
            <p role="alert" className="flex items-start gap-1.5 text-callout text-danger-text">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {formError}
            </p>
          )}
        </form>
        <p aria-live="polite" className="sr-only">
          {trace.isPending ? 'Tracing the text' : trace.data ? trace.data.headline : ''}
        </p>
        {trace.data && (
          <>
            <LeakResult ref={resultRef} result={trace.data} />
            <NextSteps confidence={trace.data.confidence} />
          </>
        )}
      </div>
      <HowItWorks />
    </div>
  );
}

function LeakResult({ result, ref }: { result: LeakTraceResult; ref: Ref<HTMLElement> }) {
  const confidence = CONFIDENCE[result.confidence];
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="leak-headline" className="flex scroll-mt-24 flex-col gap-6 rounded-xl bg-surface p-5 outline-none sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <ShieldArt />
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id="leak-headline" className="text-balance font-display text-title-1 leading-tight text-label">
            {result.headline}
          </h2>
          <VerdictFigure result={result} />
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-subheadline text-label-secondary">
            <Badge tone={confidence.tone}>{confidence.label}</Badge>
            <span>{confidence.meaning}</span>
          </p>
        </div>
      </header>
      <ol className="flex flex-col gap-5">
        {steps(result).map((step, i) => (
          <Step key={i} {...step} />
        ))}
      </ol>
      <div className="flex flex-col gap-1.5 border-t pt-4 text-footnote text-label-secondary">
        <p>{result.notice}</p>
        {result.input.chars > 0 && (
          <p className="text-label-tertiary" data-numeric>
            {result.searched.scope
              ? `Compared with ${count(result.searched.papers, 'paper')} from ${result.searched.scope.title}.`
              : `Compared with ${count(result.searched.papers, 'paper')} from ${count(result.searched.exams, 'exam')} you can open, from the last ${result.searched.windowDays} days.`}
          </p>
        )}
      </div>
    </section>
  );
}

/** The integrity shield: marble in light themes, glass in dark, as on the landing page. Decorative. */
function ShieldArt() {
  return (
    <div aria-hidden className="relative h-[88px] w-[70px] shrink-0 sm:h-[132px] sm:w-[106px]">
      {(['marble', 'glass'] as const).map((material) => (
        <picture key={material} className="absolute inset-0" style={{ display: material === 'marble' ? 'var(--art-marble)' : 'var(--art-glass)' }}>
          <source srcSet={`/brand/shield-${material}-960.avif`} type="image/avif" />
          <img
            src={`/brand/shield-${material}-960.webp`}
            alt=""
            width={768}
            height={960}
            decoding="async"
            draggable={false}
            className="size-full select-none object-contain [mix-blend-mode:var(--art-blend)]"
          />
        </picture>
      ))}
    </div>
  );
}

/** The one figure that carries the verdict: the decoded paper code, or how few papers still fit. */
function VerdictFigure({ result }: { result: LeakTraceResult }) {
  if (result.exact.length === 1) {
    const m = result.exact[0]!;
    return (
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="numeral text-[2.25rem] leading-none text-label" style={{ letterSpacing: '0.12em' }}>
          {m.code}
        </span>
        <span className="text-subheadline text-label-secondary">
          {m.via.includes('invisible_mark') ? 'Paper code read from the invisible mark' : 'The watermark code you typed'}
        </span>
      </p>
    );
  }
  const f = result.exact.length === 0 ? result.findings.find((x) => x.candidates.length > 0 && !x.closest) : undefined;
  if (!f) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="numeral text-[2.75rem] leading-none text-label">{f.fittingCount}</span>
      <span className="text-subheadline text-label-secondary">of {count(f.papers, 'paper')} fit every detail</span>
    </p>
  );
}

type StepTone = 'good' | 'warn' | 'info';

interface StepProps {
  tone: StepTone;
  title: string;
  children?: ReactNode;
}

const STEP_ICON: Record<StepTone, ReactNode> = {
  good: <Check aria-hidden className="size-3.5" strokeWidth={2.5} />,
  warn: <CircleAlert aria-hidden className="size-3.5" />,
  info: <Info aria-hidden className="size-3.5" />,
};

function Step({ tone, title, children }: StepProps) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
      <span
        className={cn(
          'mt-px flex size-6 items-center justify-center rounded-full',
          tone === 'good' && 'bg-success-tint text-success-text',
          tone === 'warn' && 'bg-warning-tint text-warning-text',
          tone === 'info' && 'bg-fill text-label-secondary',
        )}
      >
        {STEP_ICON[tone]}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-callout font-medium text-label">{title}</p>
        {children && <div className="text-subheadline text-label-secondary">{children}</div>}
      </div>
    </li>
  );
}

function steps(r: LeakTraceResult): StepProps[] {
  const out: StepProps[] = [];
  const hadText = r.input.chars > 0;
  const markCodes = new Set(r.exact.filter((m) => m.via.includes('invisible_mark')).map((m) => m.code));

  if (hadText) {
    if (r.marks.status === 'intact') {
      out.push({ tone: 'good', title: 'Invisible mark found', children: <p>It decodes to a paper code and passes its checksum, so it wasn’t altered.</p> });
    } else if (r.marks.status === 'damaged') {
      out.push({
        tone: 'warn',
        title: 'Invisible marks present, but damaged',
        children: <p>The text came from an Athena paper, then lost part of its mark on the way, so the mark no longer says whose paper it was.</p>,
      });
    } else {
      out.push({
        tone: 'info',
        title: 'No invisible marks',
        children: <p>The text was retyped, photographed or cleaned on the way, so Athena compared it with the papers it served instead.</p>,
      });
    }
  }
  if (r.input.typedCode) {
    const typedMatch = r.exact.some((m) => m.via.includes('typed_code'));
    out.push(
      typedMatch
        ? { tone: 'good', title: `Watermark code ${r.input.typedCode} matches a paper` }
        : r.unknownCodes.includes(r.input.typedCode)
          ? {
              tone: 'warn',
              title: `No paper here has the code ${r.input.typedCode}`,
              children: <p>Check each character against the screenshot. Codes use digits and capital letters, never I, L, O or U.</p>,
            }
          : { tone: 'info', title: `Watermark code ${r.input.typedCode} is from an exam you can’t open` },
    );
  }
  const unknownMarks = r.unknownCodes.filter((c) => c !== r.input.typedCode && !markCodes.has(c));
  if (unknownMarks.length > 0 && r.marks.status === 'intact') {
    out.push({
      tone: 'warn',
      title: 'A mark was found, but no paper in your institution carries it',
      children: <p>It may come from another institution’s paper, or from a paper that has since been deleted.</p>,
    });
  }
  if (r.restricted > 0) {
    out.push({
      tone: 'warn',
      title: r.restricted === 1 ? 'The mark belongs to an exam you can’t open' : `${r.restricted} marks belong to exams you can’t open`,
      children: <p>Ask that exam’s owner or an administrator to run this trace. Athena doesn’t say whose paper it is to people outside the exam.</p>,
    });
  }

  for (const m of r.exact) out.push(...exactSteps(m));
  if (r.exact.length === 0) {
    for (const f of r.findings) out.push(...findingSteps(f));
    if (hadText && r.findings.length === 0) {
      out.push({
        tone: 'info',
        title: 'No exam questions recognised',
        children: <p>Nothing in the text matches a question from the exams you can open. Check that the text is the question itself, not a reply about it.</p>,
      });
    }
  }
  return out;
}

function Person({ candidate, servedAt, aside }: { candidate: CandidateRef; servedAt: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={candidate.name} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-callout font-medium text-label">{candidate.name}</p>
        <p className="flex flex-wrap gap-x-3 text-footnote text-label-secondary">
          {candidate.rollNumber && <span className="tabular-nums">{candidate.rollNumber}</span>}
          <span className="truncate">{candidate.email}</span>
          <span>Paper served {dateTime(servedAt)}</span>
        </p>
      </div>
      {aside && <span className="ml-auto shrink-0 text-footnote tabular-nums text-label-secondary">{aside}</span>}
    </div>
  );
}

function exactSteps(m: LeakExactMatch): StepProps[] {
  const out: StepProps[] = [
    {
      tone: 'good',
      title: m.preview ? `A staff preview of ${m.exam.title}` : `Belongs to ${m.candidate.name}’s paper for ${m.exam.title}`,
      children: (
        <div className="flex flex-col gap-3">
          <Person candidate={m.candidate} servedAt={m.servedAt} />
          {m.preview && <p>{m.candidate.name} opened this paper as a preview, so it never belonged to a candidate.</p>}
          <Link href={`/exams/${m.exam.id}/integrity`} className="self-start text-subheadline font-medium text-accent-text hover:underline">
            Open the integrity review for {m.exam.title}
          </Link>
        </div>
      ),
    },
  ];
  if (m.matchedStems.length > 0) {
    out.push({
      tone: 'info',
      title: `${count(m.matchedStems.length, 'question')} in the text ${m.matchedStems.length === 1 ? 'matches' : 'match'} this paper`,
      children: (
        <ul className="flex flex-wrap gap-1.5">
          {m.matchedStems.map((s) => (
            <li key={s.position} className="inline-flex items-baseline gap-1.5 rounded-md bg-fill px-2 py-0.5 text-footnote text-label">
              <span className="tabular-nums text-label-tertiary">Q{s.position}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (m.corroborated === true) out.push({ tone: 'good', title: 'The numbers and option order in the text agree with this paper' });
  if (m.corroborated === false) {
    out.push({
      tone: 'warn',
      title: 'Some details in the text differ from this paper',
      children: <p>The text may have been edited, or mixed with another candidate’s paper. The mark still says where it started.</p>,
    });
  }
  return out;
}

function findingSteps(f: LeakExamFinding): StepProps[] {
  const out: StepProps[] = [
    {
      tone: 'info',
      title: `Recognised ${count(f.questions.length, 'question')} from ${f.exam.title}`,
      children: (
        <ul className="flex flex-wrap gap-1.5">
          {f.questions.map((q) => (
            <li key={q.questionId} title={q.excerpt} className="rounded-md bg-fill px-2 py-0.5 text-footnote text-label">
              {q.title}
            </li>
          ))}
        </ul>
      ),
    },
  ];
  if (f.observations.length === 0) {
    out.push({
      tone: 'info',
      title: 'Every paper had the same version of these questions',
      children: <p>No numbers, option order or question draw tells the {f.papers} papers apart, so no one is named.</p>,
    });
    return out;
  }
  out.push({ tone: 'info', title: 'Details that tell the papers apart', children: <Observations finding={f} /> });
  if (f.candidates.length === 0) {
    out.push({
      tone: 'info',
      title: `${f.fittingCount} of ${f.papers} papers fit every detail`,
      children: <p>That is too many to name anyone. A pasted copy, or the faint code from a screenshot, would narrow it down.</p>,
    });
    return out;
  }
  const n = f.candidates.length;
  const of = f.candidates[0]!.of;
  out.push({
    tone: f.confidence === 'strong' ? 'good' : 'warn',
    title: f.closest
      ? `No paper fits all ${of} details. ${n === 1 ? 'This one comes' : `These ${n} come`} closest`
      : n === 1
        ? `Only this paper fits all ${count(of, 'detail')}`
        : `These ${n} papers fit all ${of} details equally`,
    children: (
      <ul className="flex flex-col gap-3">
        {f.candidates.map((c) => (
          <li key={c.candidate.attemptId}>
            <Person candidate={c.candidate} servedAt={c.servedAt} aside={`${c.fits} of ${c.of} details`} />
          </li>
        ))}
      </ul>
    ),
  });
  return out;
}

/** How many papers a detail leaves, measured on the Marks rule: carmine for the combined result, ink for each detail. */
function FitBar({ fits, papers, subject = false }: { fits: number; papers: number; subject?: boolean }) {
  const minor = Math.max(1, Math.ceil(papers / 25));
  return (
    <div className="flex flex-col gap-1">
      <p className="text-footnote tabular-nums text-label-secondary">
        Fits {fits} of {count(papers, 'paper')}
      </p>
      <MarksRule
        value={fits}
        max={Math.max(1, papers)}
        label="Papers that fit"
        valueText={`${fits} of ${count(papers, 'paper')}`}
        size="sm"
        marker="fill"
        tone={subject ? 'accent' : 'neutral'}
        ticks={{ major: minor * 5, minor }}
      />
    </div>
  );
}

function Observations({ finding }: { finding: LeakExamFinding }) {
  return (
    <ul className="flex flex-col divide-y divide-separator overflow-hidden rounded-lg bg-bg">
      {finding.observations.map((o, i) => (
        <li key={i} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-center sm:gap-4">
          <ObservationText o={o} />
          <FitBar fits={o.fits} papers={o.papers} />
        </li>
      ))}
      <li className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-center sm:gap-4">
        <p className="text-callout font-medium text-label">All of these together</p>
        <FitBar fits={finding.fittingCount} papers={finding.papers} subject />
      </li>
    </ul>
  );
}

function ObservationText({ o }: { o: LeakObservationView }) {
  return (
    <div className="min-w-0">
      <p className="text-footnote text-label-secondary">{o.title}</p>
      <p className="text-callout text-label">{o.detail}</p>
      {o.sequence && (
        <ol className="mt-1.5 flex flex-wrap gap-1.5">
          {o.sequence.map((s, k) => (
            <li key={k} className="inline-flex items-baseline gap-1.5 rounded-md bg-fill px-2 py-0.5 text-footnote text-label">
              <span className="tabular-nums text-label-tertiary">{k + 1}</span>
              <MathText inline>{s}</MathText>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NextSteps({ confidence }: { confidence: LeakConfidence }) {
  return (
    <section aria-labelledby="leak-next" className="flex flex-col gap-3">
      <h2 id="leak-next" className="text-headline text-label">
        What happens next
      </h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-subheadline text-label-secondary marker:tabular-nums marker:text-label-tertiary">
        {NEXT_STEPS[confidence].map((s) => (
          <li key={s} className="pl-1">
            {s}
          </li>
        ))}
      </ol>
    </section>
  );
}

function HowItWorks() {
  return (
    <aside aria-labelledby="how-fingerprints-work" className="flex flex-col gap-4 text-subheadline text-label-secondary lg:sticky lg:top-24">
      <h2 id="how-fingerprints-work" className="text-headline text-label">
        How fingerprints work
      </h2>
      <p>
        With watermarking on, as it is by default, every paper Athena serves carries its own code, written in invisible characters inside each
        question. Anything copied out of the exam takes the code along, so a pasted copy can name its paper exactly, even after a trip through a
        group chat.
      </p>
      <figure className="flex flex-col gap-2 rounded-lg bg-fill-secondary p-3">
        <p className="text-footnote leading-relaxed text-label">
          State Newton’s second law in words.
          <span className="mx-1 inline-block rounded-sm border border-dashed border-label-tertiary px-1 align-baseline text-caption text-label-tertiary">
            invisible code
          </span>
          Then give one everyday example.
        </p>
        <figcaption className="text-caption text-label-tertiary">The code sits after the first sentence, unseen on screen and in print.</figcaption>
      </figure>
      <p>
        Screenshots and retyped text lose the invisible code. But each paper also has its own numbers, option order and draw of questions, so
        Athena compares what survives with every paper it served and says how many still fit.
      </p>
      <p>The code also shows faintly across the paper on screen, next to the candidate’s name. If a screenshot shows it, type it into the code field.</p>
      <p className="text-footnote text-label-tertiary">
        Only recent exams you can open are searched. Every trace goes in the audit log with a fingerprint of the text, not the text itself.
      </p>
    </aside>
  );
}

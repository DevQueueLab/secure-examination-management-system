'use client';

import { Check, Eye, ShieldAlert, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useRunRemedy } from '../api';
import { REMEDY_COPY, fmtDateTime, fmtMarks, fmtPercent, fmtSigned, plural } from '../format';
import type { AppliedRemedy, RemediesOverview, RemedyQuestion, RemedyReport, RemedyType } from '../types';
import { ChoiceList, ChoiceRow } from './choice-list';
import { Banner, ScoreChange } from './primitives';

const TYPES: RemedyType[] = ['accept_alternatives', 'full_marks_all', 'drop_question'];

interface PayloadState {
  optionIds: string[];
  value: string;
  formula: string;
  tolerance: string;
  answers: string;
  blanks: Record<string, string>;
}

const EMPTY: PayloadState = { optionIds: [], value: '', formula: '', tolerance: '', answers: '', blanks: {} };

function num(text: string): number | undefined {
  const t = text.trim().replace('−', '-').replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

function buildPayload(q: RemedyQuestion, type: RemedyType, p: PayloadState): Record<string, unknown> {
  if (type !== 'accept_alternatives') return {};
  switch (q.type) {
    case 'single_choice':
    case 'true_false':
    case 'multiple_choice':
      return { optionIds: p.optionIds };
    case 'numeric': {
      const out: Record<string, unknown> = {};
      if (q.variables.length) {
        if (p.formula.trim()) out.formula = p.formula.trim();
      } else if (p.value.trim()) out.value = num(p.value);
      if (p.tolerance.trim()) out.tolerance = num(p.tolerance);
      return out;
    }
    case 'short_text':
      return { answers: p.answers.split('\n').map((s) => s.trim()).filter(Boolean) };
    case 'fill_blanks':
      return { blanks: Object.fromEntries(Object.entries(p.blanks).map(([k, v]) => [k, v.split(',').map((s) => s.trim()).filter(Boolean)])) };
    default:
      return {};
  }
}

function Step({ n, title, hint, done, children, disabled }: { n: number; title: string; hint?: ReactNode; done: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <section className={cn('flex flex-col gap-3', disabled && 'pointer-events-none opacity-50')} aria-disabled={disabled || undefined}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold', done ? 'bg-success text-white' : 'bg-fill text-label-secondary')}>
          {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
        </span>
        <div className="min-w-0">
          <h3 className="text-headline text-label">{title}</h3>
          {hint && <p className="mt-0.5 text-subheadline text-label-secondary">{hint}</p>}
        </div>
      </div>
      <div className="sm:pl-9">{children}</div>
    </section>
  );
}

function PayloadEditor({ q, p, set, errors }: { q: RemedyQuestion; p: PayloadState; set: (fn: (p: PayloadState) => PayloadState) => void; errors: Record<string, string> }) {
  const error = errors['payload.optionIds'] ?? errors['payload.value'] ?? errors['payload.formula'] ?? errors['payload.tolerance'] ?? errors['payload.answers'] ?? errors['payload.blanks'] ?? errors.payload;
  const toggle = (id: string, on: boolean) => set((s) => ({ ...s, optionIds: on ? [...s.optionIds, id] : s.optionIds.filter((x) => x !== id) }));
  const key = (
    <p className="text-subheadline text-label-secondary">
      Current key:{' '}
      <span className="font-medium text-label">
        {q.key.formula ? `${q.key.formula}${q.key.tolerance ? `, within ${q.key.tolerance.value}${q.key.tolerance.type === 'relative' ? '%' : ''}` : ''}` : (q.key.text ?? '–')}
      </span>
    </p>
  );

  if (q.choices) {
    const multiple = q.type === 'multiple_choice';
    return (
      <div className="flex flex-col gap-3">
        {key}
        <ul className="flex flex-col gap-2">
          {q.choices.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 rounded-lg bg-fill-secondary px-3 py-2.5">
              <Checkbox
                checked={p.optionIds.includes(c.id)}
                disabled={!multiple && c.correct}
                onCheckedChange={(on) => toggle(c.id, !!on)}
                label={
                  <span className="flex items-center gap-2">
                    {c.text}
                    {c.correct && (
                      <Badge tone="success" size="sm">
                        Key
                      </Badge>
                    )}
                  </span>
                }
              />
              <span className="shrink-0 text-footnote tabular-nums text-label-secondary">{plural(c.count, 'candidate')} chose this</span>
            </li>
          ))}
        </ul>
        <p className="text-footnote text-label-secondary">
          {multiple ? 'Tick the complete set of options that should also count as a correct answer.' : 'Tick each option that should also count as correct. Everyone keeps the better of the two markings.'}
        </p>
        {error && <p className="text-footnote text-danger-text">{error}</p>}
      </div>
    );
  }

  if (q.type === 'numeric') {
    return (
      <div className="flex flex-col gap-3">
        {key}
        {q.variables.length > 0 ? (
          <Field
            label="Also accept answers computed as"
            hint={`Each candidate had their own numbers. Use the variables ${q.variables.map((v) => v.name).join(', ')}, for example sqrt(2 * 10 * h).`}
            error={errors['payload.formula']}
          >
            <Input value={p.formula} onChange={(e) => set((s) => ({ ...s, formula: e.target.value }))} placeholder={q.key.formula ?? 'formula'} className="font-mono" spellCheck={false} />
          </Field>
        ) : (
          <Field label="Also accept the value" error={errors['payload.value']}>
            <Input value={p.value} onChange={(e) => set((s) => ({ ...s, value: e.target.value }))} inputMode="decimal" className="max-w-40" trailing={q.unit ? <span className="text-footnote text-label-secondary">{q.unit}</span> : undefined} />
          </Field>
        )}
        <Field label="Tolerance (optional)" hint="Widen how far an answer may be from the key and still count." error={errors['payload.tolerance']}>
          <Input value={p.tolerance} onChange={(e) => set((s) => ({ ...s, tolerance: e.target.value }))} inputMode="decimal" className="max-w-32" placeholder={q.key.tolerance ? String(q.key.tolerance.value) : '0'} />
        </Field>
        {error && !errors['payload.formula'] && !errors['payload.value'] && !errors['payload.tolerance'] && <p className="text-footnote text-danger-text">{error}</p>}
      </div>
    );
  }

  if (q.type === 'short_text') {
    return (
      <div className="flex flex-col gap-3">
        {key}
        <Field label="Also accept" hint="One answer per line. Matching follows the question’s own rules for case and spacing." error={error}>
          <Textarea value={p.answers} onChange={(e) => set((s) => ({ ...s, answers: e.target.value }))} rows={3} />
        </Field>
      </div>
    );
  }

  if (q.type === 'fill_blanks') {
    return (
      <div className="flex flex-col gap-3">
        {key}
        {q.blanks.map((b, i) => (
          <Field key={b.id} label={`Blank ${i + 1}${b.label ? `: ${b.label}` : ''}`} hint="Separate answers with commas.">
            <Input value={p.blanks[b.id] ?? ''} onChange={(e) => set((s) => ({ ...s, blanks: { ...s.blanks, [b.id]: e.target.value } }))} />
          </Field>
        ))}
        {error && <p className="text-footnote text-danger-text">{error}</p>}
      </div>
    );
  }
  return <p className="text-subheadline text-label-secondary">This kind of question can’t take an alternative answer. Give full marks for everyone instead.</p>;
}

/** Score changes as a bar list: how many candidates gain how much. One hue for gains, grey for no change. */
function GainBars({ report }: { report: RemedyReport }) {
  const max = Math.max(1, ...report.distribution.map((d) => d.count));
  const rows = [...report.distribution].sort((a, b) => b.delta - a.delta);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-subheadline font-semibold text-label">Change per candidate</figcaption>
      <ul className="flex flex-col gap-1.5" aria-label="Candidates by change in score">
        {rows.map((d) => (
          <li key={d.delta} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-subheadline">
            <span className="text-right tabular-nums text-label-secondary">{d.delta === 0 ? 'No change' : `${fmtSigned(d.delta)} marks`}</span>
            <Tooltip content={`${plural(d.count, 'candidate')}: ${d.delta === 0 ? 'unchanged' : `${fmtSigned(d.delta)} marks`}`}>
              <span className="flex h-5 items-center" tabIndex={0}>
                <span
                  className={cn('h-3.5 rounded-r-[4px]', d.delta > 0 ? 'bg-accent' : d.delta < 0 ? 'bg-danger' : 'bg-fill-strong')}
                  style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }}
                />
              </span>
            </Tooltip>
            <span className="tabular-nums text-label">{d.count}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Preview({ report, onFullMarks, onApply, applying, canApply }: { report: RemedyReport; onFullMarks: () => void; onApply: () => void; applying: boolean; canApply: boolean }) {
  const [all, setAll] = useState(false);
  const losers = report.perCandidate.filter((c) => c.delta < 0);
  const moved = report.perCandidate.filter((c) => c.delta !== 0 || c.maxAfter !== c.maxBefore);
  const shown = all ? report.perCandidate : (moved.length ? moved : report.perCandidate).slice(0, 8);
  const lowering = report.blocked?.code === 'REMEDY_WOULD_LOWER';

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b px-5 py-4">
        <h3 className="text-headline text-label">
          Preview: {report.summary} on {report.question.label}
        </h3>
        <p className="text-subheadline text-label-secondary">Nothing has changed yet. This is exactly what applying it would do, candidate by candidate.</p>
      </div>
      <div className="flex flex-col gap-5 px-5 py-5">
        {report.blocked && (
          <Banner
            tone={lowering ? 'warning' : 'danger'}
            icon={<ShieldAlert />}
            title={lowering ? 'This would lower scores, so it can’t be applied' : 'This remedy can’t be applied now'}
            action={
              lowering ? (
                <Button variant="filled" size="sm" onClick={onFullMarks}>
                  Give full marks instead
                </Button>
              ) : undefined
            }
          >
            {report.blocked.message}
          </Banner>
        )}

        <dl className="flex flex-wrap gap-x-10 gap-y-3 border-y border-separator py-3">
          {[
            { label: 'Candidates re-marked', value: report.affectedAttempts },
            { label: lowering ? 'Would lose marks' : 'Gain marks', value: lowering ? report.rawLosses.count : report.gains.count, hint: lowering ? `up to ${fmtMarks(report.rawLosses.max)}` : report.gains.count ? `${fmtMarks(report.gains.avg)} on average` : undefined },
            { label: 'Unchanged', value: report.unchanged },
            { label: 'Paper maximum', value: fmtMarks(report.maxAfter), hint: report.maxBefore !== report.maxAfter ? `was ${fmtMarks(report.maxBefore)}` : undefined },
          ].map((t) => (
            <div key={t.label}>
              <dt className="text-footnote text-label-secondary">{t.label}</dt>
              <dd className="text-title-3 tabular-nums text-label">{t.value}</dd>
              {t.hint && <dd className="text-footnote text-label-secondary">{t.hint}</dd>}
            </div>
          ))}
        </dl>

        {report.percentChangeNote && <p className="text-callout text-label">{report.percentChangeNote}</p>}

        <GainBars report={report} />

        {lowering && losers.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-subheadline font-semibold text-label">Who would lose marks</p>
            <ul className="grid gap-x-6 gap-y-1 text-subheadline sm:grid-cols-2">
              {losers.map((c) => (
                <li key={c.attemptId} className="flex items-center justify-between gap-3">
                  <span className="text-label">{c.candidate}</span>
                  <ScoreChange before={c.scoreBefore} after={c.scoreAfter} max={c.maxAfter} size="sm" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!lowering && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-subheadline font-semibold text-label">{moved.length ? 'Candidates whose score changes' : 'Candidates'}</p>
              {report.perCandidate.length > shown.length || all ? (
                <Button variant="plain" size="sm" onClick={() => setAll((a) => !a)}>
                  {all ? 'Show fewer' : `Show all ${report.perCandidate.length}`}
                </Button>
              ) : null}
            </div>
            <Table containerClassName="bg-fill-secondary">
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead numeric>{report.question.label}</TableHead>
                  <TableHead numeric>Paper</TableHead>
                  <TableHead numeric>Percent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((c) => (
                  <TableRow key={c.attemptId}>
                    <TableCell className="py-2 text-subheadline">{c.candidate}</TableCell>
                    <TableCell numeric className="py-2 text-subheadline">
                      {c.itemAfter === null ? 'dropped' : <ScoreChange before={c.itemBefore} after={c.itemAfter} size="sm" />}
                    </TableCell>
                    <TableCell numeric className="py-2 text-subheadline">
                      <ScoreChange before={c.scoreBefore} after={c.scoreAfter} max={c.maxAfter} size="sm" />
                    </TableCell>
                    <TableCell numeric className="py-2 text-subheadline">
                      <ScoreChange before={c.percentBefore} after={c.percentAfter} format={fmtPercent} size="sm" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {report.resolvesDisputes > 0 && !report.blocked && (
          <p className="flex items-center gap-2 text-subheadline text-label">
            <Users aria-hidden className="size-4 shrink-0 text-label-secondary" />
            Also answers {plural(report.resolvesDisputes, 'open dispute')} about {report.question.label}, as upheld, with your reason.
          </p>
        )}
        {report.withheldDisputes > 0 && !report.blocked && (
          <p className="flex items-start gap-2 text-subheadline text-label">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-label-secondary" />
            {report.withheldDisputes === 1 ? 'One open dispute about' : `${report.withheldDisputes} open disputes about`} {report.question.label} will stay open for another
            reviewer, because you graded the answer or decided the original. The score change still reaches {report.withheldDisputes === 1 ? 'that candidate' : 'those candidates'}.
          </p>
        )}
      </div>
      {!report.blocked && (
        <div className="flex flex-col gap-3 border-t bg-fill-secondary px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-footnote text-label-secondary">Applying writes each change to the grade ledger and recomputes every paper. Published reports for changed scores are replaced.</p>
          <Button variant="filled" onClick={onApply} loading={applying} disabled={!canApply}>
            Apply to {plural(report.affectedAttempts, 'candidate')}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function RemedyHistory({ remedies }: { remedies: AppliedRemedy[] }) {
  if (!remedies.length) return <p className="text-subheadline text-label-secondary">No remedies yet. Each one you apply is listed here with its reason, for anyone who audits these results.</p>;
  return (
    <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
      {remedies.map((r) => (
        <li key={r.id} className="flex flex-col gap-1 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-callout font-semibold text-label">
              {r.question ? `${r.question.label}: ` : ''}
              {r.summary}
            </p>
            <span className="text-footnote tabular-nums text-label-secondary">
              {plural(r.changed, 'score')} changed of {r.affectedAttempts}
            </span>
          </div>
          <p className="text-subheadline text-label">{r.reason}</p>
          <p className="text-footnote text-label-secondary">
            {r.typeLabel}, applied by {r.createdBy} on {fmtDateTime(r.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Fix a question for every candidate at once: pick it, pick the remedy, preview the exact effect,
 * then apply. A remedy never lowers anyone's score, and every change goes through the ledger.
 */
export function RemedyWizard({ examId, data, initialQuestionId, disputeId }: { examId: string; data: RemediesOverview; initialQuestionId?: string | null; disputeId?: string | null }) {
  const run = useRunRemedy(examId);
  const confirm = useConfirm();
  const [questionId, setQuestionId] = useState<string | null>(data.questions.some((q) => q.questionId === initialQuestionId) ? initialQuestionId! : null);
  const [type, setType] = useState<RemedyType | null>(null);
  const [payload, setPayload] = useState<PayloadState>(EMPTY);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [report, setReport] = useState<RemedyReport | null>(null);
  const [applied, setApplied] = useState<RemedyReport | null>(null);
  const q = useMemo(() => data.questions.find((x) => x.questionId === questionId) ?? null, [data.questions, questionId]);

  const invalidate = () => setReport(null);
  const linkedDispute = disputeId && q && initialQuestionId === q.questionId ? disputeId : null;

  const preview = (override?: RemedyType) => {
    const t = override ?? type;
    if (!q || !t) return;
    const errs: Record<string, string> = {};
    if (reason.trim().length < 10) errs.reason = 'Explain the remedy in at least 10 characters. Every affected candidate sees it.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    run.mutate(
      { questionId: q.questionId, type: t, payload: buildPayload(q, t, payload), reason: reason.trim(), disputeId: linkedDispute, dryRun: true },
      {
        onSuccess: (r) => setReport(r),
        onError: (err) => {
          if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  const apply = async () => {
    if (!q || !type || !report) return;
    const ok = await confirm({
      title: `Re-mark ${q.label} for ${plural(report.affectedAttempts, 'candidate')}?`,
      description: `${report.summary}. ${report.gains.count ? `${plural(report.gains.count, 'candidate')} gain marks; nobody loses any. ` : ''}Each change is written to the grade ledger and can only be corrected by another remedy, never erased.`,
      confirmLabel: 'Apply remedy',
    });
    if (!ok) return;
    run.mutate(
      { questionId: q.questionId, type, payload: buildPayload(q, type, payload), reason: reason.trim(), disputeId: linkedDispute, dryRun: false },
      {
        onSuccess: (r) => {
          toast.success(`${r.summary}: ${plural(r.affectedAttempts, 'candidate')} re-marked`);
          setApplied(r);
          setReport(null);
          setType(null);
          setPayload(EMPTY);
          setReason('');
        },
        onError: (err) => {
          if (isApiError(err) && Object.keys(err.fields).length) setErrors(err.fields);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  if (!data.canApply) {
    return (
      <Banner tone="neutral" icon={<Users />} title="Only the exam’s examiners can apply remedies">
        A remedy changes marks for every candidate, so it is limited to the exam owner and co-examiners. You can still review and decide individual disputes.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {applied && (
        <Banner
          tone="success"
          icon={<Check />}
          title={`Applied: ${applied.summary} on ${applied.question.label}`}
          action={
            <Button variant="gray" size="sm" onClick={() => setApplied(null)}>
              Another remedy
            </Button>
          }
        >
          {plural(applied.affectedAttempts, 'candidate')} re-marked, {plural(applied.gains.count, 'score')} raised
          {applied.resolvesDisputes ? `, ${plural(applied.resolvesDisputes, 'dispute')} answered` : ''}
          {applied.supersededReports ? `, ${plural(applied.supersededReports, 'issued report')} replaced` : ''}. Everything is in the ledger below.
        </Banner>
      )}

      <Step n={1} title="Which question?" hint="Pick the question that was wrong or unclear. Disputes and the answer spread help you judge." done={!!q}>
        <ChoiceList
          value={questionId}
          onValueChange={(id) => {
            setQuestionId(id);
            setType(null);
            setPayload(EMPTY);
            invalidate();
          }}
          label="Question"
        >
          {data.questions.map((x) => (
            <ChoiceRow
              key={x.questionId}
              value={x.questionId}
              disabled={x.dropped}
              title={`${x.label}: ${x.title}`}
              description={
                x.dropped
                  ? 'Already dropped for everyone'
                  : `${x.typeLabel}, ${x.sat} sat, average ${fmtMarks(x.avgScore)} of ${fmtMarks(x.marks + x.workingMarks)}, ${x.fullMarks} with full marks`
              }
              aside={
                x.disputes.total > 0 ? (
                  <Badge tone={x.disputes.active ? 'warning' : 'neutral'} size="sm">
                    {plural(x.disputes.total, 'dispute')}
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </ChoiceList>
      </Step>

      <Step n={2} title="What should change?" done={!!type} disabled={!q}>
        <ChoiceList<RemedyType>
          value={type}
          onValueChange={(t) => {
            setType(t);
            invalidate();
          }}
          label="Remedy"
        >
          {TYPES.map((t) => (
            <ChoiceRow
              key={t}
              value={t}
              disabled={!q || (t === 'accept_alternatives' && !q.supportsAlternatives)}
              title={REMEDY_COPY[t].label}
              description={t === 'accept_alternatives' && q && !q.supportsAlternatives ? `Not available for ${q.typeLabel.toLowerCase()} questions, which are marked by hand.` : REMEDY_COPY[t].explain}
            />
          ))}
        </ChoiceList>
      </Step>

      {q && type === 'accept_alternatives' && (
        <Step n={3} title="Which answer should also count?" done={false}>
          <PayloadEditor
            q={q}
            p={payload}
            set={(fn) => {
              setPayload(fn);
              invalidate();
            }}
            errors={errors}
          />
        </Step>
      )}

      <Step n={type === 'accept_alternatives' ? 4 : 3} title="Why?" hint="Every candidate whose score changes sees this reason, and it stays in the ledger." done={reason.trim().length >= 10} disabled={!q || !type}>
        <Field label="Reason" error={errors.reason}>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              invalidate();
            }}
            rows={3}
            maxLength={1000}
            placeholder="The stem does not say the force is the only one acting, so 12 m/s² follows from a fair reading."
          />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant={report ? 'gray' : 'tinted'} onClick={() => preview()} loading={run.isPending && !report} disabled={!q || !type}>
            <Eye aria-hidden /> {report ? 'Preview again' : 'Preview the effect'}
          </Button>
          {linkedDispute && !report?.withheldDisputes && <span className="text-footnote text-label-secondary">The dispute that sent you here is answered too.</span>}
        </div>
      </Step>

      {report && (
        <div className="flex flex-col gap-2">
          <Preview
            report={report}
            canApply={data.canApply}
            applying={run.isPending}
            onApply={() => void apply()}
            onFullMarks={() => {
              setType('full_marks_all');
              preview('full_marks_all');
            }}
          />
        </div>
      )}
    </div>
  );
}


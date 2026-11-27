'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useResolve, type RegradeBody } from '../api';
import { fmtMarks, fmtSigned } from '../format';
import type { DisputeOutcome, Part, StaffDisputeView } from '../types';
import { ChoiceList, ChoiceRow } from './choice-list';
import { ScoreChange } from './primitives';

const OUTCOMES: { value: DisputeOutcome; title: string; description: string }[] = [
  { value: 'upheld', title: 'Upheld', description: 'The candidate is right. Re-mark below if the marks change.' },
  { value: 'partially_upheld', title: 'Partially upheld', description: 'Some of the case holds. Re-mark the part that does.' },
  { value: 'rejected', title: 'Not upheld', description: 'The original marking stands. Your reason must say why.' },
];

/** An example reason for each outcome: what was checked, against what, and what follows. */
const REASON_EXAMPLE: Record<DisputeOutcome, string> = {
  upheld: 'Your working shows the step the rubric rewards, so that mark is now given.',
  partially_upheld: 'The method mark is now given because the substitution is correct. The answer mark stands because the final value is wrong.',
  rejected: 'The rubric gives this mark for a step your working doesn’t show, so the original mark stands.',
};

const PART_LABEL: Record<Part, string> = { answer: 'Answer', working: 'Working' };
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const threeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

function parseMarks(text: string): number | null {
  const t = text.trim().replace('−', '-').replace(',', '.');
  if (!t) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

type Outcome = { score: number | null; clamped: boolean; error: { field: 'score' | 'adjustment'; message: string } | null };

/** Same arithmetic as the API: clamp(Σ ticked points + adjustment, 0, max), or an explicit score in [0, max]. */
function evaluate(mode: 'rubric' | 'score', ids: string[], adjustment: string, score: string, points: Map<string, number>, max: number): Outcome {
  if (mode === 'score') {
    const v = parseMarks(score);
    if (v === null) return { score: null, clamped: false, error: { field: 'score', message: 'Enter the new score' } };
    if (Number.isNaN(v)) return { score: null, clamped: false, error: { field: 'score', message: 'The score must be a number' } };
    if (v < 0 || v > max) return { score: null, clamped: false, error: { field: 'score', message: `Enter a score between 0 and ${fmtMarks(max)} (this part is worth ${fmtMarks(max)})` } };
    if (!threeDecimals(v)) return { score: null, clamped: false, error: { field: 'score', message: 'Use at most three decimals' } };
    return { score: round3(v), clamped: false, error: null };
  }
  const adj = parseMarks(adjustment);
  if (Number.isNaN(adj)) return { score: null, clamped: false, error: { field: 'adjustment', message: 'The adjustment must be a number, like 1.5 or −1' } };
  const a = adj ?? 0;
  if (Math.abs(a) > max) return { score: null, clamped: false, error: { field: 'adjustment', message: `An adjustment can move the score by at most ${fmtMarks(max)}` } };
  if (!threeDecimals(a)) return { score: null, clamped: false, error: { field: 'adjustment', message: 'Use at most three decimals' } };
  const raw = round3(ids.reduce((s, id) => s + (points.get(id) ?? 0), 0) + a);
  const clamped = round3(Math.min(max, Math.max(0, raw)));
  return { score: clamped, clamped: clamped !== raw, error: null };
}

export function ResolveDialog({ v, open, onOpenChange }: { v: StaffDisputeView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const resolve = useResolve(v.dispute.id);
  const item = v.live.item;
  const parts: Part[] = item && !item.voided ? item.humanParts : [];
  const [outcome, setOutcome] = useState<DisputeOutcome | null>(null);
  const [note, setNote] = useState('');
  const [remark, setRemark] = useState(parts.length > 0);
  const [part, setPart] = useState<Part>(parts.includes('working') && !parts.includes('answer') ? 'working' : (parts[0] ?? 'answer'));
  const live = item ? (part === 'answer' ? item.parts.answer : item.parts.working) : null;
  const rubric = useMemo(() => v.live.rubric.filter((r) => r.target === part), [v.live.rubric, part]);
  const points = useMemo(() => new Map(v.live.rubric.map((r) => [r.id, r.points])), [v.live.rubric]);
  const [modeByPart, setModeByPart] = useState<Record<Part, 'rubric' | 'score'>>({
    answer: v.live.rubric.some((r) => r.target === 'answer') ? 'rubric' : 'score',
    working: v.live.rubric.some((r) => r.target === 'working') ? 'rubric' : 'score',
  });
  const [ids, setIds] = useState<Record<Part, string[]>>({ answer: item?.parts.answer.rubricItemIds ?? [], working: item?.parts.working?.rubricItemIds ?? [] });
  const [adjustment, setAdjustment] = useState<Record<Part, string>>({
    answer: item?.parts.answer.adjustment ? String(item.parts.answer.adjustment) : '',
    working: item?.parts.working?.adjustment ? String(item.parts.working.adjustment) : '',
  });
  const [score, setScore] = useState<Record<Part, string>>({ answer: '', working: '' });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const mode = modeByPart[part];
  const regrading = remark && outcome !== 'rejected' && parts.length > 0 && !!live;
  const result = live ? evaluate(mode, ids[part], adjustment[part], score[part], points, live.max) : null;
  const currentPart = live?.score ?? 0;
  const delta = result?.score !== null && result?.score !== undefined ? round3(result.score - currentPart) : 0;
  const attemptScore = v.live.attempt.score ?? 0;

  const noteError = serverErrors.note;
  const outcomeError = serverErrors.outcome;
  const regradeError = serverErrors['regrade.score'] ?? serverErrors['regrade.adjustment'] ?? serverErrors['regrade.part'] ?? serverErrors.regrade ?? serverErrors['regrade.rubricItemIds'];

  const reset = () => {
    setOutcome(null);
    setNote('');
    setServerErrors({});
  };

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!outcome) errs.outcome = 'Choose an outcome';
    if (note.trim().length < 10) errs.note = 'Explain the decision in at least 10 characters. The candidate will read it.';
    if (regrading && result?.error) errs[`regrade.${result.error.field}`] = result.error.message;
    setServerErrors(errs);
    if (Object.keys(errs).length) return;
    let regrade: RegradeBody | null = null;
    if (regrading) {
      regrade = mode === 'score' ? { part, score: result!.score! } : { part, rubricItemIds: ids[part], adjustment: parseMarks(adjustment[part]) ?? 0 };
    }
    resolve.mutate(
      { outcome: outcome!, note: note.trim(), regrade },
      {
        onSuccess: (view) => {
          toast.success(view.supersededReports ? `Decision recorded. ${view.supersededReports} issued report replaced.` : 'Decision recorded and sent to the candidate');
          reset();
          onOpenChange(false);
        },
        onError: (err) => {
          if (isApiError(err) && Object.keys(err.fields).length) setServerErrors(err.fields);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setServerErrors({});
        onOpenChange(o);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader title="Decide this dispute" description="The candidate reads your reason. Any change to marks is written to the grade ledger and recomputes the paper." />
        <DialogBody className="flex flex-col gap-6">
          <section className="flex flex-col gap-2" aria-label="Outcome">
            <h3 className="text-subheadline font-semibold text-label">Outcome</h3>
            <ChoiceList<DisputeOutcome> value={outcome} onValueChange={setOutcome} label="Outcome" className="sm:grid sm:grid-cols-3">
              {OUTCOMES.map((o) => (
                <ChoiceRow key={o.value} value={o.value} title={o.title} description={o.description} />
              ))}
            </ChoiceList>
            {outcomeError && <p className="text-footnote text-danger-text">{outcomeError}</p>}
          </section>

          {outcome && outcome !== 'rejected' && (
            <section className="flex flex-col gap-3" aria-label="Re-mark">
              {parts.length === 0 || !live ? (
                <div className="flex items-start gap-3 rounded-lg bg-fill-secondary px-4 py-3 text-subheadline text-label">
                  <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-label-secondary" />
                  <p>
                    {item?.autoGraded
                      ? 'This answer is marked automatically, so it can’t be re-marked for one person. If the key is wrong, fix it for every candidate.'
                      : 'There is nothing to re-mark on this dispute.'}{' '}
                    {v.question && v.can.applyRemedy && (
                      <Link className="font-medium text-accent-text hover:underline" href={`/exams/${v.exam.id}/disputes?remedy=${v.question.questionId}&dispute=${v.dispute.id}`}>
                        Apply a remedy for everyone
                      </Link>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Switch checked={remark} onCheckedChange={setRemark} label="Change the marks" />
                    {remark && parts.length > 1 && (
                      <SegmentedControl<Part> aria-label="Part to re-mark" size="sm" value={part} onValueChange={setPart} options={parts.map((p) => ({ value: p, label: PART_LABEL[p] }))} />
                    )}
                  </div>
                  {remark && (
                    <div className="flex flex-col gap-4 rounded-xl bg-fill-secondary p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-subheadline font-semibold text-label">
                          {PART_LABEL[part]}, worth {fmtMarks(live.max)}
                          {item!.parts.answer.auto && part === 'working' && <span className="font-normal text-label-secondary"> (the answer itself is marked automatically)</span>}
                        </p>
                        {rubric.length > 0 && (
                          <SegmentedControl<'rubric' | 'score'>
                            aria-label="How to set the score"
                            size="sm"
                            value={mode}
                            onValueChange={(m) => setModeByPart((s) => ({ ...s, [part]: m }))}
                            options={[
                              { value: 'rubric', label: 'Rubric' },
                              { value: 'score', label: 'Score' },
                            ]}
                          />
                        )}
                      </div>

                      {mode === 'rubric' && rubric.length > 0 ? (
                        <>
                          <ul className="flex flex-col gap-2">
                            {rubric.map((r) => (
                              <li key={r.id}>
                                <Checkbox
                                  checked={ids[part].includes(r.id)}
                                  onCheckedChange={(c) => setIds((s) => ({ ...s, [part]: c ? [...s[part], r.id] : s[part].filter((x) => x !== r.id) }))}
                                  label={
                                    <span className="flex items-baseline gap-2">
                                      <span className={cn('w-9 shrink-0 font-semibold tabular-nums', r.points < 0 ? 'text-danger-text' : 'text-label')}>{fmtSigned(r.points)}</span>
                                      <span>{r.label}</span>
                                    </span>
                                  }
                                  description={r.description ?? undefined}
                                />
                              </li>
                            ))}
                          </ul>
                          <Field label="Adjustment" hint="Added to the rubric total, then kept between 0 and the part’s marks." error={serverErrors['regrade.adjustment'] ?? (result?.error?.field === 'adjustment' ? result.error.message : undefined)}>
                            <Input value={adjustment[part]} onChange={(e) => setAdjustment((s) => ({ ...s, [part]: e.target.value }))} inputMode="decimal" placeholder="0" className="max-w-32" />
                          </Field>
                        </>
                      ) : (
                        <Field label={`New ${PART_LABEL[part].toLowerCase()} score`} hint={`Between 0 and ${fmtMarks(live.max)}.`} error={serverErrors['regrade.score'] ?? (score[part] && result?.error?.field === 'score' ? result.error.message : undefined)}>
                          <Input
                            value={score[part]}
                            onChange={(e) => setScore((s) => ({ ...s, [part]: e.target.value }))}
                            inputMode="decimal"
                            placeholder={fmtMarks(live.score)}
                            trailing={<span className="text-footnote text-label-secondary">/ {fmtMarks(live.max)}</span>}
                            className="max-w-32"
                            autoFocus
                          />
                        </Field>
                      )}

                      <div className="grid gap-2 border-t border-separator pt-3 text-subheadline sm:grid-cols-3" aria-live="polite">
                        <div>
                          <p className="text-footnote text-label-secondary">{PART_LABEL[part]}</p>
                          <ScoreChange before={live.score} after={result?.score ?? null} max={live.max} size="sm" />
                        </div>
                        <div>
                          <p className="text-footnote text-label-secondary">This question</p>
                          <ScoreChange before={item!.score} after={result?.score !== null && result?.score !== undefined && item!.score !== null ? round3(item!.score + delta) : null} max={item!.max} size="sm" />
                        </div>
                        <div>
                          <p className="text-footnote text-label-secondary">Paper total</p>
                          <ScoreChange before={attemptScore} after={result?.score !== null && result?.score !== undefined ? round3(attemptScore + delta) : null} max={v.live.attempt.maxScore} size="sm" />
                        </div>
                      </div>
                      {result?.clamped && <p className="text-footnote text-warning-text">The rubric total falls outside 0 to {fmtMarks(live.max)}, so it is capped.</p>}
                      {result && !result.error && delta === 0 && <p className="text-footnote text-label-secondary">No change to the marks. The decision is still recorded in the ledger.</p>}
                    </div>
                  )}
                  {regradeError && <p className="text-footnote text-danger-text">{regradeError}</p>}
                </>
              )}
            </section>
          )}

          <Field
            label="Reason for the candidate"
            required
            error={noteError}
            hint="Say what you checked and why you decided this way. It is shown to the candidate word for word and kept with the record."
          >
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={2000} placeholder={REASON_EXAMPLE[outcome ?? 'upheld']} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="filled" onClick={submit} loading={resolve.isPending}>
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

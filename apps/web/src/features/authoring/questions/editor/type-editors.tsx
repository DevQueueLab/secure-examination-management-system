'use client';

import { ChevronDown, ChevronUp, CircleAlert, Dices, Plus, SquareDashed, X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePreviewQuestion } from '../../api';
import { NumberStepper } from '../../components/number-stepper';
import { RichText } from '../../components/rich-text';
import { errorAt } from '../../lib/field-errors';
import { ChipsInput } from './chips-input';
import { blankIds, nextId, syncBlanks, toInput, type Draft, type Json, type Option } from './draft';

export interface TypeEditorProps {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}

const setContent = (update: TypeEditorProps['update'], patch: Json) => update((d) => ({ ...d, content: { ...d.content, ...patch } }));
const setKey = (update: TypeEditorProps['update'], patch: Json) => update((d) => ({ ...d, key: { ...d.key, ...patch } }));

function InlineError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-footnote font-medium text-danger-text">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function RowButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function num(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---------- single / multiple choice ----------

export function ChoiceEditor({ draft, update, errors, disabled, multi }: TypeEditorProps & { multi: boolean }) {
  const options = draft.content.options as Option[];
  const correct = draft.key.correct as string | string[];
  const isCorrect = (id: string) => (multi ? (correct as string[]).includes(id) : correct === id);

  const setText = (id: string, text: string) => setContent(update, { options: options.map((o) => (o.id === id ? { ...o, text } : o)) });
  const add = () => setContent(update, { options: [...options, { id: nextId('o', options), text: '' }] });
  const remove = (id: string) =>
    update((d) => ({
      ...d,
      content: { ...d.content, options: (d.content.options as Option[]).filter((o) => o.id !== id) },
      key: { ...d.key, correct: multi ? (d.key.correct as string[]).filter((c) => c !== id) : d.key.correct === id ? '' : d.key.correct },
    }));
  const toggle = (id: string, on: boolean) =>
    setKey(update, { correct: multi ? (on ? [...(correct as string[]), id] : (correct as string[]).filter((c) => c !== id)) : id });

  const rows = options.map((o, i) => {
    const err = errors[`content.options.${i}.text`];
    return (
      <li key={o.id} className="flex flex-col gap-1">
        <div className={cn('flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors', isCorrect(o.id) && 'bg-success-tint')}>
          {multi ? (
            <Checkbox checked={isCorrect(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} aria-label={`Option ${i + 1} is correct`} disabled={disabled} />
          ) : (
            <Radio value={o.id} aria-label={`Option ${i + 1} is correct`} disabled={disabled} />
          )}
          <Input
            value={o.text}
            onChange={(e) => setText(o.id, e.target.value)}
            placeholder={`Option ${String.fromCharCode(65 + i)}`}
            aria-label={`Option ${String.fromCharCode(65 + i)} text`}
            aria-invalid={!!err || undefined}
            disabled={disabled}
            containerClassName="flex-1"
          />
          {isCorrect(o.id) && <span className="hidden text-footnote font-medium text-success-text sm:inline">Correct</span>}
          <RowButton label={`Remove option ${String.fromCharCode(65 + i)}`} onClick={() => remove(o.id)} disabled={disabled || options.length <= 2}>
            <X aria-hidden />
          </RowButton>
        </div>
      </li>
    );
  });
  const optionErrors = options.map((_, i) => errors[`content.options.${i}.text`]).filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-footnote text-label-secondary">
        {multi ? 'Tick every correct option. The exam’s multiple-select rule decides partial credit.' : 'Select the correct option. Options are shuffled per candidate when the exam allows it.'}
      </p>
      {multi ? (
        <ul className="flex flex-col gap-1">{rows}</ul>
      ) : (
        <RadioGroup value={typeof correct === 'string' ? correct : ''} onValueChange={(v) => toggle(v, true)} className="gap-1" disabled={disabled}>
          <ul className="flex flex-col gap-1">{rows}</ul>
        </RadioGroup>
      )}
      <InlineError message={optionErrors.length > 1 ? 'Write every option, or remove the ones you don’t need' : (optionErrors[0] ?? errors['content.options'])} />
      <InlineError message={errorAt(errors, 'key.correct')} />
      <div>
        <Button type="button" variant="tinted" size="sm" onClick={add} disabled={disabled || options.length >= 12}>
          <Plus aria-hidden /> Add option
        </Button>
      </div>
    </div>
  );
}

// ---------- true / false ----------

export function TrueFalseEditor({ draft, update, disabled }: TypeEditorProps) {
  return (
    <Field label="The statement is" hint="Write the statement as the question text above.">
      <div>
        <SegmentedControl
          aria-label="Correct answer"
          value={draft.key.correct ? 'true' : 'false'}
          onValueChange={(v) => !disabled && setKey(update, { correct: v === 'true' })}
          options={[
            { value: 'true', label: 'True', disabled },
            { value: 'false', label: 'False', disabled },
          ]}
        />
      </div>
    </Field>
  );
}

// ---------- numeric ----------

interface Variable {
  name: string;
  min: number;
  max: number;
  step: number;
}

export function NumericEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  const preview = usePreviewQuestion();
  const variables = (draft.content.variables ?? []) as Variable[];
  const formulaMode = typeof draft.key.formula === 'string';
  const tol = (draft.key.tolerance ?? { type: 'absolute', value: 0 }) as { type: 'absolute' | 'relative'; value: number };

  const setVars = (next: Variable[]) => setContent(update, { variables: next });
  const setMode = (mode: 'fixed' | 'formula') =>
    update((d) => {
      const key = { ...d.key };
      if (mode === 'formula') {
        key.formula = typeof key.formula === 'string' ? key.formula : '';
        key.answer = null;
        return { ...d, key };
      }
      delete key.formula;
      return { ...d, key, content: { ...d.content, variables: [] } };
    });

  const sample = () => {
    const input = toInput(draft);
    preview.mutate({ type: 'numeric', content: input.content, key: input.key });
  };

  return (
    <div className="flex flex-col gap-5">
      <Field label="Answer">
        <div>
          <SegmentedControl
            aria-label="Answer type"
            value={formulaMode ? 'formula' : 'fixed'}
            onValueChange={(v) => !disabled && setMode(v)}
            options={[
              { value: 'fixed', label: 'Fixed number', disabled },
              { value: 'formula', label: 'Formula with variables', disabled },
            ]}
          />
        </div>
      </Field>

      {!formulaMode ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Correct answer" error={errors['key.answer']} required>
            <Input type="number" step="any" inputMode="decimal" value={draft.key.answer ?? ''} onChange={(e) => setKey(update, { answer: num(e.target.value) })} placeholder="9.81" disabled={disabled} />
          </Field>
          <Field label="Unit" hint="Shown after the answer box">
            <Input value={draft.content.unit ?? ''} onChange={(e) => setContent(update, { unit: e.target.value })} placeholder="m/s²" maxLength={40} disabled={disabled} />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-footnote text-label-secondary">
            Each candidate gets their own values. Write <code className="rounded bg-fill px-1">{'{{name}}'}</code> in the question text where a value should appear, and give the answer as a formula of the variables.
          </p>
          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_2rem] gap-2 px-1 text-caption text-label-secondary sm:grid">
              <span>Variable</span>
              <span>Min</span>
              <span>Max</span>
              <span>Step</span>
              <span />
            </div>
            {variables.map((v, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_2rem]">
                  <Input
                    value={v.name}
                    onChange={(e) => setVars(variables.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)))}
                    placeholder="h"
                    aria-label={`Variable ${i + 1} name`}
                    className="font-mono"
                    aria-invalid={!!errors[`content.variables.${i}.name`] || undefined}
                    disabled={disabled}
                  />
                  <div className="row-start-2 grid grid-cols-3 gap-2 sm:contents">
                    {(['min', 'max', 'step'] as const).map((f) => (
                      <Input
                        key={f}
                        type="number"
                        step="any"
                        value={Number.isFinite(v[f]) ? v[f] : ''}
                        onChange={(e) => setVars(variables.map((x, j) => (j === i ? { ...x, [f]: num(e.target.value) ?? (f === 'step' ? 1 : 0) } : x)))}
                        aria-label={`Variable ${i + 1} ${f}`}
                        aria-invalid={!!errors[`content.variables.${i}.${f}`] || undefined}
                        disabled={disabled}
                      />
                    ))}
                  </div>
                  <RowButton label={`Remove variable ${v.name || i + 1}`} onClick={() => setVars(variables.filter((_, j) => j !== i))} disabled={disabled}>
                    <X aria-hidden />
                  </RowButton>
                </div>
                <InlineError message={errorAt(errors, `content.variables.${i}`)} />
              </div>
            ))}
            <InlineError message={errors['content.variables']} />
            <div>
              <Button
                type="button"
                variant="tinted"
                size="sm"
                disabled={disabled || variables.length >= 8}
                onClick={() => {
                  const used = new Set(variables.map((v) => v.name));
                  const name = ['x', 'y', 'z', 'a', 'b', 'c', 'n', 'm'].find((n) => !used.has(n)) ?? `v${variables.length + 1}`;
                  setVars([...variables, { name, min: 1, max: 10, step: 1 }]);
                }}
              >
                <Plus aria-hidden /> Add variable
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Answer formula" required error={errors['key.formula']} hint="Arithmetic, ^, sqrt, abs, log, ln, sin, cos, tan, pi and e. Example: 2^(h+1) - 1">
              <Input value={draft.key.formula ?? ''} onChange={(e) => setKey(update, { formula: e.target.value })} placeholder="d / t" className="font-mono" disabled={disabled} />
            </Field>
            <Field label="Unit" hint="Shown after the answer box">
              <Input value={draft.content.unit ?? ''} onChange={(e) => setContent(update, { unit: e.target.value })} placeholder="m/s" maxLength={40} disabled={disabled} />
            </Field>
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="gray" size="sm" onClick={sample} loading={preview.isPending} disabled={!variables.length || !draft.key.formula}>
                <Dices aria-hidden /> Generate sample variant
              </Button>
              {preview.data && !preview.isError && (
                <p className="text-callout text-label">
                  {Object.entries((preview.data.variant.values ?? {}) as Record<string, number>)
                    .map(([k, v]) => `${k} = ${v}`)
                    .join(', ')}
                  {preview.data.expectedAnswer !== undefined && (
                    <>
                      {' '}
                      gives the answer <span className="font-semibold tabular-nums">{Number(preview.data.expectedAnswer.toPrecision(10))}</span>
                      {draft.content.unit ? ` ${draft.content.unit}` : ''}
                    </>
                  )}
                </p>
              )}
            </div>
            {preview.isError && <InlineError message={errorAt((preview.error as { fields?: Record<string, string> }).fields ?? {}, 'key.formula', 'content.variables') ?? errorMessage(preview.error)} />}
            {preview.data && !preview.isError && typeof preview.data.candidateView.stem === 'string' && (
              <RichText className="text-callout text-label-secondary">{preview.data.candidateView.stem}</RichText>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tolerance" hint={tol.type === 'absolute' ? 'Answers within ± this amount are correct.' : 'Answers within this percentage of the correct value are correct.'}>
          <div>
            <SegmentedControl
              aria-label="Tolerance type"
              size="sm"
              value={tol.type}
              onValueChange={(type) => !disabled && setKey(update, { tolerance: { type, value: type === 'relative' ? Math.min(tol.value, 1) : tol.value } })}
              options={[
                { value: 'absolute', label: '± amount', disabled },
                { value: 'relative', label: '± percent', disabled },
              ]}
            />
          </div>
        </Field>
        <Field label={tol.type === 'absolute' ? 'Allowed difference' : 'Allowed difference (%)'} error={errorAt(errors, 'key.tolerance')}>
          <Input
            type="number"
            step="any"
            min={0}
            value={tol.type === 'relative' ? Number((tol.value * 100).toPrecision(6)) : tol.value}
            onChange={(e) => {
              const v = Math.max(0, num(e.target.value) ?? 0);
              setKey(update, { tolerance: { ...tol, value: tol.type === 'relative' ? v / 100 : v } });
            }}
            disabled={disabled}
          />
        </Field>
      </div>
    </div>
  );
}

// ---------- short answer ----------

export function ShortTextEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Accepted answers" required error={errorAt(errors, 'key.accepted')} hint="Press Enter after each. Spacing is ignored when matching; add each spelling you will accept.">
        <ChipsInput value={draft.key.accepted ?? []} onChange={(accepted) => setKey(update, { accepted })} placeholder="stack" separators={['Enter', 'Tab']} disabled={disabled} />
      </Field>
      <div className="flex flex-wrap items-end gap-6">
        <Checkbox
          label="Case sensitive"
          description="“Stack” and “stack” count as different answers."
          checked={!!draft.key.caseSensitive}
          onCheckedChange={(v) => setKey(update, { caseSensitive: v === true })}
          disabled={disabled}
        />
        <Field label="Longest answer" error={errors['content.maxLength']}>
          <NumberStepper value={draft.content.maxLength ?? 200} onCommit={(maxLength) => setContent(update, { maxLength })} min={1} max={500} step={10} suffix="chars" disabled={disabled} aria-label="Longest answer in characters" />
        </Field>
      </div>
    </div>
  );
}

// ---------- fill in the blanks ----------

export function FillBlanksEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const template = String(draft.content.template ?? '');
  const ids = blankIds(template);

  const setTemplate = (value: string) => update((d) => ({ ...d, ...syncBlanks({ ...d.content, template: value }, d.key) }));
  const insertBlank = () => {
    const id = nextId('b', ids);
    const el = area.current;
    const at = el ? el.selectionStart : template.length;
    const end = el ? el.selectionEnd : template.length;
    const token = `[[${id}]]`;
    setTemplate(template.slice(0, at) + token + template.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Text with blanks"
        required
        error={errors['content.template'] ?? errors['content.blanks']}
        labelAccessory={
          <Button type="button" variant="tinted" size="sm" onClick={insertBlank} disabled={disabled || ids.length >= 20}>
            <SquareDashed aria-hidden /> Insert blank
          </Button>
        }
        hint="Each [[b1]] becomes an answer box. Put the cursor where a blank goes and press Insert blank."
      >
        <Textarea ref={area} value={template} onChange={(e) => setTemplate(e.target.value)} rows={3} placeholder="Water boils at [[b1]] °C at sea level." disabled={disabled} />
      </Field>
      {template && (
        <div className="rounded-xl bg-surface-sunken px-4 py-3 text-body leading-8 text-label">
          {template.split(/(\[\[[A-Za-z0-9_-]{1,64}\]\])/g).map((part, i) => {
            const m = part.match(/^\[\[(.+)\]\]$/);
            return m ? (
              <span key={i} className="mx-0.5 inline-flex h-7 min-w-16 items-center justify-center rounded-md border border-dashed border-separator-strong bg-surface px-2 align-middle text-footnote text-label-tertiary">
                {m[1]}
              </span>
            ) : (
              <span key={i}>{part}</span>
            );
          })}
        </div>
      )}
      {ids.length > 0 && (
        <div className="flex flex-col gap-3">
          {ids.map((id) => (
            <Field key={id} label={`Accepted answers for ${id}`} error={errors[`key.blanks.${id}`]}>
              <ChipsInput
                value={draft.key.blanks?.[id] ?? []}
                onChange={(answers) => setKey(update, { blanks: { ...draft.key.blanks, [id]: answers } })}
                placeholder="Type an answer and press Enter"
                separators={['Enter', 'Tab']}
                disabled={disabled}
              />
            </Field>
          ))}
          <InlineError message={errors['key.blanks']} />
        </div>
      )}
      <Checkbox label="Case sensitive" checked={!!draft.key.caseSensitive} onCheckedChange={(v) => setKey(update, { caseSensitive: v === true })} disabled={disabled} />
    </div>
  );
}

// ---------- matching ----------

export function MatchingEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  const prompts = draft.content.prompts as Option[];
  const answers = draft.content.answers as Option[];
  const pairs = (draft.key.pairs ?? {}) as Record<string, string>;
  const used = new Set(Object.values(pairs));
  const label = (a: Option, i: number) => a.text.trim() || `Answer ${i + 1}`;

  const addPair = () =>
    update((d) => {
      const p = nextId('p', d.content.prompts as Option[]);
      const a = nextId('a', d.content.answers as Option[]);
      return {
        ...d,
        content: { ...d.content, prompts: [...(d.content.prompts as Option[]), { id: p, text: '' }], answers: [...(d.content.answers as Option[]), { id: a, text: '' }] },
        key: { ...d.key, pairs: { ...d.key.pairs, [p]: a } },
      };
    });
  const addDistractor = () => setContent(update, { answers: [...answers, { id: nextId('a', answers), text: '' }] });
  const removePrompt = (id: string) =>
    update((d) => {
      const nextPairs = { ...d.key.pairs };
      delete nextPairs[id];
      return { ...d, content: { ...d.content, prompts: (d.content.prompts as Option[]).filter((p) => p.id !== id) }, key: { ...d.key, pairs: nextPairs } };
    });
  const removeAnswer = (id: string) =>
    update((d) => ({
      ...d,
      content: { ...d.content, answers: (d.content.answers as Option[]).filter((a) => a.id !== id) },
      key: { ...d.key, pairs: Object.fromEntries(Object.entries(d.key.pairs as Record<string, string>).filter(([, a]) => a !== id)) },
    }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-footnote text-label-secondary">Each prompt is paired with one answer and earns its share of the marks. Extra answers act as distractors. Candidates see the answers shuffled.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-footnote font-medium text-label-secondary">Prompts and their match</h4>
          {prompts.map((p, i) => (
            <div key={p.id} className="flex flex-col gap-1 rounded-lg bg-surface-sunken p-2">
              <div className="flex items-center gap-2">
                <Input
                  value={p.text}
                  onChange={(e) => setContent(update, { prompts: prompts.map((x) => (x.id === p.id ? { ...x, text: e.target.value } : x)) })}
                  placeholder={`Prompt ${i + 1}`}
                  aria-label={`Prompt ${i + 1}`}
                  aria-invalid={!!errors[`content.prompts.${i}.text`] || undefined}
                  disabled={disabled}
                  containerClassName="flex-1"
                />
                <RowButton label={`Remove prompt ${i + 1}`} onClick={() => removePrompt(p.id)} disabled={disabled || prompts.length <= 2}>
                  <X aria-hidden />
                </RowButton>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <span className="shrink-0 text-footnote text-label-secondary">Matches</span>
                <Select
                  size="sm"
                  className="min-w-0 flex-1"
                  aria-label={`Match for prompt ${i + 1}`}
                  value={pairs[p.id] ?? ''}
                  placeholder="Choose its match"
                  onValueChange={(a) => setKey(update, { pairs: { ...pairs, [p.id]: a } })}
                  options={answers.map((a, j) => ({ value: a.id, label: <RichText inline>{label(a, j)}</RichText> }))}
                  disabled={disabled}
                />
              </div>
              <InlineError message={errors[`content.prompts.${i}.text`] ?? errors[`key.pairs.${p.id}`]} />
            </div>
          ))}
          <InlineError message={errors['content.prompts'] ?? errors['key.pairs']} />
          <div>
            <Button type="button" variant="tinted" size="sm" onClick={addPair} disabled={disabled || prompts.length >= 12 || answers.length >= 16}>
              <Plus aria-hidden /> Add pair
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-footnote font-medium text-label-secondary">Answers</h4>
          {answers.map((a, i) => (
            <div key={a.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  value={a.text}
                  onChange={(e) => setContent(update, { answers: answers.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x)) })}
                  placeholder={`Answer ${i + 1}`}
                  aria-label={`Answer ${i + 1}`}
                  aria-invalid={!!errors[`content.answers.${i}.text`] || undefined}
                  disabled={disabled}
                  containerClassName="flex-1"
                />
                {!used.has(a.id) && (
                  <Badge size="sm" tone="neutral">
                    Distractor
                  </Badge>
                )}
                <RowButton label={`Remove answer ${i + 1}`} onClick={() => removeAnswer(a.id)} disabled={disabled || answers.length <= 2}>
                  <X aria-hidden />
                </RowButton>
              </div>
              <InlineError message={errors[`content.answers.${i}.text`]} />
            </div>
          ))}
          <InlineError message={errors['content.answers']} />
          <div>
            <Button type="button" variant="gray" size="sm" onClick={addDistractor} disabled={disabled || answers.length >= 16}>
              <Plus aria-hidden /> Add distractor
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- ordering ----------

export function OrderingEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  const items = draft.content.items as Option[];
  const setItems = (next: Option[]) => update((d) => ({ ...d, content: { ...d.content, items: next }, key: { ...d.key, order: next.map((i) => i.id) } }));
  const move = (from: number, to: number) => {
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    setItems(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-footnote text-label-secondary">List the items in the correct order. Candidates see them shuffled and earn credit for each item in the right position.</p>
      <ol className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={it.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-footnote tabular-nums text-label-tertiary">{i + 1}</span>
              <Input
                value={it.text}
                onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
                placeholder={`Item ${i + 1}`}
                aria-label={`Item ${i + 1}`}
                aria-invalid={!!errors[`content.items.${i}.text`] || undefined}
                disabled={disabled}
                containerClassName="flex-1"
              />
              <RowButton label={`Move item ${i + 1} up`} onClick={() => move(i, i - 1)} disabled={disabled || i === 0}>
                <ChevronUp aria-hidden />
              </RowButton>
              <RowButton label={`Move item ${i + 1} down`} onClick={() => move(i, i + 1)} disabled={disabled || i === items.length - 1}>
                <ChevronDown aria-hidden />
              </RowButton>
              <RowButton label={`Remove item ${i + 1}`} onClick={() => setItems(items.filter((x) => x.id !== it.id))} disabled={disabled || items.length <= 2}>
                <X aria-hidden />
              </RowButton>
            </div>
          </li>
        ))}
      </ol>
      <InlineError
        message={
          items.filter((_, i) => errors[`content.items.${i}.text`]).length > 1
            ? 'Write every item, or remove the ones you don’t need'
            : (items.map((_, i) => errors[`content.items.${i}.text`]).find(Boolean) ?? errors['content.items'] ?? errorAt(errors, 'key.order'))
        }
      />
      <div>
        <Button type="button" variant="tinted" size="sm" onClick={() => setItems([...items, { id: nextId('i', items), text: '' }])} disabled={disabled || items.length >= 12}>
          <Plus aria-hidden /> Add item
        </Button>
      </div>
    </div>
  );
}

// ---------- written response ----------

export function LongTextEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  const words = (field: 'minWords' | 'maxWords') => (
    <Field label={field === 'minWords' ? 'Minimum words' : 'Maximum words'} error={errors[`content.${field}`]} hint="Optional">
      <Input
        type="number"
        min={field === 'minWords' ? 0 : 1}
        value={draft.content[field] ?? ''}
        onChange={(e) => {
          const v = num(e.target.value);
          setContent(update, { [field]: v === null ? undefined : Math.round(v) });
        }}
        disabled={disabled}
      />
    </Field>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-footnote text-label-secondary">Written answers are graded by people with a rubric. Add the rubric from the exam’s Grading tab once the question is in an exam.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {words('minWords')}
        {words('maxWords')}
      </div>
      <Field label="Model answer" hint="Only graders see this." error={errors['key.sampleAnswer']}>
        <Textarea value={draft.key.sampleAnswer ?? ''} onChange={(e) => setKey(update, { sampleAnswer: e.target.value })} rows={4} disabled={disabled} />
      </Field>
    </div>
  );
}

// ---------- code ----------

const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'sql', 'other'] as const;
const LANGUAGE_LABEL: Record<(typeof LANGUAGES)[number], string> = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java', cpp: 'C++', c: 'C', sql: 'SQL', other: 'Other' };

export function CodeEditor({ draft, update, errors, disabled }: TypeEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-footnote text-label-secondary">Code answers are graded by people with a rubric. Candidates write in an editor that starts with your starter code.</p>
      <Field label="Language" error={errors['content.language']} className="sm:max-w-xs">
        <Select value={draft.content.language ?? 'python'} onValueChange={(language) => setContent(update, { language })} options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))} disabled={disabled} />
      </Field>
      <Field label="Starter code" hint="Optional. Pre-filled in the candidate’s editor." error={errors['content.starterCode']}>
        <Textarea
          value={draft.content.starterCode ?? ''}
          onChange={(e) => setContent(update, { starterCode: e.target.value })}
          rows={6}
          spellCheck={false}
          className="font-mono text-callout"
          placeholder={'def solve(values):\n    ...'}
          disabled={disabled}
        />
      </Field>
      <Field label="Model solution" hint="Only graders see this." error={errors['key.sampleAnswer']}>
        <Textarea value={draft.key.sampleAnswer ?? ''} onChange={(e) => setKey(update, { sampleAnswer: e.target.value })} rows={6} spellCheck={false} className="font-mono text-callout" disabled={disabled} />
      </Field>
    </div>
  );
}

/** The answer-key editor for a draft's type. */
export function TypeEditor(props: TypeEditorProps) {
  switch (props.draft.type) {
    case 'single_choice':
      return <ChoiceEditor {...props} multi={false} />;
    case 'multiple_choice':
      return <ChoiceEditor {...props} multi />;
    case 'true_false':
      return <TrueFalseEditor {...props} />;
    case 'numeric':
      return <NumericEditor {...props} />;
    case 'short_text':
      return <ShortTextEditor {...props} />;
    case 'fill_blanks':
      return <FillBlanksEditor {...props} />;
    case 'matching':
      return <MatchingEditor {...props} />;
    case 'ordering':
      return <OrderingEditor {...props} />;
    case 'long_text':
      return <LongTextEditor {...props} />;
    case 'code':
      return <CodeEditor {...props} />;
  }
}

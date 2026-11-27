'use client';

import type { ExamSettings, MarkingScheme } from '@athena/shared';
import { Globe2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { NumberStepper } from '../components/number-stepper';
import { fromLocalInput, formatMinutes, minutesBetween } from '../lib/datetime';
import { errorAt } from '../lib/field-errors';
import { useTimeZoneLabel, type ExamFormState, type FormErrors } from './exam-form';

export interface GroupProps {
  form: ExamFormState;
  set: (patch: Partial<ExamFormState>) => void;
  setSettings: <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => void;
  errors: FormErrors;
  /** Why a field can't change right now (locked by a started attempt, archived, no permission). */
  lock: (path: string) => string | undefined;
}

/** Focusable lock badge: disabled controls can't show a tooltip themselves, so the reason lives here. */
export function LockHint({ reason }: { reason: string }) {
  return (
    <Tooltip content={reason} side="top">
      <button
        type="button"
        aria-label={reason}
        className="inline-flex size-5 items-center justify-center rounded-full text-label-tertiary transition-colors hover:bg-fill hover:text-label-secondary"
      >
        <Lock aria-hidden className="size-3" />
      </button>
    </Tooltip>
  );
}

function CheckRow({
  label,
  description,
  checked,
  onChange,
  lock,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  lock?: string;
}) {
  return (
    <div className="flex items-start gap-1">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={!!lock} label={label} description={description} />
      {lock && <LockHint reason={lock} />}
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Section title={title} description={description} as="h3">
      <Card className="flex flex-col gap-5">{children}</Card>
    </Section>
  );
}

// ---------- basics ----------

export function BasicsGroup({ form, set, errors, lock, bare = false }: Omit<GroupProps, 'setSettings'> & { bare?: boolean }) {
  const body = (
    <>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="Title" required error={errors.title} labelAccessory={lock('title') && <LockHint reason={lock('title')!} />}>
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Data Structures Final" maxLength={200} disabled={!!lock('title')} />
        </Field>
        <Field label="Course code" hint="Optional, shown to candidates" error={errors.code}>
          <Input value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="CS-201" maxLength={40} disabled={!!lock('code')} />
        </Field>
      </div>
      <Field label="Description" hint="For staff: what this exam covers. Candidates don’t see it." error={errors.description}>
        <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} maxLength={5000} disabled={!!lock('description')} />
      </Field>
      <Field label="Instructions for candidates" hint="Shown before the exam starts. Markdown works." error={errors.instructions}>
        <Textarea
          value={form.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          rows={4}
          placeholder="Answer all questions. Show your working for written answers."
          disabled={!!lock('instructions')}
        />
      </Field>
      <Field
        label="Total marks"
        hint="The paper must add up to this before you can publish. The review offers a one-click fix if it doesn’t."
        error={errors.totalMarks}
        labelAccessory={lock('totalMarks') && <LockHint reason={lock('totalMarks')!} />}
      >
        <NumberStepper value={form.totalMarks} onCommit={(v) => set({ totalMarks: v })} min={0} max={100000} step={5} decimals={2} disabled={!!lock('totalMarks')} aria-label="Total marks" />
      </Field>
    </>
  );
  if (bare) return <div className="flex flex-col gap-5">{body}</div>;
  return (
    <Group title="Details" description="What the exam is called and what candidates read first.">
      {body}
    </Group>
  );
}

// ---------- schedule ----------

/** `extendOnly` holds the saved close time (local input format) once candidates have started: the window can only grow. */
export function ScheduleGroup({ form, set, setSettings, errors, lock, bare = false, extendOnly }: GroupProps & { bare?: boolean; extendOnly?: string }) {
  const zone = useTimeZoneLabel();
  const windowMin = minutesBetween(fromLocalInput(form.opens), fromLocalInput(form.closes));
  const late = form.settings.lateEntryMinutes;
  const opensLock = lock('windowOpensAt');
  const durationLock = lock('durationMinutes');
  const lateLock = lock('settings.lateEntryMinutes');
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-footnote text-label-secondary">
        <Globe2 aria-hidden className="size-3.5 text-label-tertiary" />
        Times are in your timezone{zone ? `, ${zone}` : ''}. Candidates see them in theirs.
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Window opens" required error={errors.windowOpensAt} labelAccessory={opensLock && <LockHint reason={opensLock} />}>
          <Input type="datetime-local" value={form.opens} onChange={(e) => set({ opens: e.target.value })} disabled={!!opensLock} />
        </Field>
        <Field
          label="Window closes"
          required
          error={errors.windowClosesAt}
          hint={extendOnly ? 'Candidates have started, so the window can only be extended.' : undefined}
          labelAccessory={lock('windowClosesAt') && <LockHint reason={lock('windowClosesAt')!} />}
        >
          <Input type="datetime-local" value={form.closes} onChange={(e) => set({ closes: e.target.value })} min={extendOnly ?? (form.opens || undefined)} disabled={!!lock('windowClosesAt')} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Duration"
          required
          error={errors.durationMinutes}
          hint={windowMin && windowMin > 0 ? `Each candidate gets ${formatMinutes(form.durationMinutes)} from when they start. The window is ${formatMinutes(windowMin)}.` : 'Time each candidate gets from when they start.'}
          labelAccessory={durationLock && <LockHint reason={durationLock} />}
        >
          <NumberStepper value={form.durationMinutes} onCommit={(v) => set({ durationMinutes: v })} min={1} max={1440} step={5} suffix="min" disabled={!!durationLock} aria-label="Duration in minutes" />
        </Field>
        <Field label="Offline grace" hint="How long after the deadline a candidate who lost their connection can still sync answers written offline." error={errorAt(errors, 'settings.reconnectGraceMinutes')}>
          <NumberStepper
            value={form.settings.reconnectGraceMinutes}
            onCommit={(v) => setSettings('reconnectGraceMinutes', v)}
            min={0}
            max={120}
            step={5}
            suffix="min"
            disabled={!!lock('settings.reconnectGraceMinutes')}
            aria-label="Offline grace in minutes"
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <CheckRow
          label="Limit late starts"
          description="Candidates must start within a set time after the window opens."
          checked={late !== null}
          onChange={(v) => setSettings('lateEntryMinutes', v ? 15 : null)}
          lock={lateLock}
        />
        {late !== null && (
          <Field label="Latest start" hint="Minutes after the window opens." error={errorAt(errors, 'settings.lateEntryMinutes')} className="pl-7">
            <NumberStepper value={late} onCommit={(v) => setSettings('lateEntryMinutes', v)} min={0} max={10080} step={5} suffix="min" disabled={!!lateLock} aria-label="Latest start in minutes" />
          </Field>
        )}
      </div>
    </>
  );
  if (bare) return <div className="flex flex-col gap-5">{body}</div>;
  return (
    <Group title="Schedule and timing" description="When candidates can start and how long each one gets.">
      {body}
    </Group>
  );
}

// ---------- delivery ----------

export function DeliveryGroup({ form, setSettings, errors, lock }: GroupProps) {
  const s = form.settings;
  const navLock = lock('settings.navigation');
  return (
    <Group title="Delivery" description="How the paper is put together and moved through.">
      <Field
        label="Navigation"
        hint={s.navigation === 'free' ? 'Candidates can move between questions and come back.' : 'Forward only. Once a candidate moves on, they can’t return.'}
        labelAccessory={navLock && <LockHint reason={navLock} />}
      >
        <div>
          <SegmentedControl
            aria-label="Navigation"
            value={s.navigation}
            onValueChange={(v) => !navLock && setSettings('navigation', v)}
            options={[
              { value: 'free', label: 'Free', disabled: !!navLock },
              { value: 'linear', label: 'Forward only', disabled: !!navLock },
            ]}
          />
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <CheckRow
          label="Shuffle question order"
          description="Each candidate gets the sections’ questions in a different order."
          checked={s.shuffleQuestions}
          onChange={(v) => setSettings('shuffleQuestions', v)}
          lock={lock('settings.shuffleQuestions')}
        />
        <CheckRow
          label="Shuffle answer options"
          description="Choice options appear in a different order per candidate."
          checked={s.shuffleOptions}
          onChange={(v) => setSettings('shuffleOptions', v)}
          lock={lock('settings.shuffleOptions')}
        />
        <CheckRow label="Calculator" description="A basic calculator in the exam toolbar." checked={s.allowCalculator} onChange={(v) => setSettings('allowCalculator', v)} lock={lock('settings.allowCalculator')} />
        <CheckRow
          label="Scratchpad"
          description="A drawing pad for rough work; pages can be attached as working."
          checked={s.allowScratchpad}
          onChange={(v) => setSettings('allowScratchpad', v)}
          lock={lock('settings.allowScratchpad')}
        />
      </div>
      <Field label="Access code" hint="Optional. Candidates type it before starting; announce it in the room." error={errorAt(errors, 'settings.accessCode')}>
        <Input
          value={s.accessCode ?? ''}
          onChange={(e) => setSettings('accessCode', e.target.value.trim() ? e.target.value : null)}
          placeholder="None"
          maxLength={32}
          className="font-mono"
          containerClassName="sm:max-w-xs"
          disabled={!!lock('settings.accessCode')}
        />
      </Field>
    </Group>
  );
}

// ---------- marking ----------

const MULTI_SELECT: { value: MarkingScheme['multiSelect']; label: string; description: string }[] = [
  { value: 'all_or_nothing', label: 'All or nothing', description: 'Full marks only for exactly the right set of options.' },
  { value: 'partial', label: 'Partial credit', description: 'Credit for each correct option picked. Wrong picks cost nothing.' },
  { value: 'partial_penalty', label: 'Partial credit with penalty', description: 'Each wrong pick cancels a correct one. Never below zero.' },
];

const NEGATIVE: { value: string; label: string }[] = [
  { value: '0', label: 'Off' },
  { value: '0.25', label: '¼ of the question’s marks' },
  { value: '0.3333', label: '⅓ of the question’s marks' },
  { value: '0.5', label: '½ of the question’s marks' },
  { value: '1', label: 'The full marks of the question' },
];

export function MarkingGroup({ form, setSettings, errors, lock }: GroupProps) {
  const s = form.settings;
  const markLock = lock('settings.marking');
  const negative = String(s.marking.negativeMarking);
  const negOptions = NEGATIVE.some((o) => o.value === negative) ? NEGATIVE : [...NEGATIVE, { value: negative, label: `${Math.round(s.marking.negativeMarking * 100)}% of the question’s marks` }];
  return (
    <Group title="Marking" description="How auto-graded answers turn into marks.">
      <Field label="Multiple-select questions" labelAccessory={markLock && <LockHint reason={markLock} />} error={errorAt(errors, 'settings.marking.multiSelect')}>
        <RadioGroup
          value={s.marking.multiSelect}
          onValueChange={(v) => setSettings('marking', { ...s.marking, multiSelect: v as MarkingScheme['multiSelect'] })}
          disabled={!!markLock}
          className="gap-3 pt-1"
        >
          {MULTI_SELECT.map((o) => (
            <Radio key={o.value} value={o.value} label={o.label} description={o.description} />
          ))}
        </RadioGroup>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Wrong answers on single choice and true/false"
          hint="Deducted from the candidate’s total, never below zero for the question."
          error={errorAt(errors, 'settings.marking.negativeMarking')}
          labelAccessory={markLock && <LockHint reason={markLock} />}
        >
          <Select
            value={negative}
            onValueChange={(v) => setSettings('marking', { ...s.marking, negativeMarking: Number(v) })}
            options={negOptions}
            disabled={!!markLock}
          />
        </Field>
        <PassMark form={form} setSettings={setSettings} errors={errors} lock={lock} />
      </div>
    </Group>
  );
}

function PassMark({ form, setSettings, errors, lock }: Pick<GroupProps, 'form' | 'setSettings' | 'errors' | 'lock'>) {
  const pass = form.settings.passPercent;
  return (
    <div className="flex flex-col gap-3">
      <CheckRow label="Report pass or fail" description="Results show whether each candidate reached the pass mark." checked={pass !== null} onChange={(v) => setSettings('passPercent', v ? 50 : null)} lock={lock('settings.passPercent')} />
      {pass !== null && (
        <Field label="Pass mark" error={errorAt(errors, 'settings.passPercent')} className="pl-7">
          <NumberStepper value={pass} onCommit={(v) => setSettings('passPercent', v)} min={0} max={100} step={5} decimals={1} suffix="%" aria-label="Pass mark percent" disabled={!!lock('settings.passPercent')} />
        </Field>
      )}
    </div>
  );
}

// ---------- integrity ----------

export function IntegrityGroup({ form, setSettings, errors, lock }: GroupProps) {
  const i = form.settings.integrity;
  const l = lock('settings.integrity');
  const set = (patch: Partial<ExamSettings['integrity']>) => setSettings('integrity', { ...i, ...patch });
  return (
    <Group title="Integrity" description="Signals collected during the attempt. Nothing here ends an attempt on its own; proctors review what it records.">
      <div className="grid gap-4 sm:grid-cols-2">
        <CheckRow label="Require full screen" description="Leaving full screen is recorded and the candidate is asked to return." checked={i.requireFullscreen} onChange={(v) => set({ requireFullscreen: v })} lock={l} />
        <CheckRow label="Record focus loss" description="Switching tabs or windows is recorded with a timestamp." checked={i.detectFocusLoss} onChange={(v) => set({ detectFocusLoss: v })} lock={l} />
        <CheckRow label="Block copy and paste" description="Paste into answers is blocked and attempts are recorded." checked={i.blockCopyPaste} onChange={(v) => set({ blockCopyPaste: v })} lock={l} />
        <CheckRow label="Watermark each paper" description="A per-candidate code on the paper traces a leaked screenshot back to its source." checked={i.watermark} onChange={(v) => set({ watermark: v })} lock={l} />
      </div>
      <Field label="Honor code" hint="Candidates accept it before starting. Leave empty to skip." error={errorAt(errors, 'settings.integrity.honorCode')} labelAccessory={l && <LockHint reason={l} />}>
        <Textarea value={i.honorCode ?? ''} onChange={(e) => set({ honorCode: e.target.value.trim() ? e.target.value : null })} rows={2} maxLength={2000} disabled={!!l} />
      </Field>
    </Group>
  );
}

// ---------- results ----------

export function ResultsGroup({ form, setSettings, errors, lock }: GroupProps) {
  const r = form.settings.results;
  const set = (patch: Partial<ExamSettings['results']>) => setSettings('results', { ...r, ...patch });
  return (
    <Group title="Results and grading" description="What candidates see once you publish results, and how graders see candidates.">
      <div className="grid gap-4 sm:grid-cols-2">
        <CheckRow label="Show correct answers" description="Candidates see the answer key next to their own answers." checked={r.showCorrectAnswers} onChange={(v) => set({ showCorrectAnswers: v })} lock={lock('settings.results')} />
        <CheckRow label="Show feedback" description="Explanations and grader comments are visible in results." checked={r.showFeedback} onChange={(v) => set({ showFeedback: v })} lock={lock('settings.results')} />
        <CheckRow label="Allow disputes" description="Candidates can ask for a question to be re-marked." checked={r.allowDisputes} onChange={(v) => set({ allowDisputes: v })} lock={lock('settings.results')} />
        <CheckRow
          label="Anonymous grading"
          description="Graders see a candidate number, not a name."
          checked={form.settings.grading.anonymous}
          onChange={(v) => setSettings('grading', { ...form.settings.grading, anonymous: v })}
          lock={lock('settings.grading')}
        />
      </div>
      {r.allowDisputes && (
        <Field label="Dispute window" hint="Days after results are published." error={errorAt(errors, 'settings.results.disputeWindowDays')}>
          <NumberStepper value={r.disputeWindowDays} onCommit={(v) => set({ disputeWindowDays: v })} min={0} max={60} suffix="days" aria-label="Dispute window in days" disabled={!!lock('settings.results.disputeWindowDays')} />
        </Field>
      )}
    </Group>
  );
}

// ---------- fairness ----------

export function FairnessGroup({ form, setSettings, errors, lock }: GroupProps) {
  const f = form.settings.fairness;
  const l = lock('settings.fairness');
  return (
    <Group title="Fairness" description="When sections draw from a pool, randomized papers can differ in difficulty. Athena can balance them.">
      <CheckRow
        label="Balance paper difficulty"
        description="Each candidate’s draw is chosen so its expected score stays close to the exam’s target, using observed difficulty where it exists."
        checked={f.balanceDifficulty}
        onChange={(v) => setSettings('fairness', { ...f, balanceDifficulty: v })}
        lock={l}
      />
      {f.balanceDifficulty && (
        <Field label="Allowed difference" hint="How far a paper’s expected score may drift from the target, as a share of total marks." error={errorAt(errors, 'settings.fairness')} className={cn('pl-7')}>
          <NumberStepper value={f.tolerancePercent} onCommit={(v) => setSettings('fairness', { ...f, tolerancePercent: v })} min={0.5} max={20} step={0.5} decimals={1} suffix="%" disabled={!!l} aria-label="Allowed difference percent" />
        </Field>
      )}
    </Group>
  );
}

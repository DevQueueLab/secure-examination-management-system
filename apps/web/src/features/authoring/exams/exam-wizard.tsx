'use client';

import type { ExamSettings } from '@athena/shared';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCreateExam } from '../api';
import { formatMinutes, formatWindow, fromLocalInput } from '../lib/datetime';
import { formatMarks } from '../lib/format';
import { blankForm, inputFromForm, scheduleDefaults, stepOf, validateBasics, validateSchedule, type ExamFormState, type FormErrors } from './exam-form';
import { BasicsGroup, DeliveryGroup, FairnessGroup, IntegrityGroup, MarkingGroup, ResultsGroup, ScheduleGroup } from './settings-groups';

const STEPS = [
  { title: 'Basics', description: 'Name, instructions and total marks.' },
  { title: 'Schedule and timing', description: 'When the window opens and how long each candidate gets.' },
  { title: 'Rules', description: 'Navigation, marking, integrity, results and fairness.' },
  { title: 'Create', description: 'Check the summary, then create the draft.' },
] as const;

const noLock = () => undefined;

export function ExamWizard() {
  const router = useRouter();
  const create = useCreateExam();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [form, setForm] = useState<ExamFormState>(blankForm);
  const [errors, setErrors] = useState<FormErrors>({});

  // Clock-dependent defaults are set after mount so server and browser render the same markup.
  useEffect(() => setForm((f) => (f.opens ? f : { ...f, ...scheduleDefaults() })), []);

  const set = (patch: Partial<ExamFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) {
        delete next[k];
        if (k === 'opens') delete next.windowOpensAt;
        if (k === 'closes') delete next.windowClosesAt;
      }
      return next;
    });
  };
  const setSettings = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => {
    setForm((f) => ({ ...f, settings: { ...f.settings, [key]: value } }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`settings.${key}`))));
  };

  const go = (target: number) => {
    setStep(target);
    setReached((r) => Math.max(r, target));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    const found = step === 0 ? validateBasics(form) : step === 1 ? validateSchedule(form) : {};
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    go(step + 1);
  };

  const submit = () => {
    const all = { ...validateBasics(form), ...validateSchedule(form) };
    if (Object.keys(all).length) {
      setErrors(all);
      go(Math.min(...Object.keys(all).map(stepOf)));
      return;
    }
    create.mutate(inputFromForm(form), {
      onSuccess: (exam) => {
        toast.success('Draft created. Add questions next.');
        router.push(`/exams/${exam.id}`);
      },
      onError: (e) => {
        if (isApiError(e) && Object.keys(e.fields).length) {
          setErrors(e.fields);
          go(Math.min(...Object.keys(e.fields).map(stepOf)));
          toast.error('Some details need another look.');
        } else toast.error(errorMessage(e));
      },
    });
  };

  const groupProps = { form, set, setSettings, errors, lock: noLock };

  return (
    <>
      <PageHeader title="New exam" subtitle="Four short steps. It stays a draft until you review and publish it." breadcrumbs={[{ label: 'Exams', href: '/exams' }, { label: 'New exam' }]} />

      <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          const reachable = i <= reached;
          return (
            <li key={s.title} className="min-w-0">
              <button
                type="button"
                disabled={!reachable || current}
                onClick={() => go(i)}
                aria-current={current ? 'step' : undefined}
                className={cn('group flex w-full flex-col gap-2 text-left disabled:cursor-default', reachable && !current && 'cursor-pointer')}
              >
                <span className={cn('h-1 rounded-full transition-colors duration-200', i <= step ? 'bg-accent' : 'bg-fill-strong')} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums',
                      done ? 'bg-accent text-on-accent' : current ? 'bg-accent-tint text-accent-text' : 'bg-fill text-label-tertiary',
                    )}
                  >
                    {done ? <Check aria-hidden className="size-3" /> : i + 1}
                  </span>
                  <span className={cn('hidden truncate text-footnote font-medium sm:block', current ? 'text-label' : 'text-label-secondary', reachable && !current && 'group-hover:text-label')}>
                    {s.title}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-title-2 text-label">{STEPS[step]!.title}</h2>
            <p className="text-callout text-label-secondary">{STEPS[step]!.description}</p>
          </div>

          {step === 0 && (
            <Card>
              <BasicsGroup {...groupProps} bare />
            </Card>
          )}
          {step === 1 && (
            <Card>
              <ScheduleGroup {...groupProps} bare />
            </Card>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-8">
              <DeliveryGroup {...groupProps} />
              <MarkingGroup {...groupProps} />
              <IntegrityGroup {...groupProps} />
              <ResultsGroup {...groupProps} />
              <FairnessGroup {...groupProps} />
            </div>
          )}
          {step === 3 && <ReviewStep form={form} onEdit={go} />}

          <div className="flex items-center justify-between gap-3 border-t border-separator pt-5">
            {step > 0 ? (
              <Button variant="gray" onClick={() => go(step - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="plain" onClick={() => router.push('/exams')}>
                Cancel
              </Button>
            )}
            {step < 3 ? (
              <Button variant="filled" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="filled" onClick={submit} loading={create.isPending}>
                Create draft
              </Button>
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Summary form={form} />
          </div>
        </aside>
      </div>
    </>
  );
}

function summaryRows(form: ExamFormState): { label: string; value: string; step: number }[] {
  const s = form.settings;
  const opens = fromLocalInput(form.opens);
  const closes = fromLocalInput(form.closes);
  const negative = s.marking.negativeMarking;
  return [
    { label: 'Title', value: form.title.trim() || 'Untitled', step: 0 },
    { label: 'Total marks', value: formatMarks(form.totalMarks), step: 0 },
    { label: 'Window', value: opens && closes ? formatWindow(opens, closes) : 'Not set', step: 1 },
    { label: 'Duration', value: formatMinutes(form.durationMinutes), step: 1 },
    { label: 'Late starts', value: s.lateEntryMinutes === null ? 'Any time in the window' : `Up to ${formatMinutes(s.lateEntryMinutes)} after opening`, step: 1 },
    { label: 'Navigation', value: s.navigation === 'free' ? 'Free' : 'Forward only', step: 2 },
    { label: 'Shuffling', value: [s.shuffleQuestions && 'questions', s.shuffleOptions && 'options'].filter(Boolean).join(' and ') || 'Off', step: 2 },
    {
      label: 'Multiple select',
      value: s.marking.multiSelect === 'all_or_nothing' ? 'All or nothing' : s.marking.multiSelect === 'partial' ? 'Partial credit' : 'Partial with penalty',
      step: 2,
    },
    { label: 'Negative marking', value: negative ? `−${Math.round(negative * 100)}% per wrong answer` : 'Off', step: 2 },
    {
      label: 'Integrity',
      value: [s.integrity.requireFullscreen && 'full screen', s.integrity.detectFocusLoss && 'focus', s.integrity.blockCopyPaste && 'no paste', s.integrity.watermark && 'watermark'].filter(Boolean).join(', ') || 'Off',
      step: 2,
    },
    { label: 'Pass mark', value: s.passPercent === null ? 'None' : `${s.passPercent}%`, step: 2 },
    { label: 'Fairness', value: s.fairness.balanceDifficulty ? `Balanced within ${s.fairness.tolerancePercent}%` : 'Off', step: 2 },
  ];
}

function Summary({ form }: { form: ExamFormState }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-footnote font-medium text-label-secondary">Summary</h3>
      <dl className="flex flex-col rounded-xl bg-surface px-4 py-1 shadow-xs">
        {summaryRows(form).map((r, i) => (
          <div key={r.label} className={cn('flex flex-col gap-0.5 py-2.5', i > 0 && 'border-t border-separator')}>
            <dt className="text-caption text-label-tertiary">{r.label}</dt>
            <dd className="text-footnote text-label">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ReviewStep({ form, onEdit }: { form: ExamFormState; onEdit: (step: number) => void }) {
  const rows = summaryRows(form);
  return (
    <div className="flex flex-col gap-6">
      {[0, 1, 2].map((stepIndex) => (
        <section key={stepIndex} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-headline text-label">{STEPS[stepIndex]!.title}</h3>
            <Button variant="plain" size="sm" onClick={() => onEdit(stepIndex)}>
              Edit
            </Button>
          </div>
          <dl className="grid overflow-hidden rounded-xl bg-surface shadow-xs sm:grid-cols-2">
            {rows
              .filter((r) => r.step === stepIndex)
              .map((r) => (
                <div key={r.label} className="flex flex-col gap-0.5 border-b border-separator px-4 py-3 sm:[&:nth-last-child(-n+2)]:border-b-0 [&:last-child]:border-b-0">
                  <dt className="text-footnote text-label-secondary">{r.label}</dt>
                  <dd className="text-callout text-label">{r.value}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      <p className="text-footnote text-label-secondary">
        Creating the draft adds an empty first section. Next you add questions from the bank, enroll candidates and run the review before publishing. Nothing is visible to candidates until then.
      </p>
    </div>
  );
}

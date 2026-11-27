'use client';

import type { ExamSettings } from '@athena/shared';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useExam, useUpdateExam } from '../api';
import { LoadError } from '../components/load-error';
import { toLocalInput } from '../lib/datetime';
import { revealFirstError } from '../lib/field-errors';
import { plural } from '../lib/format';
import type { ExamDetail } from '../types';
import { formFromExam, lockReasonFor, patchFromForm, validateBasics, validateSchedule, type ExamFormState, type FormErrors } from './exam-form';
import { BasicsGroup, DeliveryGroup, FairnessGroup, IntegrityGroup, MarkingGroup, ResultsGroup, ScheduleGroup } from './settings-groups';

export function ExamSettingsView({ examId }: { examId: string }) {
  const query = useExam(examId);
  if (query.isError) return <LoadError error={query.error} what="exam" onRetry={() => void query.refetch()} backHref="/exams" backLabel="All exams" />;
  if (!query.data) return <SettingsSkeleton />;
  return <SettingsForm exam={query.data} />;
}

function SettingsForm({ exam }: { exam: ExamDetail }) {
  const update = useUpdateExam(exam.id);
  const confirm = useConfirm();
  const [form, setForm] = useState<ExamFormState>(() => formFromExam(exam));
  const [errors, setErrors] = useState<FormErrors>({});
  const patch = patchFromForm(exam, form);
  const dirty = Object.keys(patch).length > 0;

  // Follow changes made elsewhere (another tab, a quick fix) while nothing is being edited here.
  useEffect(() => {
    if (!dirty) setForm(formFromExam(exam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.updatedAt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (p: Partial<ExamFormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setErrors({});
  };
  const setSettings = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => {
    setForm((f) => ({ ...f, settings: { ...f.settings, [key]: value } }));
    setErrors({});
  };
  const lock = (path: string) => lockReasonFor(exam, path);

  const save = () => {
    const found = { ...validateBasics(form), ...validateSchedule(form) };
    if (exam.locks.windowClosesAt === 'extend_only' && patch.windowClosesAt && new Date(patch.windowClosesAt) < new Date(exam.windowClosesAt)) {
      found.windowClosesAt = 'Candidates have started, so the window can only be extended, not shortened';
    }
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error(`${plural(Object.keys(found).length, 'setting')} to fix`);
      revealFirstError();
      return;
    }
    update.mutate(patch, {
      onSuccess: (next) => {
        setForm(formFromExam(next));
        toast.success(exam.status === 'published' ? 'Saved. Candidates see the changes right away.' : 'Settings saved');
      },
      onError: (e) => {
        if (isApiError(e) && Object.keys(e.fields).length) {
          setErrors(e.fields);
          toast.error(e.message);
          revealFirstError();
        } else toast.error(errorMessage(e));
      },
    });
  };

  const props = { form, set, setSettings, errors, lock };
  const readOnly = exam.status === 'archived' || !exam.can.edit;

  return (
    <div className="flex flex-col gap-10 pb-28">
      {(exam.locks.locked || readOnly) && (
        <div className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 text-callout text-label-secondary shadow-xs">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
          <p>
            {exam.status === 'archived'
              ? 'This exam is archived, so its settings are read-only.'
              : !exam.can.edit
                ? 'You can view these settings. Only the owner and co-examiners can change them.'
                : 'Candidates have started, so settings that shape the paper are locked. Hover the lock beside a setting to see why. The window can still be extended.'}
          </p>
        </div>
      )}
      <BasicsGroup {...props} />
      <ScheduleGroup {...props} extendOnly={exam.locks.windowClosesAt === 'extend_only' ? toLocalInput(exam.windowClosesAt) : undefined} />
      <DeliveryGroup {...props} />
      <MarkingGroup {...props} />
      <IntegrityGroup {...props} />
      <ResultsGroup {...props} />
      <FairnessGroup {...props} />

      {!readOnly && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pl-[264px]">
          <div className="material pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl px-4 py-2.5 shadow-lg ring-1 ring-separator">
            <p className="min-w-0 flex-1 truncate text-footnote text-label-secondary" aria-live="polite">
              {dirty ? `Unsaved changes to ${plural(Object.keys(patch).length + (patch.settings ? Object.keys(patch.settings).length - 1 : 0), 'setting')}.` : 'All settings saved.'}
            </p>
            {dirty && (
              <Button
                variant="plain"
                size="sm"
                onClick={async () => {
                  if (await confirm({ title: 'Discard your changes?', description: 'Settings go back to what was last saved.', confirmLabel: 'Discard', destructive: true })) {
                    setForm(formFromExam(exam));
                    setErrors({});
                  }
                }}
              >
                Discard
              </Button>
            )}
            <Button variant="filled" size="sm" onClick={save} disabled={!dirty} loading={update.isPending}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy aria-label="Loading settings">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

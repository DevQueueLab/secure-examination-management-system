'use client';

import { Users } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { SearchField } from '@/features/admin/components/search-field';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useEligibleCandidates, useEnrollmentMutations } from '../api';
import { plural } from '../lib/format';
import type { ExamDetail } from '../types';

/** Enroll existing candidates one by one, or a whole cohort in one go. */
export function EnrollDialog({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const [mode, setMode] = useState<'people' | 'cohort'>('people');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cohort, setCohort] = useState<string | null>(null);
  const eligible = useEligibleCandidates(exam.id, { q: q || undefined }, true);
  const { enroll } = useEnrollmentMutations(exam.id);
  const items = eligible.data?.items ?? [];
  const cohorts = eligible.data?.cohorts ?? [];
  const chosenCohort = cohorts.find((c) => c.cohort === cohort);

  const submit = () =>
    enroll.mutate(mode === 'cohort' ? { cohort: cohort! } : { userIds: [...picked] }, {
      onSuccess: (r) => {
        toast.success(`${plural(r.enrolled, 'candidate')} enrolled${r.alreadyEnrolled ? ` (${r.alreadyEnrolled} already were)` : ''}`);
        onClose();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const canSubmit = mode === 'cohort' ? !!chosenCohort && chosenCohort.available > 0 : picked.size > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg">
        <DialogHeader title="Enroll candidates" description="People with a candidate role in your organization. To add someone without an account, use Import." />
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="Enroll by"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'people', label: 'Choose people' },
              { value: 'cohort', label: 'Whole cohort' },
            ]}
          />
          {mode === 'people' ? (
            <>
              <SearchField label="Search candidates" placeholder="Search by name, email or roll number" value={q} onChange={setQ} />
              <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-sunken">
                {!eligible.data ? (
                  <div className="p-3">
                    <SkeletonRows rows={5} />
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState size="sm" surface={false} icon={<Users />} title={q ? 'No one matches' : 'Everyone is enrolled'} description={q ? 'Try a roll number or email.' : 'Every candidate in your organization is already in this exam.'} />
                ) : (
                  <ul className="divide-y divide-separator">
                    {items.map((p) => {
                      const on = picked.has(p.userId);
                      return (
                        <li key={p.userId}>
                          <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill-secondary', on && 'bg-accent-tint hover:bg-accent-tint')}>
                            <Checkbox
                              checked={on}
                              onCheckedChange={() =>
                                setPicked((s) => {
                                  const next = new Set(s);
                                  if (next.has(p.userId)) next.delete(p.userId);
                                  else next.add(p.userId);
                                  return next;
                                })
                              }
                              aria-label={`Select ${p.name}`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-callout text-label">{p.name}</span>
                              <span className="truncate text-caption text-label-secondary">{p.email}</span>
                            </span>
                            <span className="hidden shrink-0 gap-3 text-footnote text-label-secondary sm:flex">
                              {p.rollNumber && <span className="font-mono">{p.rollNumber}</span>}
                              {p.cohort && <span>{p.cohort}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {items.length > 0 && (
                <div className="flex items-center justify-between text-footnote text-label-secondary">
                  <span>{picked.size ? `${plural(picked.size, 'person', 'people')} selected` : `${items.length} available`}</span>
                  <Button variant="plain" size="sm" onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((i) => i.userId)))}>
                    {picked.size === items.length ? 'Select none' : 'Select all shown'}
                  </Button>
                </div>
              )}
            </>
          ) : cohorts.length === 0 ? (
            <EmptyState size="sm" icon={<Users />} title="No cohorts yet" description="Cohorts come from people’s profiles or a candidate import (the cohort column)." />
          ) : (
            <RadioGroup aria-label="Cohorts" value={cohort ?? ''} onValueChange={setCohort} className="gap-0 divide-y divide-separator rounded-xl bg-surface-sunken">
              {cohorts.map((c) => (
                <div key={c.cohort} className={cn('px-4 py-3', cohort === c.cohort && 'bg-accent-tint')}>
                  <Radio
                    value={c.cohort}
                    disabled={c.available === 0}
                    label={c.cohort}
                    description={
                      c.available === 0 ? `All ${c.members} already enrolled` : c.available === c.members ? plural(c.members, 'candidate') : `${c.available} of ${c.members} not enrolled yet`
                    }
                  />
                </div>
              ))}
            </RadioGroup>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" disabled={!canSubmit} loading={enroll.isPending} onClick={submit}>
            {mode === 'cohort' ? (chosenCohort ? `Enroll ${plural(chosenCohort.available, 'candidate')}` : 'Enroll cohort') : picked.size ? `Enroll ${plural(picked.size, 'candidate')}` : 'Enroll'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import type { ExamStaffRole } from '@athena/shared';
import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { SearchField } from '@/features/admin/components/search-field';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useEligibleStaff, useExamStaff } from '../api';
import type { EligibleStaff, ExamDetail } from '../types';

export const STAFF_ROLE: Record<ExamStaffRole, { label: string; tone: Tone; description: string }> = {
  owner: { label: 'Owner', tone: 'accent', description: 'Created the exam. Full control.' },
  co_examiner: { label: 'Co-examiner', tone: 'info', description: 'Edits questions, settings and candidates; can publish.' },
  grader: { label: 'Grader', tone: 'success', description: 'Grades written answers and reviews disputes.' },
  proctor: { label: 'Proctor', tone: 'warning', description: 'Watches attempts live and handles incidents.' },
};

/** Who works on this exam. Access to an exam is by this list, so removing someone here removes their access. */
export function StaffPanel({ exam }: { exam: ExamDetail }) {
  const { me } = useAuth();
  const { remove } = useExamStaff(exam.id);
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const manage = exam.can.manageStaff;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="staff-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="staff-title" className="text-headline text-label">
          Staff
        </h2>
        {manage && (
          <Button variant="plain" size="sm" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden /> Add
          </Button>
        )}
      </div>
      <ul className="flex flex-col rounded-xl bg-surface shadow-xs">
        {exam.staff.map((s, i) => (
          <li key={s.userId} className={cn('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-separator')}>
            <Avatar name={s.name} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-callout text-label">
                {s.name}
                {s.userId === me?.user.id && <span className="text-label-tertiary"> (you)</span>}
              </span>
              <span className="truncate text-caption text-label-secondary">{s.email}</span>
            </span>
            <Badge size="sm" tone={STAFF_ROLE[s.role].tone} title={STAFF_ROLE[s.role].description}>
              {STAFF_ROLE[s.role].label}
            </Badge>
            {manage && s.role !== 'owner' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${s.name}`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Remove ${s.name}?`,
                    description: `They lose access to this exam as ${STAFF_ROLE[s.role].label.toLowerCase()}. Their past work (grades, notes) stays in the record.`,
                    confirmLabel: 'Remove',
                    destructive: true,
                  });
                  if (!ok) return;
                  remove.mutate(s.userId, {
                    onSuccess: () => toast.success(`${s.name} removed`),
                    onError: (e) => toast.error(errorMessage(e)),
                  });
                }}
              >
                <X aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {adding && <AddStaffDialog exam={exam} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddStaffDialog({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<EligibleStaff | null>(null);
  const [role, setRole] = useState<Exclude<ExamStaffRole, 'owner'> | ''>('');
  const eligible = useEligibleStaff(exam.id, q, true);
  const { add } = useExamStaff(exam.id);
  const existing = new Map(exam.staff.map((s) => [s.userId, s.role]));

  const pick = (p: EligibleStaff) => {
    setPicked(p);
    setRole(p.allowedRoles.includes(role as never) ? role : (p.allowedRoles[0] ?? ''));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader title="Add staff" description="People in your organization whose role allows the job. They get access to this exam only." />
        <DialogBody className="flex flex-col gap-4">
          <SearchField label="Search people" placeholder="Search by name or email" value={q} onChange={setQ} />
          <div className="max-h-72 overflow-y-auto rounded-xl bg-surface-sunken" role="listbox" aria-label="People">
            {!eligible.data ? (
              <div className="p-3">
                <SkeletonRows rows={4} />
              </div>
            ) : eligible.data.length === 0 ? (
              <p className="px-4 py-6 text-center text-callout text-label-secondary">No staff match. Only people with an examiner, grader or proctor role can be added.</p>
            ) : (
              eligible.data.map((p) => {
                const current = existing.get(p.userId);
                const selected = picked?.userId === p.userId;
                return (
                  <button
                    key={p.userId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(p)}
                    className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill-secondary', selected && 'bg-accent-tint hover:bg-accent-tint')}
                  >
                    <Avatar name={p.name} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-callout text-label">{p.name}</span>
                      <span className="flex min-w-0 gap-2 text-caption text-label-secondary">
                        <span className="shrink-0">{p.roleName}</span>
                        <span className="truncate">{p.email}</span>
                      </span>
                    </span>
                    {current && (
                      <Badge size="sm" tone="neutral">
                        {STAFF_ROLE[current].label}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {picked && (
            <Field label={`Role for ${picked.name}`} hint={role ? STAFF_ROLE[role].description : undefined}>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Exclude<ExamStaffRole, 'owner'>)}
                options={(['co_examiner', 'grader', 'proctor'] as const).map((r) => ({
                  value: r,
                  label: STAFF_ROLE[r].label,
                  disabled: !picked.allowedRoles.includes(r),
                  description: picked.allowedRoles.includes(r) ? undefined : `Their ${picked.roleName} role doesn’t allow this`,
                }))}
              />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            disabled={!picked || !role}
            loading={add.isPending}
            onClick={() =>
              picked &&
              role &&
              add.mutate(
                { userId: picked.userId, role },
                {
                  onSuccess: () => {
                    toast.success(`${picked.name} added as ${STAFF_ROLE[role].label.toLowerCase()}`);
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {picked && existing.has(picked.userId) ? 'Change role' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

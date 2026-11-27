'use client';

import { Accessibility, FileUp, MoreHorizontal, Pencil, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Pagination, usePageParam, usePageSizeParam } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { SearchField } from '@/features/admin/components/search-field';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useEnrollmentMutations, useEnrollments, useExam } from '../api';
import { LoadError } from '../components/load-error';
import { NumberStepper } from '../components/number-stepper';
import { formatMinutes } from '../lib/datetime';
import { formatMarks, plural } from '../lib/format';
import type { EnrollmentRow, ExamDetail } from '../types';
import { EnrollDialog } from './enroll-dialog';
import { CandidateImportDialog } from './candidate-import-dialog';

const ALL = '__all';

export function ExamCandidates({ examId }: { examId: string }) {
  const exam = useExam(examId);
  if (exam.isError) return <LoadError error={exam.error} what="exam" onRetry={() => void exam.refetch()} backHref="/exams" backLabel="All exams" />;
  if (!exam.data) return <SkeletonRows rows={8} />;
  return <Candidates exam={exam.data} />;
}

function accommodationLabel(r: Pick<EnrollmentRow, 'timeMultiplier' | 'extraMinutes'>): string | null {
  const parts: string[] = [];
  if (r.timeMultiplier !== 1) parts.push(`${formatMarks(r.timeMultiplier)}× time`);
  if (r.extraMinutes) parts.push(`+${formatMinutes(r.extraMinutes)}`);
  return parts.length ? parts.join(', ') : null;
}

function AttemptStatus({ row }: { row: EnrollmentRow }) {
  const a = row.attempt;
  if (!a) return <span className="text-callout text-label-tertiary">Not started</span>;
  if (a.status === 'in_progress')
    return (
      <Badge size="sm" tone="success" dot>
        Writing
      </Badge>
    );
  if (a.status === 'awaiting_sync')
    return (
      <Badge size="sm" tone="warning" dot>
        Awaiting sync
      </Badge>
    );
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Badge size="sm" tone="info" dot>
        Submitted
      </Badge>
      {a.score !== null && a.maxScore !== null && (
        <span className="text-footnote tabular-nums text-label-secondary">
          {formatMarks(Math.round(a.score * 10) / 10)}/{formatMarks(a.maxScore)}
        </span>
      )}
    </span>
  );
}

function Candidates({ exam }: { exam: ExamDetail }) {
  const [q, setQ] = useState('');
  const [cohort, setCohort] = useState(ALL);
  const [page, setPage] = usePageParam();
  const pageSize = usePageSizeParam(25);
  const list = useEnrollments(exam.id, { q: q || undefined, cohort: cohort === ALL ? undefined : cohort }, page, pageSize);
  const { remove } = useEnrollmentMutations(exam.id);
  const confirm = useConfirm();
  const [enrolling, setEnrolling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<EnrollmentRow | null>(null);
  const manage = exam.can.manageCandidates && exam.status !== 'archived';
  const data = list.data;
  const filtered = !!q || cohort !== ALL;

  const removeRow = async (row: EnrollmentRow) => {
    const ok = await confirm({
      title: `Remove ${row.name}?`,
      description: 'They lose access to this exam. Their account stays in your organization, and you can enroll them again.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) remove.mutate(row.id, { onSuccess: () => toast.success(`${row.name} removed`), onError: (e) => toast.error(errorMessage(e)) });
  };

  // Exam-wide numbers come from the exam; the accommodation count is only exact for the unfiltered list.
  const counts = data
    ? {
        accommodations: filtered ? 0 : data.accommodations,
        writing: exam.counts.attempts.inProgress,
        submitted: exam.counts.attempts.submitted,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField label="Search candidates" placeholder="Search by name, email or roll number" value={q} onChange={(v) => { setQ(v); setPage(1); }} className="md:max-w-sm" />
        {data && data.cohorts.length > 0 && (
          <Select
            aria-label="Cohort"
            size="md"
            className="md:w-48"
            value={cohort}
            onValueChange={(v) => {
              setCohort(v);
              setPage(1);
            }}
            options={[{ value: ALL, label: 'All cohorts' }, ...data.cohorts.map((c) => ({ value: c, label: c }))]}
          />
        )}
        {manage && (
          <div className="flex gap-2 md:ml-auto">
            <Button variant="gray" onClick={() => setImporting(true)}>
              <FileUp aria-hidden /> Import
            </Button>
            <Button variant="filled" onClick={() => setEnrolling(true)}>
              <UserPlus aria-hidden /> Enroll
            </Button>
          </div>
        )}
      </div>

      {data && counts && data.total > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-secondary">
          <span>{plural(exam.counts.enrolled, 'candidate')} enrolled</span>
          {counts.accommodations > 0 && <span>{counts.accommodations} with accommodations</span>}
          {counts.writing > 0 && <span>{counts.writing} writing now</span>}
          {counts.submitted > 0 && <span>{counts.submitted} submitted</span>}
          {filtered && <span>Showing {data.total}</span>}
        </p>
      )}

      {list.isError ? (
        <LoadError error={list.error} what="candidate list" onRetry={() => void list.refetch()} size="sm" />
      ) : !data ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-xs">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : data.total === 0 ? (
        filtered ? (
          <EmptyState icon={<Search />} title="No one matches" description="Try another name, or clear the cohort filter." action={<Button variant="gray" onClick={() => (setQ(''), setCohort(ALL), setPage(1))}>Clear filters</Button>} />
        ) : (
          <EmptyState
            icon={<Users />}
            title="No candidates enrolled"
            description="Enroll people who already have accounts, a whole cohort at once, or import a spreadsheet. New people get accounts with a temporary password."
            action={
              manage ? (
                <div className="flex gap-2">
                  <Button variant="gray" onClick={() => setImporting(true)}>
                    Import a file
                  </Button>
                  <Button variant="filled" onClick={() => setEnrolling(true)}>
                    Enroll candidates
                  </Button>
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <Table containerClassName={cn('rounded-xl bg-surface shadow-xs transition-opacity', list.isPlaceholderData && 'opacity-60')}>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead className="hidden w-36 md:table-cell">Roll number</TableHead>
              <TableHead className="hidden w-28 lg:table-cell">Cohort</TableHead>
              <TableHead className="hidden w-40 sm:table-cell">Accommodation</TableHead>
              <TableHead className="w-36 sm:w-40">Attempt</TableHead>
              {manage && (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((row) => {
              const acc = accommodationLabel(row);
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-0">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-callout font-medium text-label">{row.name}</span>
                      <span className="truncate text-footnote text-label-secondary">{row.email}</span>
                      {acc && (
                        <span className="mt-1 sm:hidden">
                          <Badge size="sm" tone="accent">
                            <Accessibility aria-hidden /> {acc}
                          </Badge>
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-footnote md:table-cell">{row.rollNumber ?? <span className="font-sans text-label-tertiary">–</span>}</TableCell>
                  <TableCell className="hidden lg:table-cell">{row.cohort ?? <span className="text-label-tertiary">–</span>}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {acc ? (
                      <button type="button" disabled={!manage} onClick={() => setEditing(row)} className="text-left disabled:cursor-default" title={row.accommodationNote ?? undefined}>
                        <Badge size="sm" tone="accent">
                          <Accessibility aria-hidden /> {acc}
                        </Badge>
                      </button>
                    ) : (
                      <span className="text-callout text-label-tertiary">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <AttemptStatus row={row} />
                  </TableCell>
                  {manage && (
                    <TableCell className="py-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem icon={<Pencil />} onSelect={() => setEditing(row)}>
                            Accommodation
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem icon={<Trash2 />} destructive disabled={!!row.attempt} onSelect={() => removeRow(row)}>
                            {row.attempt ? 'Remove (has an attempt)' : 'Remove from exam'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {data && <Pagination label="Candidate pages" page={page} pageSize={data.pageSize ?? pageSize} total={data.total} onPageChange={setPage} />}

      {enrolling && <EnrollDialog exam={exam} onClose={() => setEnrolling(false)} />}
      {importing && <CandidateImportDialog exam={exam} onClose={() => setImporting(false)} />}
      <AccommodationSheet exam={exam} row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

const MULTIPLIERS = ['1', '1.25', '1.5', '2'];

function AccommodationSheet({ exam, row, onClose }: { exam: ExamDetail; row: EnrollmentRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      {row && <AccommodationForm key={row.id} exam={exam} row={row} onClose={onClose} />}
    </Sheet>
  );
}

function AccommodationForm({ exam, row, onClose }: { exam: ExamDetail; row: EnrollmentRow; onClose: () => void }) {
  const { update } = useEnrollmentMutations(exam.id);
  const [multiplier, setMultiplier] = useState(row.timeMultiplier);
  const [extra, setExtra] = useState(row.extraMinutes);
  const [note, setNote] = useState(row.accommodationNote ?? '');
  // Custom is a mode, not a value: stepping a custom multiplier onto 1.5 must not hide the stepper mid-edit.
  const [custom, setCustom] = useState(() => !MULTIPLIERS.includes(String(row.timeMultiplier)));
  const total = Math.round(exam.durationMinutes * multiplier) + extra;

  const save = () =>
    update.mutate(
      { enrollmentId: row.id, timeMultiplier: multiplier, extraMinutes: extra, accommodationNote: note.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(r.hasActiveAttempt ? 'Saved. Their running attempt keeps its current deadline; the change applies to a new attempt.' : `${row.name} gets ${formatMinutes(total)}`);
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <SheetContent title={`Accommodation for ${row.name}`} description={row.email}>
      <div className="flex flex-col gap-5">
        <Field label="Extra time" hint="Multiplies the exam duration for this candidate.">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-full sm:w-64"
              value={custom ? 'custom' : String(multiplier)}
              onValueChange={(v) => {
                if (v === 'custom') {
                  setCustom(true);
                } else {
                  setCustom(false);
                  setMultiplier(Number(v));
                }
              }}
              options={[
                { value: '1', label: 'None (1×)' },
                { value: '1.25', label: '1.25× (time and a quarter)' },
                { value: '1.5', label: '1.5× (time and a half)' },
                { value: '2', label: '2× (double time)' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {custom && <NumberStepper value={multiplier} onCommit={setMultiplier} min={1} max={3} step={0.05} decimals={2} suffix="×" aria-label="Time multiplier" />}
          </div>
        </Field>
        <Field label="Additional minutes" hint="Added after the multiplier, e.g. for rest breaks.">
          <NumberStepper value={extra} onCommit={setExtra} min={0} max={600} step={5} suffix="min" aria-label="Additional minutes" />
        </Field>
        <Field label="Note" hint="Visible to staff only, e.g. the approval reference.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Who approved it, and the reference" />
        </Field>
        <div className="rounded-xl bg-surface-sunken px-4 py-3 text-callout text-label">
          {row.name} gets <span className="font-semibold tabular-nums">{formatMinutes(total)}</span>
          {total !== exam.durationMinutes && <span className="text-label-secondary"> instead of {formatMinutes(exam.durationMinutes)}</span>}.
          {row.attempt?.status === 'in_progress' && <p className="mt-1 text-footnote text-warning-text">They are writing now. A running attempt keeps the deadline it started with.</p>}
        </div>
      </div>
      <SheetFooter>
        <Button variant="gray" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="filled" className="flex-1" onClick={save} loading={update.isPending}>
          Save
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

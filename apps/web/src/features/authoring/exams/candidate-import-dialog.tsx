'use client';

import { CircleCheck, Download } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { CredentialsTable } from '@/features/admin/components/credentials';
import { API_BASE, errorMessage } from '@/lib/api';
import { useEnrollmentMutations } from '../api';
import { FileDrop, type DroppedFile } from '../components/file-drop';
import { RowErrorsTable } from '../components/row-errors';
import { plural } from '../lib/format';
import type { CandidateImportResult, ExamDetail } from '../types';

const STATUS = {
  new_account: { label: 'New account', tone: 'accent' },
  new_member: { label: 'Joins organization', tone: 'info' },
  existing_member: { label: 'Existing', tone: 'neutral' },
} as const;

/**
 * Candidate import: read the file, dry-run on the server (row errors, who is new), then commit in one
 * transaction. Temporary passwords for new accounts are shown exactly once.
 */
export function CandidateImportDialog({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const { importFile } = useEnrollmentMutations(exam.id);
  const confirm = useConfirm();
  const [file, setFile] = useState<DroppedFile | null>(null);
  const [report, setReport] = useState<CandidateImportResult | null>(null);
  const [done, setDone] = useState<CandidateImportResult | null>(null);
  const [saved, setSaved] = useState(false);

  const dryRun = (f: DroppedFile) =>
    importFile.mutate({ format: f.format, data: f.text, dryRun: true, filename: f.name }, { onSuccess: setReport, onError: (e) => toast.error(errorMessage(e)) });

  const commit = () =>
    file &&
    importFile.mutate(
      { format: file.format, data: file.text, dryRun: false, filename: file.name },
      {
        onSuccess: (r) => {
          setDone(r);
          toast.success(`${plural(r.enrolled, 'candidate')} enrolled`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const close = async () => {
    if (done?.credentials.length && !saved) {
      const ok = await confirm({
        title: 'Close without saving the passwords?',
        description: 'Temporary passwords are shown only once. Without them, the new candidates need a password reset before they can sign in.',
        confirmLabel: 'Close anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && void close()}>
      <DialogContent size="xl">
        <DialogHeader
          title={done ? 'Import complete' : 'Import candidates'}
          description={done ? undefined : 'Columns: name, email, roll_number, cohort, time_multiplier. People without an account get one with a temporary password.'}
        />
        <DialogBody className="flex flex-col gap-5">
          {done ? (
            <>
              <p className="flex items-center gap-2 text-callout font-medium text-success-text">
                <CircleCheck aria-hidden className="size-4" />
                {plural(done.enrolled, 'candidate')} enrolled{done.counts.newAccounts ? `, ${plural(done.counts.newAccounts, 'new account')} created` : ''}.
              </p>
              {done.credentials.length > 0 && <CredentialsTable credentials={done.credentials} filename={`${(exam.code ?? 'exam').toLowerCase()}-temporary-passwords.csv`} onSaved={() => setSaved(true)} />}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <FileDrop
                  file={file}
                  onFile={(f) => {
                    setFile(f);
                    setReport(null);
                    dryRun(f);
                  }}
                  onClear={() => {
                    setFile(null);
                    setReport(null);
                  }}
                  hint="CSV or JSON, up to 500 candidates"
                />
                <a href={`${API_BASE}/exams/enrollments/template`} className="inline-flex items-center gap-1.5 self-start text-footnote font-medium text-accent-text hover:underline" download>
                  <Download aria-hidden className="size-3.5" /> Download the CSV template
                </a>
              </div>

              {importFile.isPending && !report && <p className="text-callout text-label-secondary">Checking every row…</p>}

              {report && (
                <>
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator sm:grid-cols-5">
                    {[
                      { label: 'Rows', value: report.total },
                      { label: 'Ready', value: report.valid },
                      { label: 'With problems', value: report.invalid, bad: report.invalid > 0 },
                      { label: 'New accounts', value: report.counts.newAccounts },
                      { label: 'Already enrolled', value: report.counts.alreadyEnrolled },
                    ].map((s) => (
                      <div key={s.label} className="flex flex-col gap-0.5 bg-surface-sunken px-3 py-2.5">
                        <dt className="text-caption text-label-secondary">{s.label}</dt>
                        <dd className={s.bad ? 'text-headline tabular-nums text-danger-text' : 'text-headline tabular-nums text-label'}>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {report.errors.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-headline text-label">Fix these rows, or import without them</h3>
                      <RowErrorsTable errors={report.errors} rowLabel="Line" maxHeight="max-h-56" />
                    </section>
                  )}
                  {report.preview.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-headline text-label">Ready to enroll</h3>
                      <Table containerClassName="max-h-64 overflow-y-auto rounded-xl bg-surface-sunken">
                        <TableHeader className="sticky top-0 z-10 bg-surface-sunken">
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="hidden sm:table-cell">Roll number</TableHead>
                            <TableHead className="hidden sm:table-cell">Cohort</TableHead>
                            <TableHead numeric>Time</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.preview.map((p) => (
                            <TableRow key={p.row}>
                              <TableCell className="max-w-0">
                                <div className="flex min-w-0 flex-col">
                                  <span className="truncate text-callout text-label">{p.name}</span>
                                  <span className="truncate text-caption text-label-secondary">{p.email}</span>
                                </div>
                              </TableCell>
                              <TableCell className="hidden font-mono text-footnote sm:table-cell">{p.rollNumber ?? '–'}</TableCell>
                              <TableCell className="hidden sm:table-cell">{p.cohort ?? '–'}</TableCell>
                              <TableCell numeric>{p.timeMultiplier === 1 ? '1×' : `${p.timeMultiplier}×`}</TableCell>
                              <TableCell>
                                {p.alreadyEnrolled ? (
                                  <Badge size="sm" tone="neutral">
                                    Already enrolled
                                  </Badge>
                                ) : (
                                  <Badge size="sm" tone={STATUS[p.status].tone}>
                                    {STATUS[p.status].label}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {done ? (
            <Button variant="filled" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="gray" onClick={close}>
                Cancel
              </Button>
              <Button variant="filled" disabled={!report || report.valid === 0} loading={importFile.isPending && !!report} onClick={commit}>
                {report ? (report.valid ? `Enroll ${plural(report.valid, 'candidate')}` : 'Nothing to enroll') : 'Enroll'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

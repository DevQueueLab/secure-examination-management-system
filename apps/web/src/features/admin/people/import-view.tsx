'use client';

import {
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  FileUp,
  RotateCcw,
  TriangleAlert,
  Upload,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';
import Papa from 'papaparse';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { API_BASE, errorMessage, isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useImportPeople, useRoles } from '../api';
import { CredentialsTable } from '../components/credentials';
import { RolePill } from '../components/pills';
import { formatBytes, formatCount } from '../format';
import type { ImportReport, ImportRow, RowAction } from '../types';
import { peopleVocabulary } from './person-sheet';

const MAX_BYTES = 3_000_000;
const COLUMNS = ['name', 'email', 'role', 'roll_number', 'cohort'] as const;
type Column = (typeof COLUMNS)[number];

/** Mirrors the server's header aliases so the preview shows exactly how columns will be read. */
const ALIASES: Record<string, Column> = {
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  student_name: 'name',
  candidate_name: 'name',
  participant_name: 'name',
  email: 'email',
  e_mail: 'email',
  email_address: 'email',
  mail: 'email',
  role: 'role',
  role_key: 'role',
  roll_number: 'roll_number',
  roll_no: 'roll_number',
  roll: 'roll_number',
  rollnumber: 'roll_number',
  external_id: 'roll_number',
  externalid: 'roll_number',
  student_id: 'roll_number',
  registration_number: 'roll_number',
  reg_no: 'roll_number',
  competitor_id: 'roll_number',
  cohort: 'cohort',
  batch: 'cohort',
  class: 'cohort',
  section: 'cohort',
  team: 'cohort',
  group: 'cohort',
};
const norm = (h: string) =>
  h
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_');

interface LocalFile {
  name: string;
  size: number;
  text: string;
  format: 'csv' | 'json';
  rows: number;
  mapping: { header: string; column: Column | null }[];
}

function readLocal(file: File, text: string): LocalFile {
  const format = /\.json$/i.test(file.name) || file.type === 'application/json' ? 'json' : 'csv';
  if (format === 'json') {
    let rows = 0;
    const keys = new Set<string>();
    try {
      const data = JSON.parse(text) as unknown;
      if (Array.isArray(data)) {
        rows = data.length;
        for (const item of data.slice(0, 50))
          if (item && typeof item === 'object') Object.keys(item).forEach((k) => keys.add(k));
      }
    } catch {
      /* the server reports invalid JSON precisely */
    }
    return {
      name: file.name,
      size: file.size,
      text,
      format,
      rows,
      mapping: [...keys].map((k) => ({
        header: k,
        column: ALIASES[norm(k.replace(/([a-z])([A-Z])/g, '$1_$2'))] ?? null,
      })),
    };
  }
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    preview: 5000,
  });
  const seen = new Set<Column>();
  const mapping = (parsed.meta.fields ?? []).map((h) => {
    const col = ALIASES[norm(h)] ?? null;
    if (col && !seen.has(col)) {
      seen.add(col);
      return { header: h, column: col };
    }
    return { header: h, column: null };
  });
  return { name: file.name, size: file.size, text, format, rows: parsed.data.length, mapping };
}

const OUTCOME: Record<RowAction, { label: string; tone: Tone }> = {
  create: { label: 'New account', tone: 'success' },
  link: { label: 'Existing account', tone: 'info' },
  update: { label: 'Update details', tone: 'accent' },
  skip: { label: 'No change', tone: 'neutral' },
};

type RowFilter = 'all' | 'problems' | 'warnings' | 'ready';

function cellError(row: ImportRow, field: ImportRow['errors'][number]['field']) {
  return row.errors.find((e) => e.field === field);
}

function Cell({
  row,
  field,
  children,
  className,
}: {
  row: ImportRow;
  field: ImportRow['errors'][number]['field'];
  children: React.ReactNode;
  className?: string;
}) {
  const err = cellError(row, field);
  return (
    <TableCell className={cn(err && 'text-danger-text', className)} title={err?.message}>
      <span className="inline-flex max-w-[16rem] items-center gap-1 truncate">
        {err && <CircleAlert aria-hidden className="size-3.5 shrink-0" />}
        {children}
      </span>
    </TableCell>
  );
}

function ReportTable({
  report,
  words,
}: {
  report: ImportReport;
  words: ReturnType<typeof peopleVocabulary>;
}) {
  const s = report.summary;
  const [filter, setFilter] = useState<RowFilter>(s.invalid > 0 ? 'problems' : 'all');
  const rows = report.rows.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'problems'
        ? r.errors.length > 0
        : filter === 'warnings'
          ? r.warnings.length > 0
          : r.errors.length === 0,
  );
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl<RowFilter>
        aria-label="Rows to show"
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'all', label: `All ${formatCount(s.total)}` },
          {
            value: 'problems',
            label: `Problems ${formatCount(s.invalid)}`,
            disabled: s.invalid === 0,
          },
          {
            value: 'warnings',
            label: `Warnings ${formatCount(s.warnings)}`,
            disabled: s.warnings === 0,
          },
          { value: 'ready', label: `Ready ${formatCount(s.valid)}` },
        ]}
      />
      <Table containerClassName="max-h-[34rem] overflow-y-auto">
        <TableHeader className="sticky top-0 z-10 bg-surface">
          <TableRow>
            <TableHead className="w-14" numeric>
              Row
            </TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden lg:table-cell">{words.externalId}</TableHead>
            <TableHead className="hidden xl:table-cell">{words.cohort}</TableHead>
            <TableHead className="min-w-[13rem]">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.row}
              className={cn('align-top', r.errors.length > 0 && 'bg-danger-tint/40')}
            >
              <TableCell numeric className="text-label-secondary">
                {r.row}
              </TableCell>
              <TableCell className="max-w-[16rem]">
                <p
                  className={cn(
                    'flex items-center gap-1 truncate font-medium',
                    cellError(r, 'name') ? 'text-danger-text' : 'text-label',
                  )}
                  title={cellError(r, 'name')?.message}
                >
                  {cellError(r, 'name') && (
                    <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                  )}
                  {r.name || <span className="italic">No name</span>}
                </p>
                <p
                  className={cn(
                    'flex items-center gap-1 truncate text-footnote',
                    cellError(r, 'email') ? 'text-danger-text' : 'text-label-secondary',
                  )}
                  title={cellError(r, 'email')?.message}
                >
                  {cellError(r, 'email') && <CircleAlert aria-hidden className="size-3 shrink-0" />}
                  {r.email || <span className="italic">No email</span>}
                </p>
              </TableCell>
              <Cell row={r} field="role">
                {r.role ? (
                  <RolePill role={r.role} />
                ) : (
                  <span>{cellError(r, 'role') ? 'Unknown' : '—'}</span>
                )}
              </Cell>
              <Cell row={r} field="roll_number" className="hidden tabular-nums lg:table-cell">
                {r.externalId ?? '—'}
              </Cell>
              <Cell row={r} field="cohort" className="hidden xl:table-cell">
                {r.cohort ?? '—'}
              </Cell>
              <TableCell>
                {r.errors.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {r.errors.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-footnote font-medium text-danger-text"
                      >
                        <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                        {e.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-start gap-1">
                    {r.action && (
                      <Badge size="sm" tone={OUTCOME[r.action].tone}>
                        {OUTCOME[r.action].label}
                      </Badge>
                    )}
                    {r.warnings.map((w, i) => (
                      <p
                        key={i}
                        className="flex items-start gap-1.5 text-footnote text-warning-text"
                      >
                        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Tally({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
}) {
  const color = {
    success: 'text-success-text',
    danger: 'text-danger-text',
    warning: 'text-warning-text',
    neutral: 'text-label',
  }[tone];
  return (
    <div className="flex min-w-[7rem] flex-col">
      <span
        className={cn(
          'text-title-2',
          value === 0 && tone !== 'neutral' ? 'text-label-tertiary' : color,
        )}
      >
        {formatCount(value)}
      </span>
      <span className="text-footnote text-label-secondary">{label}</span>
    </div>
  );
}

export function ImportPeopleView() {
  const { me, can } = useAuth();
  const words = peopleVocabulary(me?.organization?.type);
  const roles = useRoles();
  const run = useImportPeople();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<LocalFile | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const done = report?.committed ? report : null;

  // Leaving with unsaved one-time passwords loses them for good.
  useEffect(() => {
    if (!done || done.credentials.length === 0 || saved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [done, saved]);

  const check = async (local: LocalFile) => {
    setReport(null);
    try {
      const res = await run.mutateAsync({
        format: local.format,
        data: local.text,
        dryRun: true,
        filename: local.name,
      });
      setReport(res);
    } catch (err) {
      setFileError(isApiError(err) && err.fields.data ? err.message : errorMessage(err));
    }
  };

  const accept = async (f: File | undefined) => {
    setFileError(null);
    setReport(null);
    setSaved(false);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setFile(null);
      setFileError(
        `${f.name} is ${formatBytes(f.size)}. Import files up to ${formatBytes(MAX_BYTES)} (about 1,000 people) at a time.`,
      );
      return;
    }
    if (!/\.(csv|json|txt)$/i.test(f.name) && !/csv|json|text/.test(f.type)) {
      setFile(null);
      setFileError(
        'Choose a .csv or .json file. From Excel or Google Sheets, use File › Download › CSV.',
      );
      return;
    }
    const local = readLocal(f, await f.text());
    setFile(local);
    void check(local);
  };

  const commit = async () => {
    if (!file || !report) return;
    try {
      const res = await run.mutateAsync({
        format: file.format,
        data: file.text,
        dryRun: false,
        skipInvalid: report.summary.invalid > 0,
        filename: file.name,
      });
      setReport(res);
      toast.success(
        `Imported ${res.summary.create + res.summary.link + res.summary.update} people`,
      );
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
      // The data may have changed since the check (someone else added people): re-check.
      if (isApiError(err) && (err.status === 409 || err.code === 'IMPORT_HAS_ERRORS'))
        void check(file);
    }
  };

  const restart = () => {
    setFile(null);
    setReport(null);
    setFileError(null);
    setSaved(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void accept(e.dataTransfer.files[0]);
  };

  const mapped = useMemo(
    () => new Set(file?.mapping.filter((m) => m.column).map((m) => m.column)),
    [file],
  );

  if (!can('users.manage')) {
    return (
      <>
        <PageHeader
          title="Import people"
          breadcrumbs={[{ label: 'People', href: '/people' }, { label: 'Import' }]}
        />
        <EmptyState
          icon={<FileUp />}
          title="You can’t import people"
          description="Importing needs the “Create, edit, deactivate users” permission. Ask an organization admin."
        />
      </>
    );
  }

  const importable = report
    ? report.summary.create + report.summary.link + report.summary.update
    : 0;

  return (
    <>
      <PageHeader
        title="Import people"
        subtitle="Add a whole class or every competitor from one spreadsheet. Nothing is saved until you review the check and confirm."
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: 'Import' }]}
        actions={
          <Button asChild variant="gray">
            <a href={`${API_BASE}/org/people/import/template`} download>
              <Download aria-hidden /> Template
            </a>
          </Button>
        }
      />

      {done ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4 rounded-xl bg-surface p-5 sm:flex-row sm:items-center">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success-tint text-success-text">
              <CircleCheck aria-hidden className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-title-3 text-label">
                Imported {formatCount(importable)} {importable === 1 ? 'person' : 'people'}
                {done.filename ? ` from ${done.filename}` : ''}
              </h2>
              <p className="mt-0.5 text-callout text-label-secondary">
                {[
                  done.summary.create &&
                    `${formatCount(done.summary.create)} new ${done.summary.create === 1 ? 'account' : 'accounts'}`,
                  done.summary.link &&
                    `${formatCount(done.summary.link)} existing ${done.summary.link === 1 ? 'account' : 'accounts'} added`,
                  done.summary.update && `${formatCount(done.summary.update)} updated`,
                  done.summary.invalid &&
                    `${formatCount(done.summary.invalid)} skipped with problems`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="gray" onClick={restart}>
                Import another file
              </Button>
              <Button asChild variant="filled">
                <Link href="/people">Go to People</Link>
              </Button>
            </div>
          </div>
          {done.credentials.length > 0 ? (
            <Section
              title="Temporary passwords"
              description="Hand these out before you leave this page. Everyone sets their own password at first sign-in."
            >
              <CredentialsTable
                credentials={done.credentials}
                filename={`athena-passwords-${(done.filename ?? 'import').replace(/\.[a-z]+$/i, '')}.csv`}
                onSaved={() => setSaved(true)}
              />
            </Section>
          ) : (
            <div className="flex gap-3 rounded-xl bg-fill-secondary px-4 py-3">
              <UserRoundCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-label-secondary" />
              <p className="text-callout text-label-secondary">
                No new accounts were needed: everyone already had an Athena account and signs in
                with their own password.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'relative flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed px-6 text-center transition-colors duration-150',
              file ? 'py-6' : 'py-12',
              dragging ? 'border-accent bg-accent-tint' : 'border-separator-strong bg-surface',
            )}
          >
            {file ? (
              <div className="flex w-full flex-col gap-4 text-left sm:flex-row sm:items-center">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fill text-label-secondary">
                  <FileSpreadsheet aria-hidden className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline text-label">{file.name}</p>
                  <p className="text-footnote text-label-secondary">
                    {formatBytes(file.size)}, {file.format.toUpperCase()}, {formatCount(file.rows)}{' '}
                    {file.rows === 1 ? 'row' : 'rows'}
                  </p>
                  {file.mapping.length > 0 && (
                    <ul aria-label="Columns found" className="mt-2 flex flex-wrap gap-1.5">
                      {file.mapping.map((m) => (
                        <li key={m.header}>
                          <Badge
                            size="sm"
                            tone={m.column ? 'success' : 'neutral'}
                            title={m.column ? `Read as ${m.column}` : 'Ignored'}
                          >
                            {m.header}
                            {m.column && norm(m.header) !== m.column ? ` → ${m.column}` : ''}
                            {!m.column && ' (ignored)'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button variant="gray" size="sm" onClick={restart}>
                  <RotateCcw aria-hidden /> Choose another file
                </Button>
              </div>
            ) : (
              <>
                <span className="flex size-12 items-center justify-center rounded-full bg-fill-secondary text-label-tertiary">
                  <Upload aria-hidden className="size-6" />
                </span>
                <div>
                  <p className="text-headline text-label">Drop a CSV or JSON file here</p>
                  <p className="mt-0.5 text-callout text-label-secondary">
                    Up to 1,000 people per file. Exports from Excel and Google Sheets work as they
                    are.
                  </p>
                </div>
                <Button variant="filled" onClick={() => inputRef.current?.click()}>
                  Choose file
                </Button>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json"
              className="sr-only"
              aria-label="Choose a file to import"
              onChange={(e) => void accept(e.target.files?.[0])}
            />
          </div>

          {fileError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl bg-danger-tint px-4 py-3"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-text" />
              <p className="text-callout text-label">{fileError}</p>
            </div>
          )}

          {file && run.isPending && !report && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-xl bg-surface px-4 py-4 text-callout text-label-secondary"
            >
              <Spinner label={null} /> Checking {formatCount(file.rows)} rows against your
              organization…
            </div>
          )}

          {report && !report.committed && (
            <Section
              title="Check"
              description="Every row was validated against the people and roles already in your organization. Nothing has been saved yet."
            >
              <div className="flex flex-col gap-5 rounded-xl bg-surface p-5">
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  <Tally value={report.summary.valid} label="Ready to import" tone="success" />
                  <Tally value={report.summary.invalid} label="Need fixing" tone="danger" />
                  <Tally value={report.summary.warnings} label="With warnings" tone="warning" />
                  <div className="hidden w-px self-stretch bg-separator sm:block" />
                  <Tally value={report.summary.create} label="New accounts" tone="neutral" />
                  <Tally value={report.summary.link} label="Existing accounts" tone="neutral" />
                  <Tally
                    value={report.summary.update + report.summary.skip}
                    label="Already members"
                    tone="neutral"
                  />
                </div>
                {!mapped.has('role') && file?.format === 'csv' && (
                  <p className="text-footnote text-label-secondary">
                    No role column: everyone is imported as a Candidate.
                  </p>
                )}
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-callout text-label-secondary">
                    {importable === 0
                      ? 'Nothing to import: every row has a problem or is already up to date.'
                      : report.summary.invalid > 0
                        ? `${formatCount(report.summary.invalid)} ${report.summary.invalid === 1 ? 'row' : 'rows'} with problems will be skipped. Fix ${report.summary.invalid === 1 ? 'it' : 'them'} in the spreadsheet and import ${report.summary.invalid === 1 ? 'it' : 'them'} later.`
                        : 'All rows are valid. Importing runs as one transaction: either everyone is added, or no one is.'}
                  </p>
                  <Button
                    variant="filled"
                    disabled={importable === 0}
                    loading={run.isPending}
                    onClick={() => void commit()}
                  >
                    {report.summary.invalid > 0
                      ? `Import ${formatCount(importable)} valid ${importable === 1 ? 'row' : 'rows'}`
                      : `Import ${formatCount(importable)} ${importable === 1 ? 'person' : 'people'}`}
                  </Button>
                </div>
              </div>
              <ReportTable report={report} words={words} />
            </Section>
          )}

          {!file && (
            <Section
              title="Format"
              description="The first row names the columns. Only name and email are required; column names like “Roll No”, “Batch” or “Team” are recognised too."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>What goes in it</TableHead>
                    <TableHead className="hidden sm:table-cell">Example</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-footnote">name</TableCell>
                    <TableCell>Full name (required)</TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      Ayesha Khan
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-footnote">email</TableCell>
                    <TableCell>Their sign-in email (required, unique in the file)</TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      ayesha.khan@example.edu
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-footnote">role</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        A role key; blank means candidate.
                        {(roles.data ?? []).map((r) => (
                          <code
                            key={r.id}
                            className="rounded bg-fill px-1.5 py-0.5 text-footnote text-label"
                          >
                            {r.key}
                          </code>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      candidate
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-footnote">roll_number</TableCell>
                    <TableCell>{words.externalId}, unique in your organization</TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      FA26-BCS-001
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-footnote">cohort</TableCell>
                    <TableCell>{words.cohort}, for enrolling groups into exams</TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      BCS-1A
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Button asChild variant="plain" size="sm" className="self-start">
                <Link href="/people">Back to People</Link>
              </Button>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

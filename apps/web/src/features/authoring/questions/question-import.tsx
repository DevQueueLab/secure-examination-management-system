'use client';

import { CircleCheck, Download, FileWarning } from 'lucide-react';
import Link from 'next/link';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { API_BASE, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useImportQuestions } from '../api';
import { FileDrop, type DroppedFile } from '../components/file-drop';
import { DifficultyPill, TypePill } from '../components/pills';
import { RowErrorsTable } from '../components/row-errors';
import { formatMarks, plural, stemExcerpt } from '../lib/format';
import type { QuestionImportResult } from '../types';

const REQUIRED = ['type', 'title', 'stem'];
/** JSON items use the editor's own shape, with the answer key nested. */
const REQUIRED_JSON = ['type', 'title', 'content', 'key'];
const KNOWN = [
  'type',
  'category',
  'difficulty',
  'title',
  'stem',
  'options',
  'correct',
  'marks',
  'tags',
  'explanation',
];

const FORMAT_HELP: { type: string; options: string; correct: string }[] = [
  { type: 'single_choice', options: 'Stack|Queue|Heap', correct: 'B (letter or option text)' },
  { type: 'multiple_choice', options: 'A|B|C|D', correct: '"A,C"' },
  { type: 'true_false', options: '(empty)', correct: 'true or false' },
  { type: 'numeric', options: '(empty)', correct: '19.6 ± 0.1 or 120 ± 2%' },
  { type: 'short_text', options: '(empty)', correct: 'DISTINCT|SELECT DISTINCT' },
  {
    type: 'fill_blanks',
    options: '(stem holds [[b1]], [[b2]])',
    correct: 'answer1|answer2, alternatives with /',
  },
  { type: 'matching', options: 'Force=Newton|=Pascal (distractor)', correct: '(empty)' },
  { type: 'ordering', options: 'Items in the correct order, | between', correct: '(empty)' },
  { type: 'long_text / code', options: '(empty)', correct: 'Model answer (optional)' },
];

interface ClientPreview {
  rows: number;
  columns: string[];
  missing: string[];
  unknown: string[];
  sample: Record<string, string>[];
  parseError?: string;
}

/** Reads the file in the browser first, so a wrong file is caught before the server sees it. */
function parseLocally(file: DroppedFile): ClientPreview {
  if (file.format === 'json') {
    try {
      const data = JSON.parse(file.text) as unknown;
      const items =
        (Array.isArray(data) ? data : (data as { questions?: unknown[] })?.questions) ?? null;
      if (!Array.isArray(items))
        return {
          rows: 0,
          columns: [],
          missing: [],
          unknown: [],
          sample: [],
          parseError: 'Expected an array of questions, or { "questions": [...] }.',
        };
      const columns = [
        ...new Set(
          items.flatMap((i) => (i && typeof i === 'object' ? Object.keys(i as object) : [])),
        ),
      ];
      return {
        rows: items.length,
        columns,
        missing: REQUIRED_JSON.filter((r) => !columns.includes(r)),
        unknown: [],
        sample: items
          .slice(0, 5)
          .map((i) =>
            Object.fromEntries(
              Object.entries(i as object).map(([k, v]) => [
                k,
                typeof v === 'string' ? v : JSON.stringify(v),
              ]),
            ),
          ),
      };
    } catch (e) {
      return {
        rows: 0,
        columns: [],
        missing: [],
        unknown: [],
        sample: [],
        parseError: `This isn’t valid JSON: ${(e as Error).message}`,
      };
    }
  }
  const parsed = Papa.parse<Record<string, string>>(file.text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });
  const columns = parsed.meta.fields ?? [];
  return {
    rows: parsed.data.length,
    columns,
    missing: REQUIRED.filter((r) => !columns.includes(r)),
    unknown: columns.filter((c) => !KNOWN.includes(c)),
    sample: parsed.data.slice(0, 5),
    parseError: parsed.errors.find((e) => e.type === 'Delimiter' || e.type === 'Quotes')?.message,
  };
}

export function QuestionImport() {
  const run = useImportQuestions();
  const [file, setFile] = useState<DroppedFile | null>(null);
  const [report, setReport] = useState<QuestionImportResult | null>(null);
  const [done, setDone] = useState<QuestionImportResult | null>(null);
  const local = useMemo(() => (file ? parseLocally(file) : null), [file]);
  const blocked = !!local && (!!local.parseError || local.missing.length > 0 || local.rows === 0);

  const pick = (f: DroppedFile) => {
    setFile(f);
    setReport(null);
    setDone(null);
    const preview = parseLocally(f);
    if (preview.parseError || preview.missing.length || preview.rows === 0) return;
    run.mutate(
      { format: f.format, data: f.text, dryRun: true, filename: f.name },
      { onSuccess: setReport, onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const commit = () =>
    file &&
    run.mutate(
      { format: file.format, data: file.text, dryRun: false, filename: file.name },
      {
        onSuccess: (r) => {
          setDone(r);
          toast.success(`${plural(r.imported, 'question')} imported`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const reset = () => {
    setFile(null);
    setReport(null);
    setDone(null);
  };

  if (done) {
    return (
      <>
        <PageHeader
          title="Import questions"
          breadcrumbs={[{ label: 'Question bank', href: '/questions' }, { label: 'Import' }]}
        />
        <section className="flex max-w-2xl flex-col gap-4" aria-labelledby="done-title">
          <h2 id="done-title" className="flex items-center gap-2 text-title-2 text-label">
            <CircleCheck aria-hidden className="size-6 shrink-0 text-success-text" />
            {plural(done.imported, 'question')} added to the bank
          </h2>
          <ul className="flex flex-col gap-1 text-callout text-label-secondary">
            <li>Each one starts at version 1 and is ready to add to an exam.</li>
            {done.newCategories.length > 0 && (
              <li>
                New {done.newCategories.length === 1 ? 'category' : 'categories'}:{' '}
                {done.newCategories.join(', ')}
              </li>
            )}
            {done.invalid > 0 && (
              <li>
                {plural(done.invalid, 'row')} with problems {done.invalid === 1 ? 'was' : 'were'}{' '}
                skipped. Fix {done.invalid === 1 ? 'it' : 'them'} in the file and import again.
              </li>
            )}
          </ul>
          <div className="flex gap-2">
            <Button asChild variant="filled">
              <Link href="/questions">Open the bank</Link>
            </Button>
            <Button variant="gray" onClick={reset}>
              Import another file
            </Button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Import questions"
        subtitle="Add many questions at once from a CSV or JSON file. Nothing is saved until you review the check and confirm."
        breadcrumbs={[{ label: 'Question bank', href: '/questions' }, { label: 'Import' }]}
        actions={
          <>
            <Button asChild variant="gray">
              <a href={`${API_BASE}/questions/import/template?format=csv`} download>
                <Download aria-hidden /> CSV template
              </a>
            </Button>
            <Button asChild variant="gray">
              <a href={`${API_BASE}/questions/import/template?format=json`} download>
                <Download aria-hidden /> JSON template
              </a>
            </Button>
          </>
        }
      />

      {/* Beside the drop zone before a file is chosen; below the results after, so the table gets the full width. */}
      <div className={cn('grid gap-8', !file && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="flex min-w-0 flex-col gap-6">
          <FileDrop
            file={file}
            onFile={pick}
            onClear={reset}
            hint="CSV or JSON, up to 500 questions and 2 MB"
          />

          {local && (local.parseError || local.missing.length > 0 || local.rows === 0) && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl bg-danger-tint px-4 py-3 text-callout text-danger-text"
            >
              <FileWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">This file can’t be imported yet.</p>
                {local.parseError && <p>{local.parseError}</p>}
                {local.rows === 0 && !local.parseError && <p>The file has no rows.</p>}
                {local.missing.length > 0 && (
                  <p>
                    Missing required{' '}
                    {file?.format === 'json'
                      ? local.missing.length === 1
                        ? 'field'
                        : 'fields'
                      : local.missing.length === 1
                        ? 'column'
                        : 'columns'}
                    : {local.missing.join(', ')}. Start from the template to get the shape right.
                  </p>
                )}
              </div>
            </div>
          )}
          {local && blocked && local.sample.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="How the file was read">
              <h2 className="text-headline text-label">How the file was read</h2>
              <SampleTable preview={local} />
            </section>
          )}

          {local && !blocked && (
            <section className="flex flex-col gap-2" aria-labelledby="read-title">
              <h2 id="read-title" className="text-headline text-label">
                Read {plural(local.rows, file?.format === 'json' ? 'question' : 'row')}
              </h2>
              <p className="text-footnote text-label-secondary">
                {file?.format === 'json' ? 'Fields' : 'Columns'}: {local.columns.join(', ')}
              </p>
              {local.unknown.length > 0 && (
                <p className="text-footnote text-warning-text">
                  Not used, so ignored: {local.unknown.join(', ')}
                </p>
              )}
              {local.sample.length > 0 && (
                <details className="group">
                  <summary className="w-fit cursor-pointer text-footnote font-medium text-accent-text hover:underline">
                    Show the first rows as read
                  </summary>
                  <div className="mt-2">
                    <SampleTable preview={local} />
                  </div>
                </details>
              )}
            </section>
          )}

          {run.isPending && !report && !blocked && (
            <p className="text-callout text-label-secondary">
              Checking every row against the bank…
            </p>
          )}

          {report && (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator sm:grid-cols-4">
                {[
                  { label: 'Rows', value: report.total },
                  { label: 'Ready to import', value: report.valid, good: report.valid > 0 },
                  { label: 'With problems', value: report.invalid, bad: report.invalid > 0 },
                  { label: 'New categories', value: report.newCategories.length },
                ].map((s) => (
                  <div key={s.label} className="flex flex-col gap-0.5 bg-surface px-4 py-3">
                    <dt className="text-footnote text-label-secondary">{s.label}</dt>
                    <dd
                      className={cn(
                        'text-title-3 tabular-nums',
                        s.bad ? 'text-danger-text' : 'text-label',
                      )}
                    >
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {report.errors.length > 0 && (
                <section className="flex flex-col gap-2" aria-labelledby="errors-title">
                  <div className="flex flex-col gap-0.5">
                    <h2 id="errors-title" className="text-headline text-label">
                      Rows with problems
                    </h2>
                    <p className="text-footnote text-label-secondary">
                      Fix them in the file and drop it again, or import only the rows that are
                      ready. Rows are numbered as in your spreadsheet (the header is row 1).
                    </p>
                  </div>
                  <RowErrorsTable
                    errors={report.errors}
                    rowLabel={report.format === 'csv' ? 'Row' : 'Item'}
                  />
                </section>
              )}

              {report.preview.length > 0 && (
                <section className="flex flex-col gap-2" aria-labelledby="ready-title">
                  <h2 id="ready-title" className="text-headline text-label">
                    Ready to import
                  </h2>
                  <Table containerClassName="max-h-[28rem] overflow-y-auto rounded-xl bg-surface shadow-xs">
                    <TableHeader className="sticky top-0 z-10 bg-surface">
                      <TableRow>
                        <TableHead numeric className="w-14">
                          {report.format === 'csv' ? 'Row' : 'Item'}
                        </TableHead>
                        <TableHead>Question</TableHead>
                        <TableHead className="w-24">Type</TableHead>
                        <TableHead className="hidden w-24 md:table-cell">Difficulty</TableHead>
                        <TableHead className="hidden w-40 lg:table-cell">Category</TableHead>
                        <TableHead numeric className="w-16">
                          Marks
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.preview.map((p) => (
                        <TableRow key={p.row}>
                          <TableCell numeric className="text-label-tertiary">
                            {p.row}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate text-callout font-medium text-label">
                                {p.title}
                              </span>
                              <span className="truncate text-footnote text-label-secondary">
                                {stemExcerpt(p.stem, 120)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <TypePill type={p.type} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <DifficultyPill difficulty={p.difficulty} />
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {p.category ? (
                              <span className="flex items-center gap-1.5 text-callout text-label-secondary">
                                <span className="truncate">{p.category}</span>
                                {p.categoryIsNew && (
                                  <Badge size="sm" tone="accent">
                                    New
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <span className="text-label-tertiary">None</span>
                            )}
                          </TableCell>
                          <TableCell numeric>{formatMarks(p.marks)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-separator pt-5">
                {report.invalid > 0 && report.valid > 0 && (
                  <p className="mr-auto text-footnote text-label-secondary">
                    {plural(report.invalid, 'row')} with problems will be skipped.
                  </p>
                )}
                <Button variant="gray" onClick={reset}>
                  Start over
                </Button>
                <Button
                  variant="filled"
                  disabled={report.valid === 0}
                  loading={run.isPending}
                  onClick={commit}
                >
                  {report.valid
                    ? `Import ${plural(report.valid, 'question')}`
                    : 'Nothing to import'}
                </Button>
              </div>
            </>
          )}
        </div>

        <aside className={cn('flex flex-col gap-3', file && 'max-w-2xl border-t border-separator pt-6')}>
            <h2 className="text-headline text-label">How to write each type</h2>
            <p className="text-footnote text-label-secondary">
              Columns: <span className="font-mono">{KNOWN.join(', ')}</span>. Only type, title and
              stem are required. Separate tags with semicolons.
            </p>
            <dl className="flex flex-col rounded-xl bg-surface shadow-xs">
              {FORMAT_HELP.map((f, i) => (
                <div
                  key={f.type}
                  className={cn(
                    'flex flex-col gap-1 px-4 py-3',
                    i > 0 && 'border-t border-separator',
                  )}
                >
                  <dt className="font-mono text-footnote font-medium text-label">{f.type}</dt>
                  <dd className="text-footnote text-label-secondary">
                    options: <span className="text-label">{f.options}</span>
                    <br />
                    correct: <span className="text-label">{f.correct}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-footnote text-label-secondary">
              JSON files use the editor’s own shape: type, title, content and key for each question.
              The JSON template has a worked example of each, including a numeric question with
              variables.
            </p>
            <p className="text-footnote text-label-secondary">
              Duplicates of questions already in the bank (same type, title and text) are flagged,
              not imported twice.
            </p>
        </aside>
      </div>
    </>
  );
}

/** The first rows exactly as the browser parsed them, before the server sees the file. */
function SampleTable({ preview }: { preview: ClientPreview }) {
  const columns = preview.columns.slice(0, 6);
  return (
    <Table containerClassName="rounded-xl bg-surface shadow-xs">
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c} className="font-mono">
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.sample.map((row, i) => (
          <TableRow key={i}>
            {columns.map((c) => (
              <TableCell key={c} className="max-w-48 truncate text-footnote" title={row[c] ?? ''}>
                {row[c] || <span className="text-label-tertiary">empty</span>}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

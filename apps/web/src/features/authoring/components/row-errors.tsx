'use client';

import { CircleAlert } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ImportRowError } from '../types';

/** Row-level import problems: which line, which column, what to change. Grouped by row so one bad line reads as one item. */
export function RowErrorsTable({ errors, rowLabel = 'Row', maxHeight = 'max-h-80' }: { errors: ImportRowError[]; rowLabel?: string; maxHeight?: string }) {
  return (
    <Table containerClassName={`${maxHeight} overflow-y-auto`}>
      <TableHeader className="sticky top-0 z-10 bg-surface">
        <TableRow>
          <TableHead numeric className="w-16">
            {rowLabel}
          </TableHead>
          <TableHead className="w-36">Field</TableHead>
          <TableHead>Problem</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {errors.map((e, i) => {
          const first = i === 0 || errors[i - 1]!.row !== e.row;
          return (
            <TableRow key={`${e.row}-${e.field}-${i}`}>
              <TableCell numeric className="align-top font-medium">
                {first ? e.row : ''}
              </TableCell>
              <TableCell className="align-top">
                <code className="rounded bg-fill px-1.5 py-0.5 text-footnote text-label-secondary">{e.field}</code>
              </TableCell>
              <TableCell className="align-top">
                <span className="flex items-start gap-2 text-callout text-label">
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger-text" />
                  {e.message}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

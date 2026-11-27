'use client';

import { Check, Copy, Download, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';
import { downloadText, toCsv } from '../format';
import type { Credential } from '../types';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error('Couldn’t copy to the clipboard. Select the text and copy it manually.');
    return false;
  }
}

function CopyButton({
  text,
  label,
  onCopied,
  size = 'icon-sm',
}: {
  text: string;
  label: string;
  onCopied?: () => void;
  size?: 'icon-sm' | 'sm';
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={size === 'sm' ? 'tinted' : 'ghost'}
      size={size}
      aria-label={size === 'sm' ? undefined : label}
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {size === 'sm' && (done ? 'Copied' : label)}
    </Button>
  );
}

/** Notice that the secret below cannot be shown again. */
export function ShownOnceNote({ className, many = false }: { className?: string; many?: boolean }) {
  return (
    <p className={cn('flex items-start gap-2 text-footnote text-label-secondary', className)}>
      <LockKeyhole aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span>
        {many ? 'These passwords are' : 'This password is'} shown only once. Athena stores{' '}
        {many ? 'them' : 'it'} hashed and can’t display {many ? 'them' : 'it'} again. Share{' '}
        {many ? 'each one' : 'it'} privately; Athena asks for a new password at first sign-in.
      </span>
    </p>
  );
}

/**
 * One person's sign-in details, shown once after an account is created or a password is reset.
 * `onCopied` lets the caller know the secret left the screen safely.
 */
export function CredentialCard({
  credential,
  onCopied,
  className,
}: {
  credential: Credential;
  onCopied?: () => void;
  className?: string;
}) {
  const both = `Athena sign-in\nEmail: ${credential.email}\nTemporary password: ${credential.temporaryPassword}`;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <dl className="overflow-hidden rounded-xl bg-surface-sunken">
        <div className="flex items-center gap-3 px-4 py-3">
          <dt className="w-20 shrink-0 text-footnote font-medium text-label-secondary">Email</dt>
          <dd className="min-w-0 flex-1 truncate text-callout text-label">{credential.email}</dd>
          <CopyButton text={credential.email} label="Copy email" />
        </div>
        <div className="flex items-center gap-3 border-t border-separator px-4 py-3">
          <dt className="w-20 shrink-0 text-footnote font-medium text-label-secondary">Password</dt>
          <dd className="min-w-0 flex-1 select-all font-mono text-body tracking-[0.04em] text-label">
            {credential.temporaryPassword}
          </dd>
          <CopyButton
            text={credential.temporaryPassword}
            label="Copy password"
            onCopied={onCopied}
          />
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShownOnceNote className="max-w-sm" />
        <CopyButton text={both} label="Copy both" size="sm" onCopied={onCopied} />
      </div>
    </div>
  );
}

/** Many sign-in details at once (bulk import), with copy-all and a CSV download. */
export function CredentialsTable({
  credentials,
  filename = 'athena-temporary-passwords.csv',
  onSaved,
}: {
  credentials: Credential[];
  filename?: string;
  onSaved?: () => void;
}) {
  const csv = () =>
    toCsv([
      ['name', 'email', 'temporary_password'],
      ...credentials.map((c) => [c.name, c.email, c.temporaryPassword]),
    ]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ShownOnceNote many className="max-w-xl" />
        <div className="flex gap-2">
          <CopyButton
            text={credentials
              .map((c) => `${c.name}\t${c.email}\t${c.temporaryPassword}`)
              .join('\n')}
            label="Copy all"
            size="sm"
            onCopied={onSaved}
          />
          <Button
            variant="filled"
            size="sm"
            onClick={() => {
              downloadText(filename, csv());
              onSaved?.();
            }}
          >
            <Download aria-hidden /> Download CSV
          </Button>
        </div>
      </div>
      <Table containerClassName="max-h-[28rem] overflow-y-auto">
        <TableHeader className="sticky top-0 z-10 bg-surface">
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Temporary password</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Copy</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credentials.map((c) => (
            <TableRow key={c.email}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-label-secondary">{c.email}</TableCell>
              <TableCell className="select-all font-mono tracking-[0.04em]">
                {c.temporaryPassword}
              </TableCell>
              <TableCell className="py-1.5">
                <CopyButton text={c.temporaryPassword} label={`Copy ${c.name}’s password`} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

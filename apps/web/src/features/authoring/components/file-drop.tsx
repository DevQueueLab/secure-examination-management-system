'use client';

import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';
import { importFormatOf, readFileText } from '../lib/format';

export interface DroppedFile {
  name: string;
  size: number;
  format: 'csv' | 'json';
  text: string;
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Drag-and-drop (or browse) for one CSV or JSON file. Reads it in the browser; nothing uploads until the caller says so. */
export function FileDrop({
  file,
  onFile,
  onClear,
  hint = 'CSV or JSON, up to 2 MB',
  className,
}: {
  file: DroppedFile | null;
  onFile: (file: DroppedFile) => void;
  onClear: () => void;
  hint?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const accept = async (f: File | undefined) => {
    if (!f) return;
    const format = importFormatOf(f);
    if (!format) {
      toast.error('Choose a .csv or .json file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('That file is larger than 2 MB. Split it into smaller files.');
      return;
    }
    try {
      const text = await readFileText(f);
      onFile({ name: f.name, size: f.size, format, text });
    } catch {
      toast.error('Couldn’t read that file.');
    }
  };

  if (file) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl bg-surface px-4 py-3 shadow-xs', className)}>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text">
          <FileSpreadsheet aria-hidden className="size-4.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-callout font-medium text-label">{file.name}</span>
          <span className="flex gap-2 text-footnote text-label-secondary">
            <span>{file.format.toUpperCase()}</span>
            <span>{(file.size / 1024).toFixed(file.size < 10_240 ? 1 : 0)} KB</span>
          </span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={onClear}>
          <X aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void accept(e.dataTransfer.files[0]);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-150',
        over ? 'border-accent bg-accent-tint' : 'border-separator-strong bg-surface',
        className,
      )}
    >
      <span className={cn('inline-flex size-11 items-center justify-center rounded-full', over ? 'bg-accent text-on-accent' : 'bg-fill text-label-secondary')}>
        <Upload aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-headline text-label">{over ? 'Drop to read the file' : 'Drag a file here'}</p>
        <p className="text-footnote text-label-secondary">{hint}</p>
      </div>
      <Button variant="tinted" size="sm" onClick={() => input.current?.click()}>
        Choose file
      </Button>
      <input
        ref={input}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

'use client';

import { ChevronDown, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The framing that sits above every integrity view. It stays put (not dismissible): reviewers should read
 * every flag through it.
 */
export function PrivacyNote({ priorityRule, className }: { priorityRule?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('max-w-4xl', className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-tint text-success-text">
          <ShieldCheck className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-callout font-medium text-label">Indicators are context for a person to review, never evidence and never an automatic penalty.</p>
          <p className="mt-0.5 text-subheadline text-label-secondary">
            Athena uses no camera, microphone or screen capture. It only knows how answers were entered and how the exam tab was used. Every
            flag lists its reasons and an innocent explanation to rule out first; decisions belong to your academic-integrity process.
          </p>
          {priorityRule && (
            <>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 rounded-md text-subheadline font-medium text-accent-text hover:underline"
              >
                How the review order is decided
                <ChevronDown aria-hidden className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} />
              </button>
              {open && <p className="mt-1.5 max-w-3xl text-subheadline text-label-secondary">{priorityRule} There is no overall score: only the reasons.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

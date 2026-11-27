'use client';

import { ERROR_CODES } from '@athena/shared';
import { CircleAlert, Send } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetFooter } from '@/components/ui/sheet';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePreferences } from '../lib/preferences';
import { useEngine, useEngineSelector } from '../lib/use-engine';
import { usePaper, type ItemState } from './navigator';

function JumpList({ label, entries, onJump, tone, disabled }: { label: string; entries: ItemState[]; onJump: (index: number) => void; tone: string; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-2 py-3.5 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-callout font-semibold text-label">{label}</h3>
        <span className="text-title-3 tabular-nums text-label" data-numeric>
          {entries.length}
        </span>
      </div>
      {entries.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {entries.map((e) => (
            <li key={e.item.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onJump(e.index)}
                className={cn(
                  'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-subheadline font-semibold tabular-nums transition-colors max-md:h-11 max-md:min-w-11',
                  'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default',
                  tone,
                )}
                aria-label={disabled ? `Question ${e.index + 1}` : `Go to question ${e.index + 1}`}
              >
                {e.index + 1}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Review before submitting: what's answered, what isn't, what's flagged, then a deliberate submit. */
export function ReviewSheet({ open, onOpenChange, onJump }: { open: boolean; onOpenChange: (open: boolean) => void; onJump: (index: number) => void }) {
  const engine = useEngine();
  const { prefs } = usePreferences();
  const paper = usePaper();
  const linear = useEngineSelector((s) => s.view?.settings.navigation === 'linear');
  const submitting = useEngineSelector((s) => s.submitting);
  const phase = useEngineSelector((s) => s.phase);
  const offline = useEngineSelector((s) => s.sync.state === 'offline' || !s.sync.online);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unanswered = paper.all.filter((e) => e.completion === 'none');
  const partial = paper.all.filter((e) => e.completion === 'partial');
  const answered = paper.all.filter((e) => e.completion === 'complete');
  const flagged = paper.all.filter((e) => e.flagged);
  const needsConfirm = prefs.confirmBeforeSubmit;
  const canSubmit = phase === 'ready' && !submitting && (!needsConfirm || confirmed);

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    try {
      await engine.submit();
      // The receipt screen replaces the workspace; nothing else to do here.
    } catch (err) {
      if (isApiError(err) && err.code === ERROR_CODES.ATTEMPT_CLOSED) return;
      const message = errorMessage(err, 'Your exam couldn’t be submitted. Your answers are safe; try again.');
      setError(
        offline
          ? 'You’re offline, so your exam can’t be submitted yet. Your answers are safe on this device; submit again when you reconnect.'
          : message,
      );
    }
  }

  const jump = (index: number) => {
    onOpenChange(false);
    onJump(index);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirmed(false);
          setError(null);
        }
        onOpenChange(next);
      }}
      dismissible={!submitting}
    >
      <SheetContent
        title="Review and submit"
        description={`${paper.answered} of ${paper.total} answered${paper.flagged ? `, ${paper.flagged} flagged` : ''}`}
      >
        <div className="flex flex-col divide-y">
          <JumpList label="Unanswered" entries={unanswered} onJump={jump} disabled={linear} tone="bg-fill text-label hover:bg-fill-strong" />
          {partial.length > 0 && (
            <JumpList label="Partly answered" entries={partial} onJump={jump} disabled={linear} tone="bg-accent-tint text-accent-text hover:bg-accent/15" />
          )}
          <JumpList label="Flagged for review" entries={flagged} onJump={jump} disabled={linear} tone="bg-warning-tint text-warning-text hover:brightness-95" />
          <JumpList label="Answered" entries={answered} onJump={jump} disabled={linear} tone="bg-accent text-on-accent hover:bg-accent-hover" />
        </div>
        {linear && <p className="mt-2 text-footnote text-label-secondary">This exam moves forward only, so earlier questions can’t be reopened.</p>}

        <SheetFooter className="flex-col items-stretch">
          {unanswered.length > 0 && (
            <p className="text-callout text-label-secondary" data-numeric>
              {unanswered.length === 1 ? '1 question is' : `${unanswered.length} questions are`} still unanswered.
            </p>
          )}
          {needsConfirm && (
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              disabled={submitting || phase !== 'ready'}
              label="I’m ready to submit. I can’t change my answers afterwards."
            />
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 text-callout text-danger-text">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="gray" size="lg" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button variant="filled" size="lg" className="flex-1" onClick={() => void submit()} loading={submitting} disabled={!canSubmit}>
              <Send aria-hidden />
              Submit exam
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

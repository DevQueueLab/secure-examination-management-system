'use client';

import { Megaphone } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAnnouncements, useSendAnnouncement } from '../api';
import { useServerNow } from '../clock';
import { ago, clockTime } from '../format';
import type { StaffAnnouncement } from '../types';

const MAX = 1000;
const EVERYONE = 'everyone';

const TEMPLATES: { label: string; body: string; priority?: 'urgent' }[] = [
  {
    label: 'Typo in a question',
    body: 'Correction: in the question about [topic], “[as printed]” should read “[corrected]”. Please answer using the corrected version.',
  },
  { label: '10 minutes remaining', body: 'About 10 minutes remain. Review any flagged questions now. Your timer shows your exact time left.' },
  {
    label: 'Technical issue',
    body: 'We know about a technical issue and are working on it. Your answers are saved, even if you go offline. Keep working: anyone affected will get the time back.',
    priority: 'urgent',
  },
  { label: 'Issue resolved', body: 'The technical issue is fixed. If it affected you, your time has been extended. Thank you for your patience.' },
];

export interface ComposerCandidate {
  userId: string;
  name: string;
  rollNumber: string | null;
}

/** Writes an announcement to everyone or one candidate. Ctrl/⌘ + Enter sends. */
export function AnnouncementComposer({
  examId,
  candidates = [],
  fixedTarget,
  onSent,
  autoFocus,
}: {
  examId: string;
  candidates?: ComposerCandidate[];
  fixedTarget?: { userId: string; name: string };
  onSent?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [target, setTarget] = useState<string>(EVERYONE);
  const [error, setError] = useState<string | null>(null);
  const send = useSendAnnouncement(examId);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  const targetUserId = fixedTarget?.userId ?? (target === EVERYONE ? null : target);
  const targetName = fixedTarget?.name ?? candidates.find((c) => c.userId === target)?.name ?? null;

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setBody(t.body);
    if (t.priority) setPriority(t.priority);
    setError(null);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      // Select the first [placeholder] so it can be typed over.
      const start = t.body.indexOf('[');
      if (start >= 0) el.setSelectionRange(start, t.body.indexOf(']', start) + 1);
    });
  };

  const submit = async () => {
    const text = body.trim();
    if (!text) {
      setError('Write a message first');
      return;
    }
    if (/\[[^\]]+\]/.test(text)) {
      setError('Replace the parts in [brackets] before sending');
      return;
    }
    try {
      await send.mutateAsync({ body: text, priority, targetUserId });
      toast.success(targetName ? `Sent to ${targetName}` : 'Sent to every candidate');
      setBody('');
      setPriority('normal');
      setError(null);
      onSent?.();
    } catch (err) {
      setError(isApiError(err) ? (err.fields.body ?? err.fields.targetUserId ?? errorMessage(err)) : errorMessage(err));
    }
  };

  return (
    <form
      id={formId}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-1.5" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => applyTemplate(t)}
            className="h-7 rounded-full bg-fill px-3 text-subheadline text-label-secondary transition-colors hover:bg-fill-strong hover:text-label"
          >
            {t.label}
          </button>
        ))}
      </div>
      <Field
        label="Message"
        error={error ?? undefined}
        hint="Papers are shuffled, so name a question by its topic, not its number."
        labelAccessory={
          <span className={cn('text-footnote tabular-nums', body.length > MAX - 50 ? 'text-warning-text' : 'text-label-secondary')}>
            {body.length}/{MAX}
          </span>
        }
      >
        <Textarea
          ref={textRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={MAX}
          rows={3}
          placeholder={fixedTarget ? `Write to ${fixedTarget.name}…` : 'Write to candidates…'}
          autoFocus={autoFocus}
        />
      </Field>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-subheadline font-medium text-label" id={`${formId}-priority`}>
            Priority
          </span>
          <SegmentedControl
            aria-label="Priority"
            value={priority}
            onValueChange={setPriority}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
        </div>
        {!fixedTarget && (
          <Field label="Send to" className="min-w-48 flex-1">
            <Select
              value={target}
              onValueChange={setTarget}
              options={[
                { value: EVERYONE, label: 'All candidates' },
                ...candidates.map((c) => ({ value: c.userId, label: c.name, description: c.rollNumber ?? undefined })),
              ]}
            />
          </Field>
        )}
      </div>
      <Button variant="filled" type="submit" loading={send.isPending} className="self-end">
        <Megaphone aria-hidden />
        {targetName ? `Send to ${targetName.split(' ')[0]}` : 'Send to everyone'}
      </Button>
    </form>
  );
}

function Receipt({ a }: { a: StaffAnnouncement }) {
  if (a.recipientCount === 0) return <span className="text-footnote text-label-secondary">Shown to candidates as they start</span>;
  const all = a.readCount >= a.recipientCount;
  return (
    <span className="flex items-center gap-2">
      <ProgressBar
        className="w-16"
        size="sm"
        value={a.readCount}
        max={a.recipientCount}
        tone={all ? 'success' : 'neutral'}
        label="Read receipts"
        valueText={`${a.readCount} of ${a.recipientCount} read`}
      />
      <span className={cn('text-footnote font-medium tabular-nums', all ? 'text-success-text' : 'text-label-secondary')}>
        {a.readCount}/{a.recipientCount} read
      </span>
    </span>
  );
}

export function AnnouncementsPanel({ examId, candidates, canSend }: { examId: string; candidates: ComposerCandidate[]; canSend: boolean }) {
  const history = useAnnouncements(examId);
  const now = useServerNow();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {canSend && (
        <section aria-labelledby="compose-heading" className="flex flex-col gap-3 self-start rounded-xl bg-surface p-5">
          <div>
            <h3 id="compose-heading" className="text-headline text-label">
              New announcement
            </h3>
            <p className="text-subheadline text-label-secondary">Appears in every candidate’s workspace within a second.</p>
          </div>
          <AnnouncementComposer examId={examId} candidates={candidates} />
        </section>
      )}
      <section aria-labelledby="history-heading" className={cn('flex flex-col gap-3', !canSend && 'lg:col-span-2')}>
        <h3 id="history-heading" className="px-1 text-headline text-label">
          Sent
        </h3>
        {history.isPending ? (
          <SkeletonRows rows={3} />
        ) : history.isLoadingError ? (
          <EmptyState size="sm" title="Couldn’t load announcements" description={errorMessage(history.error)} action={<Button onClick={() => history.refetch()}>Try again</Button>} />
        ) : !history.data?.length ? (
          <EmptyState size="sm" icon={<Megaphone />} title="Nothing sent yet" description="Announcements you send are listed here with read receipts." />
        ) : (
          <ol className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface">
            {history.data.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3.5">
                <p className="whitespace-pre-wrap text-callout text-label">{a.body}</p>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary">
                    {a.priority === 'urgent' && (
                      <Badge tone="danger" size="sm">
                        Urgent
                      </Badge>
                    )}
                    <span>{a.target ? `To ${a.target.name}` : 'To everyone'}</span>
                    <time dateTime={a.createdAt} title={clockTime(a.createdAt, true)}>
                      {ago(a.createdAt, now)}
                    </time>
                    {a.author && <span>{a.author.name}</span>}
                  </span>
                  <Receipt a={a} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

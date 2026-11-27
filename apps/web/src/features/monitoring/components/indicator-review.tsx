'use client';

import { CircleAlert, CircleCheck, Flag, NotebookPen } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { useReviewIndicator } from '../api';
import { REVIEW_LABEL, REVIEW_TONE, SEVERITY_LABEL, SEVERITY_TONE, clockTime, eventDetail, eventLabel } from '../format';
import type { MonitorEvent, ReviewOutcome } from '../types';
import { ARRIVE, ARRIVE_FROM } from './arrive';

/** Equal weight on purpose: no outcome is presented as the expected one. Colour appears only once one is chosen. */
const OUTCOMES: { status: ReviewOutcome; label: string; icon: ReactNode }[] = [
  { status: 'no_concern', label: 'No concern', icon: <CircleCheck aria-hidden /> },
  { status: 'follow_up', label: 'Follow up', icon: <Flag aria-hidden /> },
  { status: 'escalated', label: 'Escalate', icon: <CircleAlert aria-hidden /> },
];

/**
 * One integrity indicator with its review. Choosing an outcome saves at once (with the note, if one was written);
 * a reviewed indicator shows who decided what and can be changed.
 */
export function IndicatorRow({ examId, event, canReview, id }: { examId: string; event: MonitorEvent; canReview: boolean; id?: string }) {
  const review = event.review;
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(review?.note ?? '');
  const [pending, setPending] = useState<ReviewOutcome | null>(null);
  const mutate = useReviewIndicator(examId);
  const reduced = useReducedMotion();
  const reviewed = !!review && review.status !== 'open';
  const label = eventLabel(event.type);
  const detail = eventDetail(event);

  const decide = async (status: ReviewOutcome) => {
    setPending(status);
    try {
      await mutate.mutateAsync({ eventId: event.id, status, note: note.trim() });
      setEditing(false);
      setNoteOpen(false);
    } catch (err) {
      toast.error('Couldn’t save the review', { description: errorMessage(err) });
    } finally {
      setPending(null);
    }
  };

  return (
    <motion.li
      id={id}
      // A new indicator lands: it drops in 12 px from above and settles, while the ones below make room.
      layout={reduced ? false : 'position'}
      initial={reduced ? false : ARRIVE_FROM}
      animate={{ opacity: 1, y: 0 }}
      transition={ARRIVE}
      className="flex scroll-mt-24 flex-col gap-2 py-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[7px]">
          <StatusDot tone={SEVERITY_TONE[event.severity]} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-callout text-label">
            <span>{label}</span>
            {detail && <span className="text-subheadline text-label-secondary">{detail}</span>}
          </p>
          <p className="flex flex-wrap gap-x-3 text-footnote text-label-secondary">
            <span>
              <span className="sr-only">Severity: </span>
              {SEVERITY_LABEL[event.severity]} indicator
            </span>
            <time dateTime={event.createdAt} className="tabular-nums">
              {clockTime(event.createdAt, true)}
            </time>
          </p>
        </div>
        {reviewed && !editing && (
          <Badge tone={REVIEW_TONE[review.status]} size="sm" className="mt-0.5">
            {REVIEW_LABEL[review.status]}
          </Badge>
        )}
      </div>

      {reviewed && !editing ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-footnote text-label-secondary">
          {review.note && <span className="text-label">“{review.note}”</span>}
          <span>{review.reviewedBy ?? 'Reviewed'}</span>
          {review.reviewedAt && (
            <time dateTime={review.reviewedAt} className="tabular-nums">
              {clockTime(review.reviewedAt)}
            </time>
          )}
          {canReview && (
            <Button variant="plain" size="sm" className="-my-1 ml-auto" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </div>
      ) : canReview ? (
        <div className="flex flex-col gap-2 pl-4">
          <div role="group" aria-label={`Review: ${label} at ${clockTime(event.createdAt)}`} className="flex flex-wrap items-center gap-1.5">
            {OUTCOMES.map((o) => (
              <Button
                key={o.status}
                size="sm"
                variant={review?.status === o.status ? 'tinted' : 'gray'}
                loading={pending === o.status}
                disabled={pending !== null && pending !== o.status}
                onClick={() => void decide(o.status)}
              >
                {o.icon}
                {o.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
              className={cn(noteOpen && 'text-label')}
            >
              <NotebookPen aria-hidden />
              {note.trim() ? 'Note added' : 'Add note'}
            </Button>
            {editing && (
              <Button size="sm" variant="plain" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
          {noteOpen && (
            <Textarea
              aria-label="Review note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="What did you check? Saved with the outcome you choose."
              className="min-h-14 text-callout"
              autoFocus
            />
          )}
        </div>
      ) : (
        <p className="pl-4 text-footnote text-label-secondary">Not reviewed yet</p>
      )}
    </motion.li>
  );
}

'use client';

import { Lock, Send } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSendMessage } from '../api';
import { fmtDateTime } from '../format';
import type { Message } from '../types';

/**
 * The conversation between the candidate and the exam team. Staff can add notes only staff see;
 * the candidate never receives them, and the API never sends them to the candidate.
 */
export function Thread({
  disputeId,
  messages,
  canMessage,
  staff,
  description,
  raisedLabel,
  raisedAt,
  closedNote,
  needsReply,
}: {
  disputeId: string;
  messages: Message[];
  canMessage: boolean;
  staff: boolean;
  /** The case as first written, shown as the opening message. */
  description: string;
  raisedLabel: string;
  raisedAt: string;
  closedNote?: string;
  needsReply?: boolean;
}) {
  const send = useSendMessage(disputeId);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const text = body.trim();
    if (!text) {
      setError('Write a message first');
      return;
    }
    setError(null);
    send.mutate(
      { body: text, internal: staff ? internal : undefined },
      {
        onSuccess: () => {
          setBody('');
          toast.success(internal ? 'Note added for staff' : staff ? 'Message sent to the candidate' : 'Message sent');
        },
        onError: (err) => {
          if (isApiError(err) && err.fields.body) setError(err.fields.body);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <Card padding="none">
      <div className="border-b px-5 py-4">
        <h3 className="text-headline text-label">Conversation</h3>
        <p className="mt-0.5 text-footnote text-label-secondary">
          {staff ? 'The candidate sees every message except notes to staff.' : 'Messages go to the exam team reviewing your dispute.'}
        </p>
      </div>
      <ol className="flex flex-col gap-4 px-5 py-5">
        <li className="flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-3 text-footnote text-label-secondary">
            <span>
              <span className="font-semibold text-label">{raisedLabel}</span> raised the dispute
            </span>
            <span className="tabular-nums">{fmtDateTime(raisedAt)}</span>
          </p>
          <p className="whitespace-pre-wrap text-callout text-label">{description}</p>
        </li>
        {messages.map((m) => (
          <li key={m.id} className={cn('flex flex-col gap-1', m.internal && 'rounded-lg bg-warning-tint/60 px-3 py-2.5')}>
            <p className="flex flex-wrap items-center gap-x-3 text-footnote text-label-secondary">
              <span className="font-semibold text-label">{m.mine ? 'You' : m.author}</span>
              <span className="tabular-nums">{fmtDateTime(m.createdAt)}</span>
              {m.internal && (
                <Badge tone="warning" size="sm">
                  <Lock aria-hidden /> Staff only
                </Badge>
              )}
            </p>
            <p className="whitespace-pre-wrap text-callout text-label">{m.body}</p>
          </li>
        ))}
      </ol>
      {canMessage ? (
        <div className="flex flex-col gap-3 border-t px-5 py-4">
          <Field label={staff ? (internal ? 'Note to staff' : 'Message to the candidate') : needsReply ? 'Your reply' : 'Add a message'} error={error ?? undefined} hint={!staff && needsReply ? 'The exam team asked you a question. Replying moves your dispute back into review.' : undefined}>
            <Textarea
              value={body}
              onChange={(ev) => setBody(ev.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={staff ? (internal ? 'Only staff on this exam will see this' : 'Ask for detail or explain what you are checking') : 'Add detail or answer the exam team’s question'}
              onKeyDown={(ev) => {
                if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') submit();
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {staff ? <Switch checked={internal} onCheckedChange={setInternal} label="Note to staff only" size="sm" /> : <span />}
            <Button variant={internal ? 'gray' : 'tinted'} onClick={submit} loading={send.isPending}>
              {internal ? <Lock aria-hidden /> : <Send aria-hidden />}
              {internal ? 'Add note' : 'Send'}
            </Button>
          </div>
        </div>
      ) : closedNote ? (
        <p className="border-t px-5 py-4 text-footnote text-label-secondary">{closedNote}</p>
      ) : null}
    </Card>
  );
}

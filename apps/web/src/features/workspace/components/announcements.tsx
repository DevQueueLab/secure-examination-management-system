'use client';

import type { AnnouncementView } from '@athena/shared';
import { BellRing, Megaphone, MessageCircleQuestion, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatClock } from '@/features/candidate/format';
import { useEngine, useEngineSelector } from '../lib/use-engine';

const GENERAL = '__general__';

function Ask({ askAbout, onAskAboutChange }: { askAbout: string | null; onAskAboutChange: (id: string | null) => void }) {
  const engine = useEngine();
  const items = useEngineSelector((s) => s.items);
  const clarifications = useEngineSelector((s) => s.clarifications);
  const online = useEngineSelector((s) => s.sync.online && s.sync.state !== 'offline');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numberOf = (itemId: string | null) => (itemId ? items.findIndex((i) => i.id === itemId) + 1 : 0);
  const list = [...clarifications].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  async function send() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await engine.askClarification(text, askAbout ?? undefined);
      setQuestion('');
    } catch (err) {
      setError(online ? errorMessage(err, 'Your question couldn’t be sent. Please send it again in a moment.') : 'You’re offline, so the question wasn’t sent. Send it again once you reconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <p className="text-callout text-label-secondary">
          Ask about wording or a technical problem. Proctors can’t help with answers. Replies appear here and on the question.
        </p>
        <Select
          aria-label="What your question is about"
          value={askAbout ?? GENERAL}
          onValueChange={(v) => onAskAboutChange(v === GENERAL ? null : v)}
          options={[{ value: GENERAL, label: 'The exam in general' }, ...items.map((item, i) => ({ value: item.id, label: `Question ${i + 1}` }))]}
        />
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Type your question"
          aria-label="Your question"
        />
        {error && (
          <p role="alert" className="text-callout text-danger-text">
            {error}
          </p>
        )}
        <Button type="submit" variant="filled" loading={busy} disabled={!question.trim()} className="self-end">
          <Send aria-hidden />
          Send to proctor
        </Button>
      </form>

      <section aria-label="Questions and clarifications" className="flex flex-col gap-3">
        <h3 className="text-callout font-semibold text-label">Questions and clarifications</h3>
        {list.length === 0 ? (
          <p className="text-callout text-label-secondary">Your questions, and clarifications the proctor sends to everyone, appear here.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {list.map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5 rounded-xl bg-surface p-3.5 shadow-xs ring-1 ring-separator">
                <div className="flex flex-wrap items-center gap-2 text-footnote text-label-secondary">
                  {c.mine ? <span className="font-medium text-label">You asked</span> : <Badge tone="info" size="sm">For everyone</Badge>}
                  {numberOf(c.itemId) > 0 && <span>Question {numberOf(c.itemId)}</span>}
                  <span data-numeric>{formatClock(c.createdAt)}</span>
                </div>
                {c.mine && <p className="text-callout text-label">{c.question}</p>}
                {c.answer ? (
                  <p className="text-callout text-label">
                    {c.mine && <span className="font-medium text-label-secondary">Proctor’s reply: </span>}
                    {c.answer}
                  </p>
                ) : (
                  <p className="text-footnote text-label-tertiary">Waiting for a reply</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AnnouncementList() {
  const announcements = useEngineSelector((s) => s.announcements);
  const list = [...announcements].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (list.length === 0) {
    return <EmptyState size="sm" surface={false} icon={<Megaphone />} title="No announcements" description="Messages from your proctor appear here and as a notice." />;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {list.map((a) => (
        <li key={a.id} className={cn('flex flex-col gap-1.5 rounded-xl p-3.5 ring-1', a.priority === 'urgent' ? 'bg-danger-tint/60 ring-danger/25' : 'bg-surface shadow-xs ring-separator')}>
          <div className="flex items-center gap-2 text-footnote text-label-secondary">
            {a.priority === 'urgent' && (
              <Badge tone="danger" size="sm">
                Urgent
              </Badge>
            )}
            {!a.read && <span className="font-medium text-accent-text">New</span>}
            <span data-numeric>{formatClock(a.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-callout text-label">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function AnnouncementsSheet({
  open,
  onOpenChange,
  tab,
  onTabChange,
  askAbout,
  onAskAboutChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: 'announcements' | 'ask';
  onTabChange: (tab: 'announcements' | 'ask') => void;
  askAbout: string | null;
  onAskAboutChange: (id: string | null) => void;
}) {
  const engine = useEngine();
  const announcements = useEngineSelector((s) => s.announcements);
  const unread = announcements.filter((a) => !a.read);
  const unreadIds = unread.map((a) => a.id).join(',');

  // Reading the list marks what's on it as read (sent through the outbox, so it works offline too).
  useEffect(() => {
    if (open && tab === 'announcements' && unreadIds) engine.markAnnouncementsRead(unreadIds.split(','));
  }, [open, tab, unreadIds, engine]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Announcements and questions">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as 'announcements' | 'ask')}>
          <TabsList className="mb-5 w-full">
            <TabsTrigger value="announcements">
              <Megaphone aria-hidden className="size-4" /> Announcements
            </TabsTrigger>
            <TabsTrigger value="ask">
              <MessageCircleQuestion aria-hidden className="size-4" /> Ask
            </TabsTrigger>
          </TabsList>
          <TabsContent value="announcements">
            <AnnouncementList />
          </TabsContent>
          <TabsContent value="ask">
            <Ask askAbout={askAbout} onAskAboutChange={onAskAboutChange} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/** Urgent announcements interrupt: a dialog the candidate acknowledges. */
export function UrgentAnnouncement({ announcement, onDismiss }: { announcement: AnnouncementView | null; onDismiss: () => void }) {
  return (
    <Dialog open={!!announcement} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent size="sm" closable={false} role="alertdialog" aria-live="assertive">
        <DialogHeader
          title={
            <span className="flex items-center gap-2">
              <BellRing aria-hidden className="size-5 text-danger" />
              Urgent announcement
            </span>
          }
          description={announcement ? `From your proctor at ${formatClock(announcement.createdAt)}` : undefined}
        />
        <DialogBody>
          <p className="whitespace-pre-wrap text-body text-label">{announcement?.body}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="filled" size="lg" onClick={onDismiss} autoFocus className="max-sm:w-full">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

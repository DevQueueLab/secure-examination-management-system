'use client';

import type { AnnouncementView } from '@athena/shared';
import { Grid3x3, Lock, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Shortcut } from '@/components/ui/kbd';
import { Sheet, SheetContent, useIsMobile } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toaster';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatClock } from '@/features/candidate/format';
import { completion } from '../lib/answers';
import { useIntegritySignals } from '../lib/integrity';
import { usePreferences } from '../lib/preferences';
import { useEngine, useEngineSelector } from '../lib/use-engine';
import { CalculatorPanel } from '../tools/calculator';
import { ScratchpadPanel } from '../tools/scratchpad';
import styles from '../workspace.module.css';
import { AnnouncementsSheet, UrgentAnnouncement } from './announcements';
import { WorkspaceBanners } from './banners';
import { WorkspaceHeader, type ToolId } from './header';
import { Navigator, usePaper } from './navigator';
import { PreferencesSheet } from './preferences-sheet';
import { QuestionView } from './question';
import { ReviewSheet } from './review-sheet';
import { GENERAL_PAGE, questionPage } from './working';

type OpenSheet = 'review' | 'preferences' | 'announcements' | 'nav' | null;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest('input, textarea, select, [role="combobox"], [role="listbox"], [role="slider"], [role="menu"], [role="dialog"] [role="radiogroup"]');
}

function anyOverlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"], [role="menu"]');
}

/** Watermark text tiled across the paper: the paper's code and the candidate's name, faint and inert. */
function Watermark({ code, name }: { code: string; name: string | null }) {
  return (
    <div aria-hidden className={cn(styles.watermark, styles.noPrint)}>
      <div className={styles.watermarkGrid}>
        {Array.from({ length: 160 }, (_, i) => (
          <span key={i} className="flex gap-4">
            {name && <span>{name}</span>}
            <span>{code}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The exam workspace once the attempt is open: header, banners, navigator, paper and tools. */
export function ExamShell() {
  const engine = useEngine();
  const confirm = useConfirm();
  const { me } = useAuth();
  const { prefs } = usePreferences();
  const mobile = useIsMobile();
  const view = useEngineSelector((s) => s.view);
  const items = useEngineSelector((s) => s.items);
  const current = useEngineSelector((s) => s.current);
  const max = useEngineSelector((s) => s.max);
  const phase = useEngineSelector((s) => s.phase);
  const answers = useEngineSelector((s) => s.answers);
  const paper = usePaper();

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [announcementTab, setAnnouncementTab] = useState<'announcements' | 'ask'>('announcements');
  const [askAbout, setAskAbout] = useState<string | null>(null);
  const [calculator, setCalculator] = useState(false);
  const [scratchpad, setScratchpad] = useState<string | null>(null);
  const [urgent, setUrgent] = useState<AnnouncementView | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  const digitHandler = useRef<((digit: number) => void) | null>(null);
  const registerDigits = useCallback((handler: ((digit: number) => void) | null) => {
    digitHandler.current = handler;
  }, []);

  const linear = view?.settings.navigation === 'linear';
  const layout = linear ? 'paged' : prefs.layout;
  const navPosition = mobile ? 'sheet' : prefs.navigator;
  const ready = phase === 'ready';
  const integrity = useIntegritySignals(engine, view?.settings ?? null, view?.fingerprint ?? null, ready);

  // ---------------------------------------------------------------- navigation

  const go = useCallback(
    (index: number) => {
      if (layout === 'scroll') {
        engine.goTo(index);
        document.getElementById(`question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (engine.goTo(index)) focusPending.current = true;
    },
    [engine, layout],
  );

  useEffect(() => {
    if (!focusPending.current || layout !== 'paged') return;
    focusPending.current = false;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [current, layout]);

  const goNext = useCallback(async () => {
    if (current >= items.length - 1) {
      setSheet('review');
      return;
    }
    if (linear) {
      const item = items[current];
      const unanswered = item && completion(item, answers[item.id]?.response ?? null) !== 'complete';
      if (unanswered) {
        const ok = await confirm({
          title: `Move on from question ${current + 1}?`,
          description: 'It isn’t fully answered, and this exam moves forward only: you can’t come back to it.',
          confirmLabel: 'Move on',
          cancelLabel: 'Stay',
        });
        if (!ok) return;
      }
    }
    go(current + 1);
  }, [answers, confirm, current, go, items, linear]);

  const goPrev = useCallback(() => {
    if (!linear && current > 0) go(current - 1);
  }, [current, go, linear]);

  // ---------------------------------------------------------------- shortcuts: ← → F and 1–9

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ready || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || anyOverlayOpen()) return;
      if (e.key === 'ArrowRight' && layout === 'paged') {
        e.preventDefault();
        void goNext();
      } else if (e.key === 'ArrowLeft' && layout === 'paged') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'f' || e.key === 'F') {
        const item = items[current];
        if (item && engine.canEdit(item.id)) {
          e.preventDefault();
          engine.toggleFlag(item.id);
          toast.message(engine.getSnapshot().answers[item.id]?.flagged ? `Question ${current + 1} flagged` : `Flag removed from question ${current + 1}`, {
            duration: 1_500,
          });
        }
      } else if (/^[1-9]$/.test(e.key) && digitHandler.current) {
        e.preventDefault();
        digitHandler.current(Number(e.key));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, engine, goNext, goPrev, items, layout, ready]);

  // ---------------------------------------------------------------- time on each question

  useEffect(() => {
    if (!ready) return;
    const itemId = items[current]?.id;
    if (!itemId) return;
    let last = performance.now();
    const add = () => {
      const now = performance.now();
      if (document.visibilityState === 'visible') engine.trackTime(itemId, Math.round(now - last));
      last = now;
    };
    const id = setInterval(add, 5_000);
    return () => {
      clearInterval(id);
      add();
    };
  }, [current, engine, items, ready]);

  // ---------------------------------------------------------------- scroll layout follows the reader

  useEffect(() => {
    if (layout !== 'scroll' || !ready) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const index = visible ? Number((visible.target as HTMLElement).dataset.index) : NaN;
        if (Number.isFinite(index) && index !== engine.getSnapshot().current) engine.goTo(index);
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    document.querySelectorAll<HTMLElement>('[data-question-anchor]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [engine, layout, ready, items.length]);

  // ---------------------------------------------------------------- notices

  useEffect(
    () =>
      engine.onNotice((notice) => {
        switch (notice.kind) {
          case 'announcement':
            if (notice.announcement.priority === 'urgent') setUrgent(notice.announcement);
            else
              toast.info('New announcement', {
                description: notice.announcement.body.length > 140 ? `${notice.announcement.body.slice(0, 140)}…` : notice.announcement.body,
                action: { label: 'View', onClick: () => openAnnouncements('announcements') },
              });
            break;
          case 'clarification':
            toast.info(notice.clarification.mine ? 'Your question was answered' : 'Clarification for everyone', {
              description: notice.clarification.answer ?? undefined,
              action: { label: 'View', onClick: () => openAnnouncements('ask') },
            });
            break;
          case 'time_extended': {
            const minutes = Math.round(notice.deltaSeconds / 60);
            toast.success(minutes >= 1 ? `${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}` : 'More time added', {
              description: `Your exam now ends at ${formatClock(notice.deadlineAt)}.`,
              duration: 10_000,
            });
            break;
          }
          case 'unsealed':
            toast.success('You can keep answering', { description: 'Time was added while you were offline.' });
            break;
          case 'rejected': {
            const index = engine.getSnapshot().items.findIndex((i) => i.id === notice.itemId);
            toast.error(index >= 0 ? `Question ${index + 1} couldn’t be saved` : 'An answer couldn’t be saved', {
              description: notice.message,
              action: index >= 0 ? { label: 'Go to it', onClick: () => go(index) } : undefined,
            });
            break;
          }
          case 'storage':
            toast.warning(notice.message);
            break;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, go],
  );

  // An urgent announcement that arrived before this page loaded still interrupts once.
  const announcements = useEngineSelector((s) => s.announcements);
  const shownUrgent = useRef(new Set<string>());
  useEffect(() => {
    if (urgent) return;
    const next = announcements.find((a) => a.priority === 'urgent' && !a.read && !shownUrgent.current.has(a.id));
    if (next) setUrgent(next);
  }, [announcements, urgent]);

  function openAnnouncements(tab: 'announcements' | 'ask', itemId?: string) {
    setAnnouncementTab(tab);
    setAskAbout(itemId ?? null);
    setSheet('announcements');
  }

  const onTool = (tool: ToolId) => {
    if (tool === 'calculator') setCalculator((v) => !v);
    else if (tool === 'scratchpad') setScratchpad((v) => (v ? null : items[current] ? questionPage(items[current].id) : GENERAL_PAGE));
    else if (tool === 'preferences') setSheet('preferences');
    else openAnnouncements(tool === 'ask' ? 'ask' : 'announcements', tool === 'ask' ? items[current]?.id : undefined);
  };

  const questionNav = useMemo(
    () => ({ registerDigits, onOpenScratchpad: (key: string) => setScratchpad(key), onAsk: (itemId: string) => openAnnouncements('ask', itemId) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registerDigits],
  );

  if (!view) return null;
  const isLast = current >= items.length - 1;
  const firstOfSection = (index: number) => index === 0 || items[index]?.sectionId !== items[index - 1]?.sectionId;

  const pagedFooter = (
    <div className="mt-10 flex flex-col gap-4 border-t pt-6 max-md:hidden">
      {linear && (
        <p className="flex items-start gap-2 text-footnote text-label-secondary">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          This exam moves forward only. Once you go to the next question, you can’t return to this one.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        {!linear ? (
          <Button variant="gray" size="lg" onClick={goPrev} disabled={current === 0} aria-keyshortcuts="ArrowLeft">
            Previous
          </Button>
        ) : (
          <span />
        )}
        <p className="hidden items-center gap-3 text-footnote text-label-tertiary lg:flex">
          {!linear && (
            <span className="flex items-center gap-1.5">
              <Shortcut keys={['←']} size="sm" />
              <Shortcut keys={['→']} size="sm" /> move
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Shortcut keys={['F']} size="sm" /> flag
          </span>
        </p>
        <Button variant={isLast ? 'filled' : 'tinted'} size="lg" onClick={() => void goNext()} aria-keyshortcuts="ArrowRight">
          {isLast ? (
            <>
              Review &amp; submit <Send aria-hidden />
            </>
          ) : (
            'Next'
          )}
        </Button>
      </div>
    </div>
  );

  const rail = (side: 'left' | 'right') => (
    <aside
      aria-label="Question navigator"
      className={cn(
        'sticky top-[calc(3.5rem+var(--ws-banners,0px))] hidden h-[calc(100dvh-3.5rem-var(--ws-banners,0px))] w-64 shrink-0 overflow-y-auto bg-surface p-5 [--nav-bg:var(--surface)] md:block',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <Navigator layout="rail" onNavigate={go} />
    </aside>
  );

  return (
    <div className="relative flex min-h-dvh flex-col">
      <a href="#paper" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
        Skip to the question
      </a>
      <WorkspaceHeader
        onTool={onTool}
        onReview={() => setSheet('review')}
        active={{ calculator, scratchpad: scratchpad !== null, announcements: sheet === 'announcements', preferences: sheet === 'preferences' }}
      />
      <WorkspaceBanners fullscreenPrompt={integrity.fullscreenPrompt} onEnterFullscreen={integrity.enterFullscreen} />

      <div className="flex min-h-0 flex-1">
        {navPosition === 'left' && rail('left')}

        <main id="paper" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-32 pt-8 outline-none sm:px-8 md:pb-16 lg:pt-10">
          <div className={styles.paper}>
            {layout === 'paged' ? (
              <>
                <QuestionView
                  key={items[current]?.id}
                  ref={headingRef}
                  index={current}
                  showSection={firstOfSection(current)}
                  registerDigits={questionNav.registerDigits}
                  onOpenScratchpad={questionNav.onOpenScratchpad}
                  onAsk={questionNav.onAsk}
                />
                {pagedFooter}
              </>
            ) : (
              <div className="flex flex-col gap-14">
                {items.map((item, index) => (
                  <section key={item.id} id={`question-${index + 1}`} data-question-anchor data-index={index} className="scroll-mt-24">
                    <QuestionView
                      index={index}
                      showSection={firstOfSection(index)}
                      registerDigits={index === current ? questionNav.registerDigits : undefined}
                      onOpenScratchpad={questionNav.onOpenScratchpad}
                      onAsk={questionNav.onAsk}
                    />
                  </section>
                ))}
                <div className="flex justify-center border-t pt-8 max-md:hidden">
                  <Button variant="filled" size="lg" onClick={() => setSheet('review')}>
                    Review &amp; submit <Send aria-hidden />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </main>

        {navPosition === 'right' && rail('right')}
        {scratchpad !== null && !mobile && (
          <aside aria-label="Scratchpad" className="sticky top-[calc(3.5rem+var(--ws-banners,0px))] hidden h-[calc(100dvh-3.5rem-var(--ws-banners,0px))] w-[26rem] shrink-0 border-l bg-surface md:flex xl:w-[30rem]">
            <ScratchpadPanel pageKey={scratchpad} onPageChange={setScratchpad} onClose={() => setScratchpad(null)} />
          </aside>
        )}
      </div>

      {navPosition === 'bottom' && (
        <div className="material hairline-t sticky bottom-0 z-20 pb-safe [--nav-bg:var(--material-solid)] max-md:hidden">
          <Navigator layout="strip" onNavigate={go} />
        </div>
      )}

      {(mobile || navPosition === 'hidden') && (
        <nav aria-label="Question controls" className={cn('material hairline-t sticky bottom-0 z-20 pb-safe', !mobile && 'md:static md:bg-transparent md:shadow-none')}>
          <div className="flex items-center gap-2 px-3 py-2">
            {!linear && (
              <Button variant="gray" size="lg" onClick={goPrev} disabled={current === 0} aria-label="Previous question" className={cn(!mobile && 'hidden')}>
                Previous
              </Button>
            )}
            <Button variant="gray" size="lg" className="min-w-0 flex-1" onClick={() => setSheet('nav')} aria-label={`Questions: ${paper.answered} of ${paper.total} answered. Open the question map`}>
              <Grid3x3 aria-hidden />
              <span data-numeric>
                {current + 1} <span className="font-normal text-label-secondary">of {paper.total}</span>
              </span>
              <span className="truncate pl-2 font-normal text-label-secondary max-[440px]:hidden" data-numeric>
                {paper.answered} answered
              </span>
            </Button>
            {mobile && (
              <Button variant={isLast ? 'filled' : 'tinted'} size="lg" onClick={() => void goNext()} aria-label={isLast ? 'Review and submit' : 'Next question'}>
                {isLast ? 'Review' : 'Next'}
              </Button>
            )}
          </div>
        </nav>
      )}

      {/* Sheets and panels */}
      <Sheet open={sheet === 'nav'} onOpenChange={(open) => setSheet(open ? 'nav' : null)} side="right">
        <SheetContent title="Questions" className="[--nav-bg:var(--surface-raised)]">
          <Navigator
            layout="sheet"
            onNavigate={(index) => {
              setSheet(null);
              go(index);
            }}
          />
        </SheetContent>
      </Sheet>
      <ReviewSheet open={sheet === 'review'} onOpenChange={(open) => setSheet(open ? 'review' : null)} onJump={go} />
      <PreferencesSheet open={sheet === 'preferences'} onOpenChange={(open) => setSheet(open ? 'preferences' : null)} linear={linear} />
      <AnnouncementsSheet
        open={sheet === 'announcements'}
        onOpenChange={(open) => setSheet(open ? 'announcements' : null)}
        tab={announcementTab}
        onTabChange={setAnnouncementTab}
        askAbout={askAbout}
        onAskAboutChange={setAskAbout}
      />
      <UrgentAnnouncement
        announcement={urgent}
        onDismiss={() => {
          if (urgent) {
            shownUrgent.current.add(urgent.id);
            engine.markAnnouncementsRead([urgent.id]);
          }
          setUrgent(null);
        }}
      />
      {calculator && <CalculatorPanel onClose={() => setCalculator(false)} />}
      {scratchpad !== null && mobile && (
        <Sheet open onOpenChange={(open) => !open && setScratchpad(null)} side="bottom">
          <SheetContent title="Scratchpad" bare className="h-[92dvh]">
            <ScratchpadPanel pageKey={scratchpad} onPageChange={setScratchpad} onClose={() => setScratchpad(null)} />
          </SheetContent>
        </Sheet>
      )}
      {view.settings.integrity.watermark && view.fingerprint && <Watermark code={view.fingerprint} name={me?.user.name ?? null} />}
    </div>
  );
}

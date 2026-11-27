'use client';

import { encodeFingerprint, hasFingerprintTrace, type AttemptView } from '@athena/shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toaster';
import type { AttemptEngine } from '../sync/engine';

type Settings = AttemptView['settings'];

function editableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
}

function itemOf(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
}

function fieldOf(el: HTMLElement | null): string | undefined {
  if (!el) return undefined;
  const id = el.id || '';
  if (id.endsWith('-working')) return 'working';
  return 'response';
}

/**
 * Integrity indicators, recorded as outbox events so they survive going offline. They are signals for a
 * person to review in context, never penalties: nothing here blocks the candidate except what the examiner
 * switched on (copy and paste).
 */
export function useIntegritySignals(engine: AttemptEngine, settings: Settings | null, fingerprint: string | null, active: boolean) {
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);
  const lastToast = useRef(0);

  useEffect(() => {
    if (!settings || !active) return;
    const { detectFocusLoss, blockCopyPaste, requireFullscreen } = settings.integrity;
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, capture = false) => {
      target.addEventListener(type, fn, capture);
      cleanups.push(() => target.removeEventListener(type, fn, capture));
    };
    const onDoc = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, capture = false) => {
      document.addEventListener(type, fn, capture);
      cleanups.push(() => document.removeEventListener(type, fn, capture));
    };
    const notice = (message: string) => {
      const now = Date.now();
      if (now - lastToast.current < 6_000) return;
      lastToast.current = now;
      toast.info(message);
    };

    // Focus: the tab hidden or the window losing focus, and for how long.
    if (detectFocusLoss) {
      let lostAt: number | null = null;
      const lose = (reason: 'tab_hidden' | 'window_blur') => {
        if (lostAt !== null) return;
        lostAt = performance.now();
        engine.logEvent('focus_lost', { reason });
      };
      const regain = () => {
        if (lostAt === null) return;
        const durationMs = Math.round(performance.now() - lostAt);
        lostAt = null;
        engine.logEvent('focus_returned', { durationMs });
      };
      onDoc('visibilitychange', () => {
        if (document.visibilityState === 'hidden') lose('tab_hidden');
        else if (document.hasFocus()) regain();
      });
      on(window, 'blur', () => {
        // Let focus settle: moving between our own controls never counts.
        setTimeout(() => {
          if (document.visibilityState === 'visible' && !document.hasFocus()) lose('window_blur');
        }, 150);
      });
      on(window, 'focus', regain);
    }

    // Full screen: exits are noted and the candidate is offered a way back.
    if (requireFullscreen && document.fullscreenEnabled) {
      setFullscreenPrompt(!document.fullscreenElement);
      onDoc('fullscreenchange', () => {
        const inside = !!document.fullscreenElement;
        setFullscreenPrompt(!inside);
        engine.logEvent(inside ? 'fullscreen_entered' : 'fullscreen_exited', {});
      });
    }

    // Copy, cut and paste.
    const onCopy = (e: ClipboardEvent) => {
      const field = editableTarget(e.target);
      if (blockCopyPaste) {
        e.preventDefault();
        engine.logEvent('copy_attempt', { kind: e.type, itemId: itemOf(e.target) });
        notice('Copy and paste are turned off for this exam.');
        return;
      }
      // Question text copied out of the paper carries the paper's code, so a leak can be traced.
      if (!field && fingerprint && e.clipboardData) {
        const text = document.getSelection()?.toString() ?? '';
        if (!text) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', hasFingerprintTrace(text) ? text : text + encodeFingerprint(fingerprint));
      }
    };
    onDoc('copy', onCopy, true);
    onDoc('cut', onCopy, true);
    onDoc(
      'paste',
      (e) => {
        const field = editableTarget(e.target);
        if (blockCopyPaste) {
          e.preventDefault();
          engine.logEvent('copy_attempt', { kind: 'paste', itemId: itemOf(e.target) });
          notice('Copy and paste are turned off for this exam.');
          return;
        }
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (text) engine.logEvent('paste', { length: text.length, itemId: itemOf(e.target), field: fieldOf(field) });
      },
      true,
    );

    onDoc('contextmenu', (e) => {
      engine.logEvent('context_menu', { itemId: itemOf(e.target) });
      if (blockCopyPaste && !editableTarget(e.target)) e.preventDefault();
    });

    on(window, 'beforeprint', () => engine.logEvent('print_attempt', {}));

    // A second display, where the browser reports it (no permission prompt: `isExtended` is a plain flag).
    const scr = window.screen as unknown as Partial<EventTarget> & { isExtended?: boolean };
    if (typeof scr.isExtended === 'boolean') {
      let reported = false;
      const check = () => {
        if (scr.isExtended && !reported) {
          reported = true;
          engine.logEvent('multiple_displays', { extended: true });
        } else if (!scr.isExtended) reported = false;
      };
      check();
      const onChange = () => check();
      scr.addEventListener?.('change', onChange);
      cleanups.push(() => scr.removeEventListener?.('change', onChange));
    }

    return () => {
      for (const fn of cleanups.splice(0)) fn();
    };
  }, [engine, settings, fingerprint, active]);

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {
      toast.error('Full screen isn’t available right now. Use your browser’s full-screen option instead.');
    });
  };

  return { fullscreenPrompt: fullscreenPrompt && active, enterFullscreen };
}

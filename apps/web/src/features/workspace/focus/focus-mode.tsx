'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { animate } from 'motion/react';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
import { useEngineSelector } from '../lib/use-engine';

/*
 * Focus mode: the question map and the exam tools step aside, leaving a slim bar (title, save state, timer,
 * Review & submit) and the paper alone in the middle. Shift F toggles it (F on its own still flags), Esc leaves
 * it, and it is remembered per attempt for this tab. Everything hangs off one attribute on <html>, so removing
 * the toggle's mount line removes the feature.
 */

const ATTR = 'wsFocus';
const STYLE = `
html[data-ws-focus='on'] aside[aria-label='Question navigator'],
html[data-ws-focus='on'] [role='toolbar'][aria-label='Exam tools'],
html[data-ws-focus='on'] [data-ws-focus-hide] { display: none !important; }
`;

const storageKey = (attemptId: string) => `athena:focus:${attemptId}`;

/** The attribute on <html> is the one source of truth; the button reads it like any external store. */
function subscribeFocus(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ws-focus'] });
  return () => observer.disconnect();
}
const readFocus = () => document.documentElement.dataset[ATTR] === 'on';

function readSaved(attemptId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(attemptId)) === '1';
  } catch {
    return false;
  }
}

function save(attemptId: string, on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(storageKey(attemptId), '1');
    else window.sessionStorage.removeItem(storageKey(attemptId));
  } catch {
    /* private mode: it lasts until the page closes */
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"], [role="menu"], [role="listbox"]');
}

/** The header toggle. It also owns the shortcut and the attribute, so this one component is the whole feature. */
export function FocusModeToggle({ className }: { className?: string }) {
  const attemptId = useEngineSelector((s) => s.view?.id ?? null);
  const reduced = useReducedMotion();
  const on = useSyncExternalStore(subscribeFocus, readFocus, () => false);

  const apply = useCallback(
    (next: boolean, glide: boolean) => {
      const root = document.documentElement;
      const paper = document.querySelector<HTMLElement>('#paper > div');
      const before = glide && paper ? paper.getBoundingClientRect().left : null;
      if (next) root.dataset[ATTR] = 'on';
      else delete root.dataset[ATTR];
      if (attemptId) save(attemptId, next);
      // FLIP: measure once before and once after the switch, then let the paper spring to its new centre.
      if (before === null || !paper || reduced) return;
      const dx = before - paper.getBoundingClientRect().left;
      if (Math.abs(dx) < 1) return;
      void animate(paper, { x: [dx, 0] }, { type: 'spring', bounce: 0.16, visualDuration: 0.34 }).then(() => {
        paper.style.transform = '';
      });
    },
    [attemptId, reduced],
  );

  // Restore this attempt's choice; leave nothing behind when the workspace closes.
  useEffect(() => {
    if (attemptId && readSaved(attemptId)) apply(true, false);
    return () => {
      delete document.documentElement.dataset[ATTR];
    };
  }, [attemptId, apply]);

  // Capture phase, and the event is marked handled, so the paper's own F (flag) shortcut never sees Shift F.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || overlayOpen()) return;
      const active = document.documentElement.dataset[ATTR] === 'on';
      if (e.key === 'Escape' && active) {
        e.preventDefault();
        apply(false, true);
      } else if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        apply(!active, true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [apply]);

  return (
    <>
      <style href="athena-ws-focus" precedence="default">
        {STYLE}
      </style>
      <Tooltip content={on ? 'Leave focus mode (Shift F or Esc)' : 'Focus mode (Shift F)'}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => apply(!on, true)}
          aria-label={on ? 'Leave focus mode' : 'Focus mode'}
          aria-pressed={on}
          className={cn('max-md:hidden', on && 'bg-fill text-label', className)}
        >
          {on ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </Button>
      </Tooltip>
    </>
  );
}

'use client';

import type { WorkspacePreferences } from '@athena/shared';
import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { FONT_SCALE_STEPS, usePreferences } from '../lib/preferences';

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b py-5 first:pt-1 last:border-b-0">
      <h3 className="text-callout font-semibold text-label">{title}</h3>
      {children}
      {hint && <p className="text-footnote text-label-secondary">{hint}</p>}
    </section>
  );
}

/** Theme swatches: each shows its own paper and ink, so the choice is visible before it's made. */
const THEMES: { value: WorkspacePreferences['theme']; label: string; paper: string; ink: string; edge: string }[] = [
  { value: 'system', label: 'System', paper: 'linear-gradient(135deg, #ffffff 50%, #1c1c1e 50%)', ink: '#8e8e93', edge: 'rgb(0 0 0 / 0.12)' },
  { value: 'light', label: 'Light', paper: '#ffffff', ink: '#1d1d1f', edge: 'rgb(0 0 0 / 0.12)' },
  { value: 'dark', label: 'Dark', paper: '#1c1c1e', ink: '#f5f5f7', edge: 'rgb(255 255 255 / 0.16)' },
  { value: 'sepia', label: 'Sepia', paper: '#f8f1e2', ink: '#2b2115', edge: 'rgb(80 60 20 / 0.2)' },
  { value: 'contrast', label: 'High contrast', paper: '#000000', ink: '#ffff00', edge: 'rgb(255 255 255 / 0.5)' },
];

export function PreferencesSheet({ open, onOpenChange, linear }: { open: boolean; onOpenChange: (open: boolean) => void; linear: boolean }) {
  const { prefs, set, reset } = usePreferences();
  const step = FONT_SCALE_STEPS.findIndex((s) => Math.abs(s - prefs.fontScale) < 0.001);
  const stepIndex = step === -1 ? FONT_SCALE_STEPS.indexOf(1) : step;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Preferences" description="Changes apply at once and follow you to any device.">
        <Group title="Appearance">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-5 gap-2">
            {THEMES.map((t) => {
              const selected = prefs.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => set({ theme: t.value })}
                  className="group flex flex-col items-center gap-1.5 rounded-xl p-1 outline-none focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-12 w-full items-center justify-center rounded-[10px] text-callout font-semibold transition-shadow',
                      selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface-raised)]' : 'group-hover:ring-1 group-hover:ring-separator-strong',
                    )}
                    style={{ background: t.paper, color: t.ink, boxShadow: `inset 0 0 0 1px ${t.edge}` }}
                  >
                    Aa
                  </span>
                  <span className={cn('text-caption', selected ? 'font-semibold text-label' : 'text-label-secondary')}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="Reading" hint="Question text, options and your answers follow these settings.">
          <div className="flex items-center justify-between gap-3">
            <span className="text-callout text-label">Text size</span>
            <div className="flex items-center gap-1">
              <Button
                variant="gray"
                size="icon"
                onClick={() => set({ fontScale: FONT_SCALE_STEPS[Math.max(0, stepIndex - 1)] })}
                disabled={stepIndex === 0}
                aria-label="Smaller text"
              >
                <Minus aria-hidden />
              </Button>
              <output className="w-14 text-center text-callout font-semibold tabular-nums text-label" aria-live="polite" aria-label="Text size">
                {Math.round(prefs.fontScale * 100)}%
              </output>
              <Button
                variant="gray"
                size="icon"
                onClick={() => set({ fontScale: FONT_SCALE_STEPS[Math.min(FONT_SCALE_STEPS.length - 1, stepIndex + 1)] })}
                disabled={stepIndex === FONT_SCALE_STEPS.length - 1}
                aria-label="Larger text"
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </div>
          <SegmentedControl
            aria-label="Font"
            block
            value={prefs.font}
            onValueChange={(font) => set({ font })}
            options={[
              { value: 'sans', label: <span style={{ fontFamily: 'var(--font-sans)' }}>Sans</span> },
              { value: 'serif', label: <span style={{ fontFamily: 'var(--font-serif)' }}>Serif</span> },
              { value: 'readable', label: <span style={{ fontFamily: 'var(--font-readable), var(--font-sans)' }}>Hyperlegible</span> },
            ]}
          />
          <SegmentedControl
            aria-label="Line spacing"
            block
            value={prefs.lineSpacing}
            onValueChange={(lineSpacing) => set({ lineSpacing })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
              { value: 'relaxed', label: 'Relaxed' },
            ]}
          />
        </Group>

        <Group
          title="Layout"
          hint={linear ? 'This exam shows one question at a time because it moves forward only.' : undefined}
        >
          <SegmentedControl
            aria-label="Questions per page"
            block
            value={linear ? 'paged' : prefs.layout}
            onValueChange={(layout) => set({ layout })}
            options={[
              { value: 'paged', label: 'One at a time' },
              { value: 'scroll', label: 'All questions', disabled: linear },
            ]}
          />
          <div className="flex flex-col gap-1.5 max-md:hidden">
            <span className="text-footnote text-label-secondary">Question map</span>
            <SegmentedControl
              aria-label="Question map position"
              block
              value={prefs.navigator}
              onValueChange={(navigator) => set({ navigator })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'hidden', label: 'Hidden' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-footnote text-label-secondary">Timer</span>
            <SegmentedControl
              aria-label="Timer display"
              block
              value={prefs.timer}
              onValueChange={(timer) => set({ timer })}
              options={[
                { value: 'always', label: 'Seconds' },
                { value: 'minimal', label: 'Minutes' },
                { value: 'last5', label: 'Last 5 min' },
              ]}
            />
          </div>
        </Group>

        <Group title="Assistance">
          <Switch checked={prefs.reduceMotion} onCheckedChange={(reduceMotion) => set({ reduceMotion })} label="Reduce motion" description="Cross-fades instead of movement." />
          <Switch checked={prefs.showWordCount} onCheckedChange={(showWordCount) => set({ showWordCount })} label="Word count" description="Under written answers." />
          <Switch
            checked={prefs.confirmBeforeSubmit}
            onCheckedChange={(confirmBeforeSubmit) => set({ confirmBeforeSubmit })}
            label="Confirm before submitting"
            description="Ask for one more tick before the exam is handed in."
          />
        </Group>

        <div className="pt-2">
          <Button variant="plain" size="sm" onClick={reset} className="-ml-2.5">
            Restore defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

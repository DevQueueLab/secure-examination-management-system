'use client';

import { Compass, FileQuestion, Inbox, LockKeyhole, Medal, Trophy, WifiOff } from 'lucide-react';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { EmptyState, type EmptyStateArt } from '@/components/ui/empty-state';
import { MarksRule, ScoreRule } from '@/components/ui/marks-rule';
import { Section } from '@/components/ui/section';
import { StatTile } from '@/components/ui/stat-tile';

const SWATCHES: { token: string; name: string; use: string }[] = [
  { token: '--bg', name: 'Ground', use: 'Marble in light, smoked glass in dark' },
  { token: '--surface', name: 'Sheet', use: 'The one raised plane per page' },
  { token: '--label', name: 'Ink', use: 'Text and the neutral needle' },
  { token: '--label-secondary', name: 'Graphite', use: 'Secondary text' },
  { token: '--accent', name: 'Carmine', use: 'Action, selection, the needle' },
  { token: '--gold', name: 'Gold', use: 'Pass marks, published, verified' },
  { token: '--gold-text', name: 'Gold text', use: 'Gold words, AA on the ground' },
  { token: '--wine', name: 'Wine', use: 'Depth and secondary data' },
  { token: '--info', name: 'Info ink', use: 'Scheduled, roles: never blue' },
];

const DATA = [
  { token: '--data-1', name: 'Subject', note: 'carmine' },
  { token: '--data-2', name: 'Comparison', note: 'graphite' },
  { token: '--data-3', name: 'Target', note: 'gold' },
  { token: '--data-4', name: 'Secondary', note: 'wine' },
  { token: '--data-5', name: 'Rest', note: 'marble' },
];

const ART: { art: EmptyStateArt; title: string; icon: React.ReactNode }[] = [
  { art: 'owl', title: 'Nothing here yet', icon: <Inbox /> },
  { art: 'helmet', title: 'No exams scheduled', icon: <Medal /> },
  { art: 'amphora', title: 'The question bank is empty', icon: <FileQuestion /> },
  { art: 'shield', title: 'You don’t have access', icon: <LockKeyhole /> },
  { art: 'laurel', title: 'Results published', icon: <Trophy /> },
  { art: 'column', title: 'This page doesn’t exist', icon: <Compass /> },
];

function ThemePanel({ theme, label }: { theme: 'light' | 'dark' | 'sepia' | 'contrast'; label: string }) {
  return (
    <div data-theme={theme} className="flex min-w-0 flex-col gap-4 rounded-2xl bg-bg p-4 text-label ring-1 ring-separator">
      <div className="flex items-center justify-between gap-2">
        <span className="text-footnote font-medium text-label-secondary">{label}</span>
        <Badge tone="gold" size="sm">Verified</Badge>
      </div>
      <div className="fluted -mx-4 flex h-12 items-center gap-2 px-4 shadow-[inset_0_0.5px_0_var(--separator),inset_0_-0.5px_0_var(--separator)]">
        <span className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-chip px-2.5 text-callout [box-shadow:var(--chip-shadow),0_0_0_0.5px_var(--chip-ring)]">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          Exams
        </span>
        <span className="px-2 text-callout text-label-secondary">Grading</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="numeral text-[2.25rem] leading-none">82.6</span>
        <span className="text-callout text-label-secondary">percent</span>
      </div>
      <ScoreRule score={19} max={23} pass={11.5} size="sm" label={`Score, ${label}`} />
      <div className="flex flex-wrap gap-1.5">
        <PhaseBadge phase="scheduled" size="sm" />
        <PhaseBadge phase="ongoing" size="sm" />
        <Badge tone="accent" size="sm">Flagged</Badge>
        <Badge tone="gold" size="sm">Passed</Badge>
      </div>
      <div className="flex h-10 items-end gap-1.5" aria-hidden>
        {[0.55, 0.8, 0.4, 1, 0.65].map((h, i) => (
          <span key={i} className="w-full rounded-t-[3px]" style={{ height: `${h * 100}%`, background: `var(--data-${i + 1})` }} />
        ))}
      </div>
    </div>
  );
}

/** The instrument: palette, numerals, the Marks rule, fluted glass and the sculpture twins. */
export function Showcase() {
  return (
    <>
      <Section title="Palette" description="Marble and smoked glass grounds, carmine for authority, gold for certification. No blue or violet anywhere.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map((s) => (
            <div key={s.token} className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="size-10 shrink-0 rounded-[10px] ring-1 ring-separator" style={{ background: `var(${s.token})` }} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-callout font-medium">{s.name}</span>
                <span className="truncate text-footnote text-label-secondary">{s.use}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <span className="text-footnote font-medium text-label-secondary">Data palette (lib/chart-theme.ts)</span>
          <div className="grid grid-cols-5 overflow-hidden rounded-xl ring-1 ring-separator">
            {DATA.map((d) => (
              <div key={d.token} className="flex flex-col">
                <span aria-hidden className="h-10" style={{ background: `var(${d.token})` }} />
                <span className="truncate bg-surface px-2.5 py-2 text-footnote">
                  <span className="font-medium text-label">{d.name}</span> <span className="text-label-secondary">{d.note}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Numerals" description="Big numbers are Switzer Light with tabular figures and tight tracking: precision, not a template.">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Writing now" value="12" hint="of 24 enrolled" />
          <StatTile label="Papers graded" value="31" hint="of 48 submitted" />
          <StatTile label="Time left" value={<time>00:42:17</time>} hint="Window closes 14:25" />
        </div>
      </Section>

      <Section title="Marks rule" description="One instrument for every measurement: carmine needle, gold pass mark, gold tolerance band.">
        <div className="grid gap-x-10 gap-y-8 rounded-xl bg-surface p-5 ring-1 ring-separator sm:p-6 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-8">
            <ScoreRule score={19} max={23} pass={11.5} size="lg" readout settle />
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-callout">
                <span className="text-label">Papers graded</span>
                <span className="tabular-nums text-label-secondary">31 of 48</span>
              </div>
              <MarksRule value={31} max={48} label="Papers graded" marker="fill" labels="ends" size="md" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-callout">
                <span className="text-label">Expected difficulty, balanced draw</span>
                <span className="tabular-nums text-label-secondary">target 58.2%, tolerance ±3</span>
              </div>
              <MarksRule
                value={58.7}
                min={40}
                max={80}
                band={[55.2, 61.2]}
                pass={58.2}
                passLabel="Target 58.2%"
                label="Expected difficulty"
                valueText="58.7%, inside the tolerance band"
                labels="major"
                format={(v) => `${v}%`}
              />
            </div>
            <div className="flex flex-col divide-y divide-separator">
              {[
                { name: 'Ali Hassan', v: 9, t: '9 of 11' },
                { name: 'Amna Sheikh', v: 11, t: '11 of 11' },
                { name: 'Bilal Mirza', v: 4, t: '4 of 11' },
              ].map((r) => (
                <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,12rem)_3.5rem] items-center gap-4 py-2.5 text-callout">
                  <span className="truncate">{r.name}</span>
                  <MarksRule value={r.v} max={11} size="sm" label={`${r.name}, answered`} marker="fill" ticks={{ major: 11 / 10, minor: 11 / 20 }} />
                  <span className="text-right tabular-nums text-label-secondary">{r.t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-6">
            <MarksRule orientation="vertical" value={42} max={60} label="Time left, minutes" tone="neutral" labels="ends" length={220} format={(v) => `${v}m`} />
            <MarksRule orientation="vertical" value={72} pass={50} band={[45, 55]} label="Cohort average" length={220} size="lg" />
          </div>
        </div>
      </Section>

      <Section title="Materials" description="Fluted glass: vertical reeds over frosted marble or smoked glass, one backdrop blur at most, solid in the contrast theme.">
        <div className="relative grid h-44 overflow-hidden rounded-xl ring-1 ring-separator sm:grid-cols-2">
          <div className="fluted flex items-end p-4 text-footnote text-label-secondary">fluted: the sidebar plane</div>
          <div className="relative hidden overflow-hidden sm:block">
            <div aria-hidden className="absolute inset-0 flex flex-col gap-2 p-4 text-title-2 font-semibold text-label">
              <span>Data Structures</span>
              <span className="text-accent-text">Midterm</span>
              <span className="text-label-secondary">CS-201</span>
            </div>
            <div className="material-fluted absolute inset-x-0 top-10 flex h-14 items-center px-4 text-footnote text-label-secondary">
              material-fluted: the top bar once scrolled
            </div>
          </div>
        </div>
      </Section>

      <Section title="Four themes" description="Every token is set in light, dark, sepia and contrast. Each panel is its own themed subtree.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ThemePanel theme="light" label="Light" />
          <ThemePanel theme="dark" label="Dark" />
          <ThemePanel theme="sepia" label="Sepia" />
          <ThemePanel theme="contrast" label="Contrast" />
        </div>
      </Section>

      <Section title="Empty-state art" description="Marble twins in light and sepia, glass twins in dark. Until a file lands, the icon holds its place at the same size.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ART.map((a) => (
            <EmptyState key={a.art} size="sm" art={a.art} icon={a.icon} title={a.title} description={`art="${a.art}"`} />
          ))}
        </div>
        <EmptyState
          art="athena"
          icon={<WifiOff />}
          title="Can’t reach Athena"
          description="The server didn’t respond. Your work is safe; check your connection and try again."
        />
      </Section>
    </>
  );
}

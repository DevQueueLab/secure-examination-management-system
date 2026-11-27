import type { ProvenanceSummary } from '@athena/shared';
import type { Tone } from '@/components/ui/badge';
import type { FinalComposition, IndicatorLevel, ReviewPriority } from './types';

export const PRIORITY_LABEL: Record<ReviewPriority, string> = {
  high: 'Review first',
  medium: 'Worth a look',
  low: 'Minor signals',
  none: 'Nothing notable',
};

export const PRIORITY_TONE: Record<ReviewPriority, Tone> = { high: 'danger', medium: 'warning', low: 'info', none: 'neutral' };
export const LEVEL_TONE: Record<IndicatorLevel, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
export const LEVEL_LABEL: Record<IndicatorLevel, string> = { high: 'Strong', medium: 'Medium', low: 'Minor' };

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export const pct = (share: number) => `${Math.round(share * 100)}%`;
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Written over 23 min, 2 pastes (612 chars), 71% of the final text pasted" */
export function provenanceLine(summary: ProvenanceSummary, composition: FinalComposition | null): string {
  const parts = [`Written over ${duration(summary.spanMs)}`];
  parts.push(summary.pasteCount ? `${count(summary.pasteCount, 'paste')} (${count(summary.pastedChars, 'char')})` : 'No pastes');
  if (summary.burstCount) parts.push(`${count(summary.burstCount, 'burst')} (${count(summary.burstChars, 'char')})`);
  if (composition && composition.total > 0) {
    if (composition.pasted > 0) parts.push(`${pct(composition.pasted / composition.total)} of the final text pasted`);
    if (composition.burst > 0) parts.push(`${pct(composition.burst / composition.total)} inserted in bursts`);
    if (composition.pasted === 0 && composition.burst === 0) parts.push('all of the final text typed');
  } else if (!composition && summary.externalShare > 0) {
    parts.push(`${pct(summary.externalShare)} of everything entered came from pastes or bursts`);
  }
  return parts.join(', ');
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

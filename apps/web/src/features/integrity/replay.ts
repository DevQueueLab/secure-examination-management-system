import type { AnswerProvenance, ProvenanceOp, ProvenanceOrigin } from '@athena/shared';

/**
 * Client-side replay of an authorship log, tuned for watching rather than for exactness of timing.
 *
 * Positions are in op units: 3.5 means ops 0..2 applied and op 3 half way (a typed run reveals half its
 * characters). Playback time is compressed per op (typing at a readable pace, a beat on every paste, idle
 * gaps removed), while labels keep the real clock. Checkpoints every few ops keep scrubbing cheap.
 */

const ORIGIN: Record<'i' | 'p' | 'b', ProvenanceOrigin> = { i: 'typed', p: 'pasted', b: 'burst' };
const CHECKPOINT_EVERY = 24;

export interface ReplaySegment {
  text: string;
  origin: ProvenanceOrigin;
  /** Inserted by the op being played, when that op is a paste or burst. */
  fresh: boolean;
}

export interface ReplayFrame {
  segments: ReplaySegment[];
  /** Caret offset in characters. */
  caret: number;
  /** Index of the op in progress (ops.length at the end). */
  opIndex: number;
  /** Real time of that op, ms since the first edit. */
  t: number;
  length: number;
}

export interface WaveBar {
  index: number;
  kind: ProvenanceOp[1];
  size: number;
  t: number;
}

interface State {
  chars: string[];
  origins: ProvenanceOrigin[];
  ops: number[];
}

const clone = (s: State): State => ({ chars: [...s.chars], origins: [...s.origins], ops: [...s.ops] });

function apply(s: State, op: ProvenanceOp, index: number, fraction = 1): number {
  const [, kind, pos, payload] = op;
  const at = Math.min(pos, s.chars.length);
  if (kind === 'd') {
    const len = typeof payload === 'number' ? payload : 0;
    if (fraction >= 0.5) {
      s.chars.splice(at, len);
      s.origins.splice(at, len);
      s.ops.splice(at, len);
    }
    return at;
  }
  const all = typeof payload === 'string' ? [...payload] : [];
  const take = kind === 'i' ? Math.ceil(all.length * Math.min(1, fraction)) : fraction > 0.08 ? all.length : 0;
  const text = all.slice(0, take);
  s.chars.splice(at, 0, ...text);
  s.origins.splice(at, 0, ...text.map(() => ORIGIN[kind]));
  s.ops.splice(at, 0, ...text.map(() => index));
  return at + text.length;
}

/** Compressed playback duration of each op, in ms at 1×. */
function durationOf(op: ProvenanceOp): number {
  const [, kind, , payload] = op;
  if (kind === 'd') return Math.min(700, Math.max(160, (typeof payload === 'number' ? payload : 0) * 14));
  if (kind === 'p' || kind === 'b') return 1100;
  const n = typeof payload === 'string' ? [...payload].length : 0;
  return Math.min(2600, Math.max(140, n * 38));
}

export interface Replay {
  ops: ProvenanceOp[];
  starts: number[];
  durations: number[];
  /** Total playback ms at 1×. */
  total: number;
  bars: WaveBar[];
  frameAt(position: number): ReplayFrame;
  /** Playback ms at 1× for a position, and back. */
  timeOf(position: number): number;
  positionAt(ms: number): number;
}

export function buildReplay(p: AnswerProvenance): Replay {
  const ops = p.ops;
  const durations = ops.map(durationOf);
  const starts: number[] = [];
  let acc = 0;
  for (const d of durations) {
    starts.push(acc);
    acc += d;
  }
  const total = acc;

  const checkpoints: State[] = [{ chars: [], origins: [], ops: [] }];
  const running: State = { chars: [], origins: [], ops: [] };
  ops.forEach((op, i) => {
    apply(running, op, i);
    if ((i + 1) % CHECKPOINT_EVERY === 0) checkpoints.push(clone(running));
  });

  const bars: WaveBar[] = ops.map((op, index) => ({
    index,
    kind: op[1],
    size: typeof op[3] === 'number' ? op[3] : [...op[3]].length,
    t: op[0],
  }));

  function frameAt(position: number): ReplayFrame {
    const clamped = Math.max(0, Math.min(ops.length, position));
    const whole = Math.floor(clamped);
    const fraction = clamped - whole;
    const base = Math.min(Math.floor(whole / CHECKPOINT_EVERY), checkpoints.length - 1);
    const s = clone(checkpoints[base]!);
    let caret = s.chars.length;
    for (let i = base * CHECKPOINT_EVERY; i < whole; i++) caret = apply(s, ops[i]!, i);
    const current = whole < ops.length ? ops[whole]! : null;
    if (current && fraction > 0) caret = apply(s, current, whole, fraction);
    const freshOp = current && fraction > 0 && (current[1] === 'p' || current[1] === 'b') ? whole : -1;

    const segments: ReplaySegment[] = [];
    for (let i = 0; i < s.chars.length; i++) {
      const origin = s.origins[i]!;
      const fresh = s.ops[i] === freshOp;
      const last = segments.at(-1);
      if (last && last.origin === origin && last.fresh === fresh) last.text += s.chars[i];
      else segments.push({ text: s.chars[i]!, origin, fresh });
    }
    const opIndex = current ? whole : ops.length;
    const t = current ? current[0] : (ops.at(-1)?.[0] ?? 0);
    return { segments, caret, opIndex, t, length: s.chars.length };
  }

  function timeOf(position: number): number {
    const clamped = Math.max(0, Math.min(ops.length, position));
    const whole = Math.floor(clamped);
    if (whole >= ops.length) return total;
    return starts[whole]! + durations[whole]! * (clamped - whole);
  }

  function positionAt(ms: number): number {
    if (ms <= 0) return 0;
    if (ms >= total) return ops.length;
    let lo = 0;
    let hi = ops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= ms) lo = mid;
      else hi = mid - 1;
    }
    return lo + (ms - starts[lo]!) / durations[lo]!;
  }

  return { ops, starts, durations, total, bars, frameAt, timeOf, positionAt };
}

/** mm:ss (or h:mm:ss) for real time since the first edit. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

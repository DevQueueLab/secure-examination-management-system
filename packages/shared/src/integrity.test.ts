import { describe, expect, it } from 'vitest';
import {
  ProvenanceRecorder,
  decodeFingerprints,
  encodeFingerprint,
  hasFingerprintTrace,
  replayProvenance,
  stripFingerprints,
  summarizeProvenance,
  weaveFingerprint,
} from './integrity';

/** Feeds a sequence of texts through a recorder, one keystroke-sized change at a time. */
function typeInto(rec: ProvenanceRecorder, from: string, to: string, now: { t: number }) {
  let text = from;
  for (const ch of to) {
    rec.record(text, text + ch, { now: (now.t += 120) });
    text += ch;
  }
  return text;
}

describe('ProvenanceRecorder', () => {
  it('counts typed, pasted and burst characters and coalesces typing', () => {
    const rec = new ProvenanceRecorder();
    const clock = { t: 1000 };
    let text = typeInto(rec, '', 'Binary search halves ', clock);
    const pasted = 'the interval on every step, so it runs in logarithmic time.';
    rec.record(text, text + pasted, { pasted: true, now: (clock.t += 500) });
    text += pasted;
    const burst = ' It requires sorted input and random access to the elements in the collection.';
    rec.record(text, text + burst, { now: (clock.t += 300) });
    text += burst;

    const p = rec.snapshot();
    expect(p.typedChars).toBe('Binary search halves '.length);
    expect(p.pastedChars).toBe(pasted.length);
    expect(p.burstChars).toBe(burst.length);
    expect(p.ops.filter((op) => op[1] === 'i')).toHaveLength(1);
    expect(replayProvenance(p).text).toBe(text);

    const summary = summarizeProvenance(p);
    expect(summary.pasteCount).toBe(1);
    expect(summary.burstCount).toBe(1);
    expect(summary.finalExternalShare).toBeCloseTo((pasted.length + burst.length) / text.length, 5);
  });

  it('replays deletions, mid-text edits and backspacing exactly', () => {
    const rec = new ProvenanceRecorder();
    const clock = { t: 0 };
    let text = typeInto(rec, '', 'O(n log n)', clock);
    for (let i = 0; i < 7; i++) {
      rec.record(text, text.slice(0, -1), { now: (clock.t += 80) });
      text = text.slice(0, -1);
    }
    text = typeInto(rec, text, ' log n)', clock);
    const next = text.slice(0, 2) + 'pasted ' + text.slice(2);
    rec.record(text, next, { pasted: true, now: (clock.t += 50) });
    text = next;

    const frame = replayProvenance(rec.snapshot());
    expect(frame.text).toBe(text);
    expect(frame.segments.map((s) => s.origin)).toEqual(['typed', 'pasted', 'typed']);
  });

  it('continues an earlier snapshot after a reload', () => {
    const first = new ProvenanceRecorder();
    const text = typeInto(first, '', 'Hello', { t: 0 });
    const resumed = new ProvenanceRecorder(first.snapshot());
    resumed.record(text, text + ' world', { pasted: true, now: 50_000 });
    const p = resumed.snapshot();
    expect(replayProvenance(p).text).toBe('Hello world');
    expect(p.ops.at(-1)![0]).toBeGreaterThanOrEqual(p.ops[0]![0]);
  });
});

describe('paper fingerprints', () => {
  it('round-trips through text and survives surrounding edits', () => {
    const woven = weaveFingerprint('A ball is dropped from 20 m. Find its speed at impact.', '7F3K9Q');
    expect(stripFingerprints(woven)).toBe('A ball is dropped from 20 m. Find its speed at impact.');
    const leaked = `Q3 from today's paper >> ${woven.slice(0, 70)} ... (forwarded)`;
    expect(decodeFingerprints(leaked)).toEqual(['7F3K9Q']);
  });

  it('rejects damaged payloads but still reports a trace', () => {
    const mark = encodeFingerprint('ABC123');
    const damaged = mark.slice(0, 5) + mark.slice(6);
    expect(decodeFingerprints(damaged)).toEqual([]);
    expect(hasFingerprintTrace(damaged)).toBe(true);
    expect(hasFingerprintTrace('plain text')).toBe(false);
  });

  it('never weaves inside math or code', () => {
    const stem = 'Evaluate $x = 3. y$ where `a. b` holds. Then simplify.';
    const woven = weaveFingerprint(stem, 'ZZ99XX');
    const at = woven.indexOf('⁣');
    expect(woven.slice(0, at)).toBe('Evaluate $x = 3. y$ where `a. b` holds.');
  });
});

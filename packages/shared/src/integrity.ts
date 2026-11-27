import { z } from 'zod';

/*
 * Integrity primitives shared by the exam workspace (which produces them) and the staff tools (which read them).
 *
 * 1. Authorship provenance (IC-5.1): how a written answer came to be, typed, pasted or inserted in one burst,
 *    with a compact replay log. Captured only inside the answer box: no camera, microphone or screen capture.
 *    It is context for a human reviewer and never changes a score by itself.
 * 2. Paper fingerprints (IC-5.5): an invisible per-attempt code woven into question text, so a leaked copy
 *    of a live paper can be traced back to the attempt it came from.
 */

// ---------------------------------------------------------------------------------------------------------
// Authorship provenance
// ---------------------------------------------------------------------------------------------------------

/** i = typed, p = pasted, b = burst (a large insert with no paste event: autofill, dictation or a tool), d = delete. */
export const PROVENANCE_OP_KINDS = ['i', 'p', 'b', 'd'] as const;
export type ProvenanceOpKind = (typeof PROVENANCE_OP_KINDS)[number];

/** [ms since first edit, kind, position, inserted text | deleted length] */
export type ProvenanceOp = [t: number, kind: ProvenanceOpKind, pos: number, payload: string | number];

/** An insert longer than this without a paste event is recorded as a burst. */
export const PROVENANCE_BURST_CHARS = 40;
export const PROVENANCE_MAX_OPS = 600;
export const PROVENANCE_MAX_TEXT = 40_000;
/** Consecutive typing within this window at the caret extends the previous op instead of adding one. */
const COALESCE_MS = 4_000;

const opSchema = z.tuple([
  z.number().int().min(0),
  z.enum(PROVENANCE_OP_KINDS),
  z.number().int().min(0),
  z.union([z.string().max(PROVENANCE_MAX_TEXT), z.number().int().min(0)]),
]);

const spanSchema = z.object({ t: z.number().int().min(0), len: z.number().int().min(0) });

export const answerProvenanceSchema = z.object({
  v: z.literal(1),
  typedChars: z.number().int().min(0),
  pastedChars: z.number().int().min(0),
  burstChars: z.number().int().min(0),
  deletedChars: z.number().int().min(0),
  pastes: z.array(spanSchema).max(200),
  bursts: z.array(spanSchema).max(200),
  ops: z.array(opSchema).max(PROVENANCE_MAX_OPS),
  /** True once the replay log hit its cap; the counters above stay exact regardless. */
  truncated: z.boolean(),
  /** Milliseconds between the first and the latest edit. */
  spanMs: z.number().int().min(0),
});
export type AnswerProvenance = z.infer<typeof answerProvenanceSchema>;

export function emptyProvenance(): AnswerProvenance {
  return {
    v: 1,
    typedChars: 0,
    pastedChars: 0,
    burstChars: 0,
    deletedChars: 0,
    pastes: [],
    bursts: [],
    ops: [],
    truncated: false,
    spanMs: 0,
  };
}

/**
 * Records edits to one answer. Pure and framework-free: the caller passes the text before and after each
 * change, whether a paste event preceded it, and a monotonic clock reading (performance.now() is ideal).
 */
export class ProvenanceRecorder {
  private readonly state: AnswerProvenance;
  /** Clock reading at the first edit of this session, aligned so that new ops continue after stored ones. */
  private origin: number | null = null;
  private lastTypedAt = -Infinity;
  private textBudget: number;

  constructor(initial?: AnswerProvenance | null) {
    const parsed = initial ? answerProvenanceSchema.safeParse(initial) : null;
    this.state = parsed?.success ? structuredClone(parsed.data) : emptyProvenance();
    this.textBudget =
      PROVENANCE_MAX_TEXT - this.state.ops.reduce((n, op) => n + (typeof op[3] === 'string' ? op[3].length : 0), 0);
  }

  record(prev: string, next: string, opts: { pasted?: boolean; now: number }): void {
    if (prev === next) return;
    if (this.origin === null) this.origin = opts.now - this.state.spanMs;
    const t = Math.max(0, Math.round(opts.now - this.origin));
    this.state.spanMs = Math.max(this.state.spanMs, t);

    let start = 0;
    const max = Math.min(prev.length, next.length);
    while (start < max && prev[start] === next[start]) start++;
    let end = 0;
    while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;

    const deleted = prev.length - start - end;
    const inserted = next.slice(start, next.length - end);

    if (deleted > 0) {
      this.state.deletedChars += deleted;
      this.pushDelete(t, start, deleted);
    }
    if (inserted.length > 0) {
      const kind: ProvenanceOpKind = opts.pasted ? 'p' : inserted.length > PROVENANCE_BURST_CHARS ? 'b' : 'i';
      if (kind === 'p') {
        this.state.pastedChars += inserted.length;
        if (this.state.pastes.length < 200) this.state.pastes.push({ t, len: inserted.length });
      } else if (kind === 'b') {
        this.state.burstChars += inserted.length;
        if (this.state.bursts.length < 200) this.state.bursts.push({ t, len: inserted.length });
      } else {
        this.state.typedChars += inserted.length;
      }
      this.pushInsert(t, kind, start, inserted);
    }
  }

  snapshot(): AnswerProvenance {
    return structuredClone(this.state);
  }

  private pushDelete(t: number, pos: number, len: number) {
    const last = this.state.ops.at(-1);
    // Backspace (pos moves left) and forward-delete (pos stays) extend the previous delete.
    if (last && last[1] === 'd' && typeof last[3] === 'number' && (pos + len === last[2] || pos === last[2])) {
      last[2] = Math.min(pos, last[2]);
      last[3] += len;
      return;
    }
    this.push([t, 'd', pos, len]);
  }

  private pushInsert(t: number, kind: ProvenanceOpKind, pos: number, text: string) {
    const last = this.state.ops.at(-1);
    const extendsTyping =
      kind === 'i' &&
      last?.[1] === 'i' &&
      typeof last[3] === 'string' &&
      last[2] + last[3].length === pos &&
      t - this.lastTypedAt <= COALESCE_MS;
    if (kind === 'i') this.lastTypedAt = t;
    if (this.textBudget < text.length) {
      this.state.truncated = true;
      return;
    }
    this.textBudget -= text.length;
    if (extendsTyping && last) {
      last[3] = (last[3] as string) + text;
      return;
    }
    this.push([t, kind, pos, text]);
  }

  private push(op: ProvenanceOp) {
    if (this.state.truncated) return;
    if (this.state.ops.length >= PROVENANCE_MAX_OPS) {
      this.state.truncated = true;
      return;
    }
    this.state.ops.push(op);
  }
}

export type ProvenanceOrigin = 'typed' | 'pasted' | 'burst';
export interface ProvenanceSegment {
  text: string;
  origin: ProvenanceOrigin;
}
export interface ProvenanceFrame {
  /** Text after applying ops[0..index). */
  text: string;
  /** The same text split by where each character came from. */
  segments: ProvenanceSegment[];
  /** Time of the last applied op, in ms since the first edit. */
  t: number;
}

const ORIGIN_OF: Record<Exclude<ProvenanceOpKind, 'd'>, ProvenanceOrigin> = { i: 'typed', p: 'pasted', b: 'burst' };

/** Rebuilds the answer as it stood after `upTo` ops, tagging every character with its origin. */
export function replayProvenance(p: AnswerProvenance, upTo: number = p.ops.length): ProvenanceFrame {
  const chars: string[] = [];
  const origins: ProvenanceOrigin[] = [];
  let t = 0;
  for (const [opT, kind, pos, payload] of p.ops.slice(0, upTo)) {
    t = opT;
    const at = Math.min(pos, chars.length);
    if (kind === 'd') {
      const len = typeof payload === 'number' ? payload : 0;
      chars.splice(at, len);
      origins.splice(at, len);
    } else {
      const text = typeof payload === 'string' ? [...payload] : [];
      chars.splice(at, 0, ...text);
      origins.splice(at, 0, ...text.map(() => ORIGIN_OF[kind]));
    }
  }
  const segments: ProvenanceSegment[] = [];
  for (let i = 0; i < chars.length; i++) {
    const last = segments.at(-1);
    if (last && last.origin === origins[i]) last.text += chars[i];
    else segments.push({ text: chars[i]!, origin: origins[i]! });
  }
  return { text: chars.join(''), segments, t };
}

export interface ProvenanceSummary {
  /** Characters inserted by each route, in total (including later-deleted ones). */
  typedChars: number;
  pastedChars: number;
  burstChars: number;
  /** Share of all inserted characters that were pasted or burst-inserted, 0..1. */
  externalShare: number;
  /** Share of the final text whose characters arrived by paste or burst, 0..1 (null when the log is truncated). */
  finalExternalShare: number | null;
  pasteCount: number;
  largestPaste: number;
  burstCount: number;
  spanMs: number;
}

export function summarizeProvenance(p: AnswerProvenance): ProvenanceSummary {
  const inserted = p.typedChars + p.pastedChars + p.burstChars;
  let finalExternalShare: number | null = null;
  if (!p.truncated) {
    const { segments, text } = replayProvenance(p);
    const external = segments.filter((s) => s.origin !== 'typed').reduce((n, s) => n + s.text.length, 0);
    finalExternalShare = text.length ? external / text.length : 0;
  }
  return {
    typedChars: p.typedChars,
    pastedChars: p.pastedChars,
    burstChars: p.burstChars,
    externalShare: inserted ? (p.pastedChars + p.burstChars) / inserted : 0,
    finalExternalShare,
    pasteCount: p.pastes.length,
    largestPaste: p.pastes.reduce((m, s) => Math.max(m, s.len), 0),
    burstCount: p.bursts.length,
    spanMs: p.spanMs,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Paper fingerprints
// ---------------------------------------------------------------------------------------------------------

/** Four invisible characters carry two bits each; two more frame the payload. */
const ZW_DIGITS = ['​', '‌', '‍', '⁠'] as const;
const ZW_START = '⁣';
const ZW_END = '⁤';
const ZW_ANY = /[​‌‍⁠⁣⁤]/g;
const ZW_FRAME = /⁣([​‌‍⁠]+)⁤/g;

/** Encodes an ASCII attempt fingerprint (e.g. "7F3K9Q") as an invisible string with a checksum byte. */
export function encodeFingerprint(code: string): string {
  const bytes = [...code].map((ch) => ch.charCodeAt(0) & 0x7f);
  const checksum = bytes.reduce((sum, b) => (sum + b) & 0xff, 0);
  const digits = [...bytes, checksum].flatMap((b) => [(b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3]);
  return ZW_START + digits.map((d) => ZW_DIGITS[d]).join('') + ZW_END;
}

/** Every distinct, checksum-valid fingerprint found in a piece of text. */
export function decodeFingerprints(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ZW_FRAME)) {
    const digits = [...match[1]!].map((ch) => ZW_DIGITS.indexOf(ch as (typeof ZW_DIGITS)[number]));
    if (digits.length < 8 || digits.length % 4 !== 0) continue;
    const bytes: number[] = [];
    for (let i = 0; i < digits.length; i += 4) bytes.push((digits[i]! << 6) | (digits[i + 1]! << 4) | (digits[i + 2]! << 2) | digits[i + 3]!);
    const checksum = bytes.pop()!;
    if (bytes.reduce((sum, b) => (sum + b) & 0xff, 0) !== checksum) continue;
    found.add(String.fromCharCode(...bytes));
  }
  return [...found];
}

/** True when the text still carries any of our invisible characters (even a damaged fingerprint). */
export function hasFingerprintTrace(text: string): boolean {
  return new RegExp(ZW_ANY.source).test(text);
}

export function stripFingerprints(text: string): string {
  return text.replace(ZW_ANY, '');
}

/**
 * Inserts the fingerprint after the first sentence of a markdown question stem, or at the end of a short one.
 * Never inside math ($…$, $$…$$) or code (`…`, ```…```), where it could change how the stem renders.
 */
export function weaveFingerprint(stem: string, code: string): string {
  const mark = encodeFingerprint(code);
  const at = firstSentenceEnd(stem);
  return at === -1 ? stem + mark : stem.slice(0, at) + mark + stem.slice(at);
}

/** Index just after the first sentence-ending punctuation that sits outside math and code, or -1. */
function firstSentenceEnd(text: string): number {
  let fence: '$$' | '$' | '```' | '`' | null = null;
  for (let i = 0; i < text.length; i++) {
    if (fence) {
      if (text.startsWith(fence, i)) {
        i += fence.length - 1;
        fence = null;
      }
      continue;
    }
    const opener = (['```', '$$', '`', '$'] as const).find((f) => text.startsWith(f, i));
    if (opener) {
      fence = opener;
      i += opener.length - 1;
      continue;
    }
    const ch = text[i];
    if ((ch === '.' || ch === '?' || ch === '!') && (i + 1 === text.length || /\s/.test(text[i + 1]!))) return i + 1;
  }
  return -1;
}

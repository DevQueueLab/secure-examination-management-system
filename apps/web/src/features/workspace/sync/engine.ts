import type {
  AnnouncementView,
  AnswerChange,
  AttemptEventType,
  AttemptItemView,
  AttemptStatus,
  AttemptView,
  ClarificationView,
  OfflineJournal,
  SubmissionReceipt,
  SubmitReason,
  SyncRequest,
  SyncResponse,
  WorkingResponse,
} from '@athena/shared';
import { ERROR_CODES, ProvenanceRecorder, syncRequestSchema } from '@athena/shared';
import { ANSWER_LIMITS, normalizeResponse } from '../lib/answers';
import { ServerClock } from './clock';
import { journalChain } from './hash-chain';
import { MemoryJournal, type AnswerRecord, type AttemptMeta, type EventRecord, type Journal, type JournalSnapshot, type OfflineUpload, type ScratchpadRecord } from './journal';
import { emptyAnswer, mergeAnswers, mergeScratchpads, provenanceToWire } from './merge';

/*
 * The attempt engine: local-first autosave, heartbeat, server time and the end-of-exam transitions.
 * Framework-free (React reads it through useSyncExternalStore) and free of `@/` imports so it runs under tests
 * with a fake transport, fake timers and a memory journal.
 *
 * Invariants
 *  1. Every change is journaled before anything touches the network.
 *  2. Single flight: one /sync at a time; calls made meanwhile coalesce into one follow-up.
 *  3. An acknowledgement marks the revision that was SENT as synced, never the current one. Edits made while a
 *     request was in flight stay dirty and go out next.
 *  4. One definition of dirty (isDirty): revision > syncedRevision, not refused at that revision, not held for
 *     review. Events leave the queue by id, only after a 2xx.
 *  5. "Closed" arrives as a 2xx with status !== in_progress or a 'closed' rejection, or as 409 ATTEMPT_CLOSED.
 *     Both take one path (handleClosed), which never marks dirty answers synced and never enters backoff. Local
 *     work is cleared only after the offline journal is acknowledged and the receipt is in hand.
 *  6. Every outgoing batch is validated against the shared schema first; an entry that would fail is
 *     quarantined by its issue path, so one bad field cannot fail every heartbeat.
 *  7. A disposed engine never writes: every await is followed by a disposed check.
 */

export type EnginePhase = 'booting' | 'ready' | 'sealed' | 'finalizing' | 'submitted' | 'locked' | 'error';
export type SyncState = 'idle' | 'saving' | 'offline' | 'reconnecting' | 'failed';
export type LockKind = 'device' | 'tab';
export type ClosingStep = 'waiting' | 'uploading' | 'receipt';
export type FlushReason =
  | 'change'
  | 'heartbeat'
  | 'retry'
  | 'online'
  | 'hidden'
  | 'visible'
  | 'boot'
  | 'deadline'
  | 'poll'
  | 'submit'
  | 'push'
  | 'manual';

export interface TransportError {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export interface Transport {
  getAttempt(attemptId: string): Promise<AttemptView>;
  sync(attemptId: string, body: SyncRequest): Promise<SyncResponse>;
  submit(attemptId: string, body: SyncRequest & { confirm: true }): Promise<SubmissionReceipt>;
  receipt(attemptId: string): Promise<SubmissionReceipt>;
  offlineJournal(attemptId: string, body: OfflineJournal): Promise<unknown>;
  claim(attemptId: string): Promise<unknown>;
  askClarification(attemptId: string, body: { question: string; itemId?: string }): Promise<ClarificationView>;
  /** Fire-and-forget delivery that survives page unload (fetch with keepalive). */
  beacon(attemptId: string, body: SyncRequest): void;
}

export interface EngineEnv {
  perfNow: () => number;
  /** Device clock. Used only to estimate server time when booting with the API unreachable. */
  deviceNow: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  online: () => boolean;
  random: () => number;
  uuid: () => string;
}

export interface EngineOptions {
  attemptId: string;
  transport: Transport;
  openJournal: () => Promise<Journal>;
  env?: Partial<EngineEnv>;
  /** Attach window/document listeners and the cross-tab lock. Off in tests. */
  browser?: boolean;
  debounceMs?: number;
  heartbeatMs?: number;
}

export interface SyncStatus {
  state: SyncState;
  /** perfNow() of the last successful round trip. */
  lastSavedAt: number | null;
  /** perfNow() when the next automatic retry fires. */
  retryAt: number | null;
  rttMs: number | null;
  failures: number;
  dirtyAnswers: number;
  dirtyPages: number;
  pendingEvents: number;
  /** RTT above 1.5 s or repeated failures. */
  unstable: boolean;
  /** A request carrying answers or pages is in flight. */
  sending: boolean;
  online: boolean;
}

export interface EngineError {
  title: string;
  message: string;
  retryable: boolean;
}

export interface EngineSnapshot {
  phase: EnginePhase;
  lock: LockKind | null;
  error: EngineError | null;
  view: AttemptView | null;
  /** Sorted by position. Stable reference until the view changes. */
  items: AttemptItemView[];
  answers: Readonly<Record<string, AnswerRecord>>;
  scratchpads: Readonly<Record<string, ScratchpadRecord>>;
  announcements: AnnouncementView[];
  clarifications: ClarificationView[];
  current: number;
  max: number;
  deadlineAt: string | null;
  status: AttemptStatus | null;
  submitReason: SubmitReason | null;
  sealedAt: string | null;
  receipt: SubmissionReceipt | null;
  offlineUpload: OfflineUpload | null;
  closingStep: ClosingStep | null;
  finalizingSince: number | null;
  sync: SyncStatus;
  /** False when answers live in memory only (IndexedDB unavailable). */
  durable: boolean;
  /** The timer runs from a device-clock estimate until the first server response. */
  clockEstimated: boolean;
  submitting: boolean;
}

export type EngineNotice =
  | { kind: 'announcement'; announcement: AnnouncementView }
  | { kind: 'clarification'; clarification: ClarificationView }
  | { kind: 'time_extended'; deltaSeconds: number; deadlineAt: string }
  | { kind: 'unsealed' }
  | { kind: 'rejected'; itemId: string; message: string }
  | { kind: 'storage'; message: string };

export interface AnswerPatch {
  response?: Record<string, unknown> | null;
  working?: WorkingResponse | null;
  flagged?: boolean;
}

/** A change to a written field, so authorship provenance can record it. */
export interface TextEdit {
  field: 'response' | 'working';
  prev: string;
  next: string;
  /** A paste event fired just before this change. */
  pasted: boolean;
}

const DEBOUNCE_MS = 800;
const MAX_WAIT_MS = 3_000;
const HEARTBEAT_MS = 15_000;
const UNSTABLE_RTT_MS = 1_500;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 10_000;
const POLL_FAST_WINDOW_MS = 30_000;
const PRE_DEADLINE_FLUSH_MS = 3_000;
const BEACON_MAX_BYTES = 60_000;
const LIMITS = { answers: 100, events: 200, scratchpads: 20, viewed: 100, journal: 200 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDirty(rec: AnswerRecord): boolean {
  if (rec.heldForReview) return false;
  if (rec.revision <= rec.syncedRevision) return false;
  return !(rec.rejected && rec.rejected.revision === rec.revision);
}

export function isPageDirty(page: ScratchpadRecord): boolean {
  return page.revision > page.syncedRevision;
}

export function toTransportError(error: unknown): TransportError {
  if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
    const e = error as { status: unknown; code: unknown; message?: unknown; fields?: unknown };
    return {
      status: typeof e.status === 'number' ? e.status : 0,
      code: typeof e.code === 'string' ? e.code : 'UNKNOWN',
      message: typeof e.message === 'string' ? e.message : 'Request failed',
      fields: e.fields && typeof e.fields === 'object' ? (e.fields as Record<string, string>) : undefined,
    };
  }
  return { status: 0, code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Network error' };
}

const isNetwork = (e: TransportError) => e.status === 0 || e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT' || e.code === 'ABORTED';
const isRetryable = (e: TransportError) => isNetwork(e) || e.status >= 500 || e.status === 429 || e.status === 408;
const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : 0)));

function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function normalizeWorking(working: WorkingResponse | null): WorkingResponse | null | false {
  if (!working) return null;
  const text = working.text ?? '';
  const pages = (working.scratchPages ?? []).filter((p) => typeof p === 'string' && p.length <= 64).slice(0, 10);
  if (!text.trim() && pages.length === 0) return null;
  if (text.length > ANSWER_LIMITS.working) return false;
  return { text, scratchPages: pages };
}

function newestAnnouncementId(list: AnnouncementView[]): string | undefined {
  let best: AnnouncementView | undefined;
  for (const a of list) if (!best || Date.parse(a.createdAt) > Date.parse(best.createdAt)) best = a;
  return best && UUID.test(best.id) ? best.id : undefined;
}

interface SentRev {
  itemId: string;
  revision: number;
}

interface Batch {
  body: SyncRequest;
  sent: { answers: SentRev[]; events: string[]; scratchpads: { pageKey: string; revision: number }[]; viewed: string[] };
  empty: boolean;
  truncated: boolean;
}

const EMPTY_BODY: SyncRequest = { answers: [], events: [], scratchpads: [], viewed: [] };

export class AttemptEngine {
  readonly attemptId: string;
  readonly clock: ServerClock;
  private readonly transport: Transport;
  private readonly openJournalFn: () => Promise<Journal>;
  private readonly env: EngineEnv;
  private readonly browser: boolean;
  private readonly debounceMs: number;
  private readonly heartbeatMs: number;

  private journal: Journal | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: EngineNotice) => void>();
  private snapshot: EngineSnapshot;
  private disposed = false;
  private started = false;

  // attempt state
  private phase: EnginePhase = 'booting';
  private lock: LockKind | null = null;
  private error: EngineError | null = null;
  private view: AttemptView | null = null;
  private cachedView: AttemptView | null = null;
  private items: AttemptItemView[] = [];
  private answers: Record<string, AnswerRecord> = {};
  private scratchpads: Record<string, ScratchpadRecord> = {};
  private events: EventRecord[] = [];
  private viewed: string[] = [];
  private readonly viewedOnce = new Set<string>();
  private announcements: AnnouncementView[] = [];
  private clarifications: ClarificationView[] = [];
  private readonly readSet = new Set<string>();
  private current = 0;
  private max = 0;
  private deadlineAt: string | null = null;
  private status: AttemptStatus | null = null;
  private submitReason: SubmitReason | null = null;
  private sealedAt: string | null = null;
  private receipt: SubmissionReceipt | null = null;
  private offlineUpload: OfflineUpload | null = null;
  private closingStep: ClosingStep | null = null;
  private lastServerSync: string | null = null;
  private deviceOffsetMs: number | null = null;
  private connected = false;
  private finalizingSince: number | null = null;
  private submitting = false;

  // sync machinery
  private syncState: SyncState = 'idle';
  private lastSavedAt: number | null = null;
  private retryAt: number | null = null;
  private rttMs: number | null = null;
  private failures = 0;
  private sending = false;
  private running: Promise<boolean> | null = null;
  private pending: Promise<boolean> | null = null;
  private debounceTimer: unknown = null;
  private firstQueuedAt: number | null = null;
  private retryTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private tickTimer: unknown = null;
  private pollTimer: unknown = null;
  private loopsStarted = false;
  private seq = 0;
  private readonly recorders = new Map<string, ProvenanceRecorder>();
  private closing: Promise<void> | null = null;
  private submitPromise: Promise<SubmissionReceipt> | null = null;
  private deadlineHandling = false;
  private preDeadlineFlushed = false;
  private readonly wakers = new Set<() => void>();
  private releaseTabLock: (() => void) | null = null;
  private tabLockHeld = false;
  private offlineSince: number | null = null;
  private readonly cleanup: (() => void)[] = [];
  private listenersInstalled = false;
  private badBatchStrikes = 0;

  constructor(opts: EngineOptions) {
    this.attemptId = opts.attemptId;
    this.transport = opts.transport;
    this.openJournalFn = opts.openJournal;
    this.browser = opts.browser ?? false;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.env = {
      perfNow: () => performance.now(),
      deviceNow: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      random: () => Math.random(),
      uuid: () => crypto.randomUUID(),
      ...opts.env,
    };
    this.clock = new ServerClock(this.env.perfNow);
    this.snapshot = this.compose();
  }

  // ------------------------------------------------------------------ store API

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  onNotice(listener: (notice: EngineNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  }

  private emit() {
    if (this.disposed) return;
    this.snapshot = this.compose();
    for (const listener of this.listeners) listener();
  }

  private notify(notice: EngineNotice) {
    if (this.disposed) return;
    for (const listener of this.noticeListeners) listener(notice);
  }

  private compose(): EngineSnapshot {
    let dirtyAnswers = 0;
    for (const rec of Object.values(this.answers)) if (isDirty(rec)) dirtyAnswers++;
    let dirtyPages = 0;
    for (const page of Object.values(this.scratchpads)) if (isPageDirty(page)) dirtyPages++;
    return {
      phase: this.phase,
      lock: this.lock,
      error: this.error,
      view: this.view,
      items: this.items,
      answers: this.answers,
      scratchpads: this.scratchpads,
      announcements: this.announcements,
      clarifications: this.clarifications,
      current: this.current,
      max: this.max,
      deadlineAt: this.deadlineAt,
      status: this.status,
      submitReason: this.submitReason,
      sealedAt: this.sealedAt,
      receipt: this.receipt,
      offlineUpload: this.offlineUpload,
      closingStep: this.closingStep,
      finalizingSince: this.finalizingSince,
      sync: {
        state: this.syncState,
        lastSavedAt: this.lastSavedAt,
        retryAt: this.retryAt,
        rttMs: this.rttMs,
        failures: this.failures,
        dirtyAnswers,
        dirtyPages,
        pendingEvents: this.events.length,
        unstable: (this.rttMs ?? 0) > UNSTABLE_RTT_MS || this.failures >= 2,
        sending: this.sending,
        online: this.env.online(),
      },
      durable: this.journal?.durable ?? true,
      clockEstimated: this.clock.estimated,
      submitting: this.submitting,
    };
  }

  // ------------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const granted = await this.acquireTabLock(false);
    if (this.disposed) return;
    if (!granted) {
      this.phase = 'locked';
      this.lock = 'tab';
      this.emit();
      return;
    }
    await this.openAndLoad();
    if (this.disposed) return;
    this.installListeners();
    if (this.receipt) {
      this.phase = 'submitted';
      this.emit();
      return;
    }
    await this.connectOrBootOffline();
  }

  /** After a fatal boot error ("Try again"). */
  async retry(): Promise<void> {
    if (this.disposed) return;
    this.error = null;
    this.phase = 'booting';
    this.emit();
    if (!this.journal) await this.openAndLoad();
    if (this.disposed) return;
    await this.connectOrBootOffline();
  }

  /** "Continue on this device" after the server reported the attempt open elsewhere. */
  async claimDevice(): Promise<void> {
    await this.transport.claim(this.attemptId);
    if (this.disposed) return;
    this.lock = null;
    this.phase = 'booting';
    this.connected = false;
    this.emit();
    await this.connectOrBootOffline();
  }

  /** "Continue in this tab" after another tab of this browser took the attempt. */
  async reclaimTab(): Promise<void> {
    const granted = await this.acquireTabLock(true);
    if (!granted || this.disposed) return;
    // The other tab journaled newer work: start again from the journal.
    if (this.journal) this.loadLocal(await this.journal.load(this.attemptId));
    else await this.openAndLoad();
    if (this.disposed) return;
    this.installListeners();
    this.lock = null;
    this.phase = 'booting';
    this.connected = false;
    this.emit();
    if (this.receipt) {
      this.phase = 'submitted';
      this.emit();
      return;
    }
    await this.connectOrBootOffline();
  }

  dispose(): void {
    if (this.disposed) return;
    // The journal already holds everything; this only gives the server a head start.
    if (this.phase === 'ready') this.sendBeacon();
    this.disposed = true;
    for (const timer of [this.debounceTimer, this.retryTimer, this.heartbeatTimer, this.tickTimer, this.pollTimer]) {
      if (timer !== null) this.env.clearTimeout(timer);
    }
    this.debounceTimer = this.retryTimer = this.heartbeatTimer = this.tickTimer = this.pollTimer = null;
    for (const fn of this.cleanup.splice(0)) fn();
    for (const wake of [...this.wakers]) wake();
    this.releaseTabLock?.();
    this.releaseTabLock = null;
    this.listeners.clear();
    this.noticeListeners.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private async openAndLoad() {
    try {
      this.journal = await this.openJournalFn();
    } catch {
      this.journal = new MemoryJournal();
    }
    if (this.disposed) return;
    this.journal.onError = () => this.notify({ kind: 'storage', message: 'This device could not store your latest change. Keep your connection on.' });
    const snap = await this.journal.load(this.attemptId);
    if (this.disposed) return;
    this.loadLocal(snap);
  }

  private loadLocal(snap: JournalSnapshot) {
    this.answers = Object.fromEntries(snap.answers.map((a) => [a.itemId, a]));
    this.scratchpads = Object.fromEntries(snap.scratchpads.map((p) => [p.pageKey, p]));
    this.events = snap.events;
    this.seq = snap.events.reduce((m, e) => Math.max(m, e.seq), 0);
    this.recorders.clear();
    const meta = snap.meta;
    if (meta) {
      this.current = meta.current;
      this.max = meta.max;
      this.sealedAt = meta.sealedAt;
      this.receipt = meta.receipt;
      this.offlineUpload = meta.offlineUpload;
      this.lastServerSync = meta.lastServerSync;
      this.deviceOffsetMs = meta.deviceOffsetMs;
      this.cachedView = meta.view;
      meta.readAnnouncements.forEach((id) => this.readSet.add(id));
      if (meta.receipt) {
        this.status = meta.receipt.status;
        this.submitReason = meta.receipt.submitReason;
        if (meta.view) this.adoptView(meta.view);
      }
    }
  }

  private async connectOrBootOffline() {
    const ok = await this.connect(false);
    if (ok || this.disposed) return;
    if (this.phase === 'locked' || this.phase === 'error' || this.phase === 'submitted' || this.phase === 'finalizing') return;
    if (this.cachedView) {
      this.bootOffline(this.cachedView);
      return;
    }
    this.fail({
      title: 'Can’t reach Athena',
      message: 'Check your connection, then try again. Nothing you have done is lost.',
      retryable: true,
    });
  }

  private bootOffline(view: AttemptView) {
    this.adoptView(view);
    this.answers = Object.fromEntries(mergeAnswers(this.attemptId, this.items, [], Object.values(this.answers)).map((a) => [a.itemId, a]));
    const serverEstimate = this.deviceOffsetMs !== null ? this.env.deviceNow() - this.deviceOffsetMs : this.env.deviceNow();
    this.clock.estimate(serverEstimate);
    this.phase = this.sealedAt ? 'sealed' : 'ready';
    this.markViewed();
    this.emit();
    this.startLoops();
    this.noteFailure({ status: 0, code: 'NETWORK_ERROR', message: 'offline' });
  }

  private fail(error: EngineError) {
    this.phase = 'error';
    this.error = error;
    this.emit();
  }

  /** GET the attempt and merge it with the journal. Returns false on any failure (and handles terminal ones). */
  private async connect(fromSync: boolean): Promise<boolean> {
    const sentAt = this.env.perfNow();
    let view: AttemptView;
    try {
      view = await this.transport.getAttempt(this.attemptId);
    } catch (error) {
      if (this.disposed) return false;
      const err = toTransportError(error);
      if (err.code === ERROR_CODES.SESSION_TAKEN_OVER) {
        this.lockDevice();
        return false;
      }
      if (err.status === 404 || err.status === 403) {
        this.fail({ title: 'This exam isn’t available', message: err.message || 'It may have been removed, or it belongs to another account.', retryable: false });
        return false;
      }
      if (err.status === 401) {
        this.fail({ title: 'Your session ended', message: 'Sign in again to continue. Your answers are kept on this device.', retryable: true });
        return false;
      }
      if (fromSync || this.view) this.noteFailure(err);
      return false;
    }
    if (this.disposed) return false;
    const receivedAt = this.env.perfNow();
    this.applyView(view, sentAt, receivedAt);
    this.connected = true;
    this.failures = 0;
    this.retryAt = null;
    this.syncState = 'idle';
    this.lastSavedAt = receivedAt;
    this.clearRetry();
    this.lock = null;
    this.error = null;
    this.settleAfterConnect(fromSync);
    return true;
  }

  private adoptView(view: AttemptView) {
    this.view = view;
    this.items = [...view.items].sort((a, b) => a.position - b.position);
    this.deadlineAt = this.deadlineAt ?? view.deadlineAt;
    this.status = this.status ?? view.status;
    this.submitReason = this.submitReason ?? view.submitReason;
    if (this.announcements.length === 0) this.announcements = this.withReadFlags(view.announcements);
    if (this.clarifications.length === 0) this.clarifications = view.clarifications;
    this.current = Math.min(Math.max(0, this.current), Math.max(0, this.items.length - 1));
    this.max = Math.min(Math.max(this.max, this.current), Math.max(0, this.items.length - 1));
  }

  private applyView(view: AttemptView, sentAt: number, receivedAt: number) {
    this.clock.sample(view.serverNow, sentAt, receivedAt);
    this.lastServerSync = view.serverNow;
    this.deviceOffsetMs = this.env.deviceNow() - (this.clock.now() ?? this.env.deviceNow());
    this.view = view;
    this.items = [...view.items].sort((a, b) => a.position - b.position);
    const merged = mergeAnswers(this.attemptId, this.items, view.answers, Object.values(this.answers));
    this.answers = Object.fromEntries(merged.map((a) => [a.itemId, a]));
    const pages = mergeScratchpads(this.attemptId, view.scratchpads, Object.values(this.scratchpads));
    this.scratchpads = Object.fromEntries(pages.map((p) => [p.pageKey, p]));
    for (const rec of merged) this.journal?.putAnswer(rec);
    for (const page of pages) this.journal?.putScratchpad(page);
    this.recorders.clear();
    this.announcements = this.withReadFlags(view.announcements);
    this.clarifications = view.clarifications;
    this.deadlineAt = view.deadlineAt;
    this.status = view.status;
    this.submitReason = view.submitReason;
    this.current = Math.min(Math.max(0, this.current), Math.max(0, this.items.length - 1));
    this.max = Math.min(Math.max(this.max, this.current), Math.max(0, this.items.length - 1));
    if (view.settings.navigation === 'linear') this.current = this.max;
    this.persistMeta();
  }

  private settleAfterConnect(fromSync: boolean) {
    if (this.status === 'submitted' || this.status === 'awaiting_sync') {
      this.emit();
      void this.handleClosed(this.status);
      return;
    }
    const remaining = this.clock.remainingMs(this.deadlineAt);
    if (this.sealedAt) {
      if (remaining !== null && remaining > 0) {
        this.sealedAt = null;
        this.persistMeta();
        this.notify({ kind: 'unsealed' });
      } else {
        this.phase = 'sealed';
        this.emit();
        this.startLoops();
        this.schedulePoll();
        return;
      }
    }
    if (this.phase !== 'sealed' && this.phase !== 'finalizing') this.phase = 'ready';
    this.markViewed();
    this.emit();
    this.startLoops();
    if (remaining !== null && remaining <= 0) {
      void this.onDeadline();
      return;
    }
    if (!fromSync) void this.flush('boot');
  }

  // ------------------------------------------------------------------ candidate actions

  private get linear(): boolean {
    return this.view?.settings.navigation === 'linear';
  }

  private itemIndex(itemId: string): number {
    return this.items.findIndex((i) => i.id === itemId);
  }

  canEdit(itemId: string): boolean {
    if (this.phase !== 'ready') return false;
    const index = this.itemIndex(itemId);
    if (index === -1) return false;
    return !(this.linear && index < this.max);
  }

  private recorder(itemId: string, field: TextEdit['field'], rec: AnswerRecord): ProvenanceRecorder {
    const key = `${itemId}:${field}`;
    let recorder = this.recorders.get(key);
    if (!recorder) {
      recorder = new ProvenanceRecorder(rec.provenance?.[field] ?? null);
      this.recorders.set(key, recorder);
    }
    return recorder;
  }

  setAnswer(itemId: string, patch: AnswerPatch, edit?: TextEdit): void {
    if (this.disposed || !this.canEdit(itemId)) return;
    const prev = this.answers[itemId] ?? emptyAnswer(this.attemptId, itemId);
    let provenance = prev.provenance;
    if (edit && edit.prev !== edit.next) {
      const recorder = this.recorder(itemId, edit.field, prev);
      recorder.record(edit.prev, edit.next, { pasted: edit.pasted, now: this.env.perfNow() });
      provenance = { ...(provenance ?? {}), [edit.field]: recorder.snapshot() };
    }
    const next: AnswerRecord = {
      ...prev,
      ...('response' in patch ? { response: patch.response ?? null } : {}),
      ...('working' in patch ? { working: patch.working ?? null } : {}),
      ...('flagged' in patch ? { flagged: patch.flagged === true } : {}),
      provenance,
      revision: prev.revision + 1,
      changedAt: this.clock.nowIso() ?? new Date(this.env.deviceNow()).toISOString(),
      rejected: null,
    };
    this.answers = { ...this.answers, [itemId]: next };
    this.journal?.putAnswer(next);
    this.queueFlush();
    this.emit();
  }

  toggleFlag(itemId: string): void {
    const rec = this.answers[itemId];
    this.setAnswer(itemId, { flagged: !(rec?.flagged ?? false) });
  }

  /** Time on a question, sent with its next change. Never bumps the revision. */
  trackTime(itemId: string, ms: number): void {
    if (this.disposed || ms <= 0 || this.phase !== 'ready' || this.itemIndex(itemId) === -1) return;
    const prev = this.answers[itemId] ?? emptyAnswer(this.attemptId, itemId);
    const next = { ...prev, timeSpentMs: Math.min(86_400_000, prev.timeSpentMs + ms) };
    this.answers = { ...this.answers, [itemId]: next };
    this.journal?.putAnswer(next);
  }

  setScratchpad(pageKey: string, kind: ScratchpadRecord['kind'], data: Record<string, unknown>): void {
    if (this.disposed || this.phase !== 'ready' || !pageKey || pageKey.length > 64) return;
    const prev = this.scratchpads[pageKey];
    const next: ScratchpadRecord = {
      attemptId: this.attemptId,
      pageKey,
      kind,
      data,
      revision: (prev?.revision ?? 0) + 1,
      syncedRevision: prev?.syncedRevision ?? 0,
    };
    this.scratchpads = { ...this.scratchpads, [pageKey]: next };
    this.journal?.putScratchpad(next);
    this.queueFlush(this.debounceMs * 2);
    this.emit();
  }

  /** Integrity and connectivity indicators. Journaled first, sent with the next sync. */
  logEvent(type: AttemptEventType, payload: Record<string, unknown> = {}): void {
    if (this.disposed || this.phase === 'submitted' || this.phase === 'booting' || this.phase === 'error') return;
    const id = this.env.uuid();
    const record: EventRecord = {
      attemptId: this.attemptId,
      id,
      seq: ++this.seq,
      type,
      clientTs: this.clock.nowIso() ?? new Date(this.env.deviceNow()).toISOString(),
      // `cid` lets the server drop a duplicate if a response is lost and the event is sent again.
      payload: { ...payload, cid: id },
    };
    this.events = [...this.events, record];
    this.journal?.putEvent(record);
    this.queueFlush(this.debounceMs * 2);
  }

  /** Moves to a question. Linear exams only move forward, one question at a time. */
  goTo(index: number): boolean {
    if (this.disposed || index < 0 || index >= this.items.length) return false;
    if (this.linear && (index < this.max || index > this.max + 1)) return false;
    this.current = index;
    this.max = Math.max(this.max, index);
    this.markViewed();
    this.persistMeta();
    this.emit();
    return true;
  }

  private markViewed() {
    const item = this.items[this.current];
    if (item && !this.viewedOnce.has(item.id)) {
      this.viewedOnce.add(item.id);
      if (UUID.test(item.id)) this.viewed = [...this.viewed, item.id];
    }
  }

  /**
   * Read receipts travel as `announcement_read` events through the outbox, so a receipt made offline is
   * journaled and delivered later like everything else.
   */
  markAnnouncementsRead(ids: string[]): void {
    const fresh = ids.filter((id) => !this.readSet.has(id) && UUID.test(id));
    if (fresh.length === 0) return;
    for (const id of fresh) {
      this.readSet.add(id);
      this.logEvent('announcement_read', { announcementId: id });
    }
    this.announcements = this.withReadFlags(this.announcements);
    this.persistMeta();
    this.emit();
  }

  async askClarification(question: string, itemId?: string): Promise<ClarificationView> {
    const created = await this.transport.askClarification(this.attemptId, { question, ...(itemId ? { itemId } : {}) });
    if (!this.disposed) {
      this.mergeClarifications([created]);
      this.emit();
    }
    return created;
  }

  // ------------------------------------------------------------------ pushes (socket)

  receiveAnnouncement(announcement: AnnouncementView): void {
    for (const a of this.mergeAnnouncements([announcement])) this.notify({ kind: 'announcement', announcement: a });
    this.emit();
  }

  receiveClarification(clarification: ClarificationView): void {
    for (const c of this.mergeClarifications([clarification])) this.notify({ kind: 'clarification', clarification: c });
    this.emit();
  }

  receiveTimeExtended(payload: { deadlineAt?: string }): void {
    if (payload.deadlineAt) this.updateDeadline(payload.deadlineAt);
    this.emit();
    void this.flush('push');
  }

  receiveForceSubmitted(): void {
    void this.flush('push');
  }

  /**
   * The push goes to every device in the attempt's room, including the one that just took over, so it is only
   * a prompt: ask the server, which answers 409 SESSION_TAKEN_OVER only if this device lost the attempt.
   */
  receiveSessionTakenOver(): void {
    if (this.phase === 'submitted' || this.phase === 'locked') return;
    void this.flush('push');
  }

  // ------------------------------------------------------------------ submit

  submit(): Promise<SubmissionReceipt> {
    if (this.submitPromise) return this.submitPromise;
    if (this.receipt) return Promise.resolve(this.receipt);
    this.submitPromise = (async () => {
      this.submitting = true;
      this.emit();
      try {
        await this.flush('submit');
        if (this.disposed) throw new Error('Workspace closed');
        if (this.receipt) return this.receipt;
        if (this.phase !== 'ready') {
          if (this.closing) await this.closing;
          if (this.receipt) return this.receipt;
          throw Object.assign(new Error('Time is up, so your answers are being submitted automatically.'), {
            status: 409,
            code: ERROR_CODES.ATTEMPT_CLOSED,
          });
        }
        const batch = this.buildBatch('full');
        const receipt = await this.transport.submit(this.attemptId, { ...batch.body, confirm: true });
        if (this.disposed) return receipt;
        this.acknowledge(batch, null);
        this.finishWithReceipt(receipt);
        return receipt;
      } catch (error) {
        const err = toTransportError(error);
        if (!this.disposed && err.code === ERROR_CODES.ATTEMPT_CLOSED) {
          await this.handleClosed(null);
          if (this.receipt) return this.receipt;
        }
        if (!this.disposed && err.code === ERROR_CODES.SESSION_TAKEN_OVER) this.lockDevice();
        throw error;
      } finally {
        this.submitting = false;
        this.submitPromise = null;
        this.emit();
      }
    })();
    return this.submitPromise;
  }

  private finishWithReceipt(receipt: SubmissionReceipt) {
    this.receipt = receipt;
    this.status = receipt.status;
    this.submitReason = receipt.submitReason;
    this.phase = 'submitted';
    this.closingStep = null;
    this.finalizingSince = null;
    this.clearDebounce();
    this.persistMeta();
    // A shared computer keeps nothing once the server holds the work.
    this.journal?.clearWork(this.attemptId);
    this.emit();
  }

  // ------------------------------------------------------------------ flush

  flush(reason: FlushReason = 'manual'): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (!this.running) {
      this.running = this.runSync(reason).finally(() => {
        this.running = null;
      });
      return this.running;
    }
    if (!this.pending) {
      const prev = this.running;
      this.pending = prev
        .catch(() => false)
        .then(() => {
          this.pending = null;
          return this.flush(reason);
        });
    }
    return this.pending;
  }

  private queueFlush(delay = this.debounceMs) {
    if (this.disposed) return;
    // Backoff owns the next attempt; changes ride along with it.
    if (this.retryTimer !== null) return;
    const now = this.env.perfNow();
    if (this.firstQueuedAt === null) this.firstQueuedAt = now;
    const due = Math.min(now + delay, this.firstQueuedAt + MAX_WAIT_MS);
    if (this.debounceTimer !== null) this.env.clearTimeout(this.debounceTimer);
    this.debounceTimer = this.env.setTimeout(() => {
      this.debounceTimer = null;
      this.firstQueuedAt = null;
      void this.flush('change');
    }, Math.max(0, due - now));
  }

  private clearDebounce() {
    if (this.debounceTimer !== null) this.env.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.firstQueuedAt = null;
  }

  private clearRetry() {
    if (this.retryTimer !== null) this.env.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  private async runSync(reason: FlushReason): Promise<boolean> {
    if (this.disposed || this.closing) return false;
    if (this.phase === 'locked' || this.phase === 'error' || this.phase === 'submitted' || this.phase === 'booting') return false;
    this.clearDebounce();
    if (!this.connected) {
      const ok = await this.connect(true);
      if (!ok || this.disposed) return false;
      if (this.phase !== 'ready' && this.phase !== 'sealed' && this.phase !== 'finalizing') return false;
      if (this.closing) return false;
    }
    const mode = this.phase === 'ready' ? 'full' : 'events';
    const batch = this.buildBatch(mode);
    if (batch.empty && reason === 'change') {
      this.emit();
      return true;
    }
    this.sending = batch.sent.answers.length + batch.sent.scratchpads.length > 0;
    if (this.sending && this.syncState !== 'offline') this.syncState = 'saving';
    this.emit();
    const sentAt = this.env.perfNow();
    let res: SyncResponse;
    try {
      res = await this.transport.sync(this.attemptId, batch.body);
    } catch (error) {
      this.sending = false;
      if (this.disposed) return false;
      this.onSyncError(toTransportError(error), batch);
      return false;
    }
    this.sending = false;
    if (this.disposed) return false;
    this.onSyncSuccess(res, batch, sentAt, this.env.perfNow());
    return true;
  }

  private onSyncSuccess(res: SyncResponse, batch: Batch, sentAt: number, receivedAt: number) {
    this.clock.sample(res.serverNow, sentAt, receivedAt);
    this.rttMs = Math.round(receivedAt - sentAt);
    this.deviceOffsetMs = this.env.deviceNow() - (this.clock.now() ?? this.env.deviceNow());
    this.lastServerSync = res.serverNow;
    const closedItems = this.acknowledge(batch, res);
    for (const a of this.mergeAnnouncements(res.announcements ?? [])) this.notify({ kind: 'announcement', announcement: a });
    for (const c of this.mergeClarifications(res.clarifications ?? [])) this.notify({ kind: 'clarification', clarification: c });
    this.updateDeadline(res.deadlineAt);
    this.status = res.status;
    this.failures = 0;
    this.badBatchStrikes = 0;
    this.syncState = 'idle';
    this.lastSavedAt = receivedAt;
    this.clearRetry();
    this.persistMeta();

    if (res.status !== 'in_progress') {
      this.emit();
      void this.handleClosed(res.status);
      return;
    }
    const remaining = this.clock.remainingMs(this.deadlineAt);
    if (closedItems) {
      // The server refuses writes (deadline passed) but has not closed the attempt yet.
      if (this.phase === 'ready') this.seal();
      this.schedulePoll();
      this.emit();
      return;
    }
    if (this.phase === 'sealed') {
      if (remaining !== null && remaining > 0) this.unseal();
      else this.schedulePoll();
    } else if (this.phase === 'finalizing') {
      if (remaining !== null && remaining > 0) {
        this.phase = 'ready';
        this.finalizingSince = null;
        this.closingStep = null;
      } else {
        this.schedulePoll();
      }
    }
    if (this.phase === 'ready' && (batch.truncated || this.hasDirty() || this.events.length > 0 || this.viewed.length > 0)) {
      this.queueFlush(batch.truncated ? 0 : this.debounceMs);
    }
    this.emit();
  }

  /** Applies acknowledgements. Returns true when the server refused an answer because the attempt is closed. */
  private acknowledge(batch: Batch, res: SyncResponse | null): boolean {
    const accepted = new Map((res?.accepted ?? []).map((a) => [a.itemId, a.revision]));
    const rejected = new Map((res?.rejected ?? []).map((r) => [r.itemId, r]));
    let closed = false;
    let answers = this.answers;
    for (const sent of batch.sent.answers) {
      const rec = answers[sent.itemId];
      if (!rec) continue;
      const refusal = rejected.get(sent.itemId);
      if (refusal?.reason === 'closed') {
        closed = true;
        continue;
      }
      let next: AnswerRecord | null = null;
      if (refusal?.reason === 'invalid') {
        next = { ...rec, rejected: { revision: sent.revision, message: refusal.message } };
        this.notify({ kind: 'rejected', itemId: sent.itemId, message: refusal.message });
      } else {
        // Submit (res === null) acknowledges everything it carried.
        const serverRevision = res ? accepted.get(sent.itemId) : sent.revision;
        if (serverRevision !== undefined && serverRevision >= sent.revision && rec.syncedRevision < sent.revision) {
          next = { ...rec, syncedRevision: sent.revision };
        }
      }
      if (next) {
        answers = { ...answers, [sent.itemId]: next };
        this.journal?.putAnswer(next);
      }
    }
    this.answers = answers;

    const pagesAccepted = new Map((res?.scratchpadsAccepted ?? []).map((p) => [p.pageKey, p.revision]));
    let pages = this.scratchpads;
    for (const sent of batch.sent.scratchpads) {
      const page = pages[sent.pageKey];
      const serverRevision = res ? pagesAccepted.get(sent.pageKey) : sent.revision;
      if (page && serverRevision !== undefined && serverRevision >= sent.revision && page.syncedRevision < sent.revision) {
        const next = { ...page, syncedRevision: sent.revision };
        pages = { ...pages, [sent.pageKey]: next };
        this.journal?.putScratchpad(next);
      }
    }
    this.scratchpads = pages;

    if (batch.sent.events.length) {
      const ids = new Set(batch.sent.events);
      this.events = this.events.filter((e) => !ids.has(e.id));
      this.journal?.deleteEvents(this.attemptId, [...ids]);
    }
    if (batch.sent.viewed.length) {
      const ids = new Set(batch.sent.viewed);
      this.viewed = this.viewed.filter((id) => !ids.has(id));
    }
    return closed;
  }

  private onSyncError(err: TransportError, batch: Batch) {
    if (err.code === ERROR_CODES.SESSION_TAKEN_OVER) {
      this.lockDevice();
      return;
    }
    if (err.code === ERROR_CODES.ATTEMPT_CLOSED) {
      void this.handleClosed(null);
      return;
    }
    if (err.status === 401) {
      // The auth layer sends the candidate to sign in; the journal keeps everything for their return.
      this.syncState = 'failed';
      this.emit();
      return;
    }
    if (err.status === 422 || err.code === ERROR_CODES.VALIDATION) {
      this.quarantineFromServer(err, batch);
      this.queueFlush(0);
      this.emit();
      return;
    }
    if (err.status === 404 || err.status === 403) {
      this.fail({ title: 'This exam isn’t available', message: err.message, retryable: false });
      return;
    }
    this.noteFailure(err);
  }

  private noteFailure(err: TransportError) {
    this.failures += 1;
    const offline = !this.env.online();
    this.syncState = offline ? 'offline' : isNetwork(err) ? 'reconnecting' : 'failed';
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(this.failures - 1, 12));
    const delay = Math.round(base * (0.5 + this.env.random() * 0.5));
    if (this.retryTimer !== null) this.env.clearTimeout(this.retryTimer);
    this.retryAt = this.env.perfNow() + delay;
    this.retryTimer = this.env.setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      void this.flush('retry');
    }, delay);
    this.emit();
  }

  // ------------------------------------------------------------------ batches

  private hasDirty(): boolean {
    for (const rec of Object.values(this.answers)) if (isDirty(rec)) return true;
    for (const page of Object.values(this.scratchpads)) if (isPageDirty(page)) return true;
    return false;
  }

  private dirtyAnswerRecords(): AnswerRecord[] {
    return this.items.map((i) => this.answers[i.id]).filter((r): r is AnswerRecord => !!r && isDirty(r));
  }

  private toChange(item: AttemptItemView, rec: AnswerRecord): { ok: true; value: AnswerChange } | { ok: false; message: string } {
    const normalized = normalizeResponse(item, rec.response);
    if (!normalized.ok) return normalized;
    const working = normalizeWorking(rec.working);
    if (working === false) return { ok: false, message: 'Your working is longer than the exam allows. Shorten it to save.' };
    const provenance = provenanceToWire(rec.provenance);
    const changedAt = isoOrUndefined(rec.changedAt);
    return {
      ok: true,
      value: {
        itemId: rec.itemId,
        revision: rec.revision,
        response: normalized.value,
        working,
        flagged: rec.flagged,
        timeSpentMs: clampInt(rec.timeSpentMs, 0, 86_400_000),
        ...(provenance ? { provenance } : {}),
        ...(changedAt ? { changedAt } : {}),
      },
    };
  }

  private reject(rec: AnswerRecord, message: string) {
    if (rec.rejected?.revision === rec.revision) return;
    const next = { ...rec, rejected: { revision: rec.revision, message } };
    this.answers = { ...this.answers, [rec.itemId]: next };
    this.journal?.putAnswer(next);
    this.notify({ kind: 'rejected', itemId: rec.itemId, message });
  }

  private collect(mode: 'full' | 'events'): Batch {
    const answers: AnswerChange[] = [];
    const sentAnswers: SentRev[] = [];
    let truncated = false;
    if (mode === 'full') {
      for (const item of this.items) {
        const rec = this.answers[item.id];
        if (!rec || !isDirty(rec)) continue;
        if (answers.length >= LIMITS.answers) {
          truncated = true;
          break;
        }
        const change = this.toChange(item, rec);
        if (!change.ok) {
          this.reject(rec, change.message);
          continue;
        }
        answers.push(change.value);
        sentAnswers.push({ itemId: rec.itemId, revision: rec.revision });
      }
    }
    const events = this.events.slice(0, LIMITS.events);
    if (this.events.length > LIMITS.events) truncated = true;
    const dirtyPages = mode === 'full' ? Object.values(this.scratchpads).filter(isPageDirty) : [];
    const pages = dirtyPages.slice(0, LIMITS.scratchpads);
    if (dirtyPages.length > LIMITS.scratchpads) truncated = true;
    const viewed = this.viewed.slice(0, LIMITS.viewed);
    const lastAnnouncementId = newestAnnouncementId(this.announcements);
    const body: SyncRequest = {
      answers,
      events: events.map((e) => ({ type: e.type, ...(e.clientTs ? { clientTs: e.clientTs } : {}), payload: e.payload })),
      scratchpads: pages.map((p) => ({ pageKey: p.pageKey, kind: p.kind, data: p.data, revision: p.revision })),
      viewed,
      ...(this.rttMs !== null ? { rttMs: clampInt(this.rttMs, 0, 120_000) } : {}),
      ...(lastAnnouncementId ? { lastAnnouncementId } : {}),
    };
    return {
      body,
      sent: {
        answers: sentAnswers,
        events: events.map((e) => e.id),
        scratchpads: pages.map((p) => ({ pageKey: p.pageKey, revision: p.revision })),
        viewed,
      },
      empty: answers.length + events.length + pages.length + viewed.length === 0,
      truncated,
    };
  }

  /** Collects and validates. An entry that would fail the contract is quarantined by its issue path. */
  private buildBatch(mode: 'full' | 'events'): Batch {
    for (let attempt = 0; attempt < 4; attempt++) {
      const batch = this.collect(mode);
      const parsed = syncRequestSchema.safeParse(batch.body);
      if (parsed.success) return batch;
      const fixed = this.quarantinePaths(
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
        batch,
      );
      if (!fixed) break;
    }
    return { body: EMPTY_BODY, sent: { answers: [], events: [], scratchpads: [], viewed: [] }, empty: true, truncated: false };
  }

  private quarantinePaths(issues: { path: (string | number)[]; message: string }[], batch: Batch): boolean {
    let fixed = false;
    for (const { path, message } of issues) {
      const [group, index] = path;
      if (typeof index !== 'number') {
        if (group === 'rttMs') {
          this.rttMs = null;
          fixed = true;
        }
        continue;
      }
      if (group === 'answers') {
        const sent = batch.sent.answers[index];
        const rec = sent ? this.answers[sent.itemId] : undefined;
        if (rec) {
          this.reject(rec, 'This answer could not be saved in its current form.');
          fixed = true;
        }
      } else if (group === 'events') {
        const id = batch.sent.events[index];
        if (id) {
          this.events = this.events.filter((e) => e.id !== id);
          this.journal?.deleteEvents(this.attemptId, [id]);
          fixed = true;
        }
      } else if (group === 'scratchpads') {
        const sent = batch.sent.scratchpads[index];
        const page = sent ? this.scratchpads[sent.pageKey] : undefined;
        if (page) {
          const next = { ...page, syncedRevision: page.revision };
          this.scratchpads = { ...this.scratchpads, [page.pageKey]: next };
          this.journal?.putScratchpad(next);
          fixed = true;
        }
      } else if (group === 'viewed') {
        const id = batch.sent.viewed[index];
        if (id) {
          this.viewed = this.viewed.filter((v) => v !== id);
          fixed = true;
        }
      }
      void message;
    }
    return fixed;
  }

  /** The server refused the batch (422) although it passed the shared schema here. */
  private quarantineFromServer(err: TransportError, batch: Batch) {
    const issues = Object.entries(err.fields ?? {})
      .map(([key, message]) => {
        const parts = key.split(/[.[\]]+/).filter(Boolean);
        const index = Number(parts[1]);
        return { path: [parts[0] ?? '', Number.isInteger(index) ? index : (parts[1] ?? '')], message };
      })
      .filter((i) => typeof i.path[1] === 'number');
    if (issues.length && this.quarantinePaths(issues, batch)) return;
    // Nothing identifiable: drop the indicators first, then stop resending the answers in this batch.
    this.badBatchStrikes += 1;
    if (this.badBatchStrikes === 1) {
      const ids = new Set(batch.sent.events);
      this.events = this.events.filter((e) => !ids.has(e.id));
      this.journal?.deleteEvents(this.attemptId, [...ids]);
      this.viewed = [];
      for (const sent of batch.sent.scratchpads) {
        const page = this.scratchpads[sent.pageKey];
        if (page) this.scratchpads = { ...this.scratchpads, [page.pageKey]: { ...page, syncedRevision: page.revision } };
      }
      return;
    }
    for (const sent of batch.sent.answers) {
      const rec = this.answers[sent.itemId];
      if (rec) this.reject(rec, err.message || 'This answer could not be saved.');
    }
  }

  // ------------------------------------------------------------------ time and the end of the exam

  private startLoops() {
    if (this.loopsStarted || this.disposed) return;
    this.loopsStarted = true;
    const beat = () => {
      this.heartbeatTimer = this.env.setTimeout(() => {
        if (this.disposed) return;
        if (this.retryTimer === null && !this.running) void this.flush('heartbeat');
        beat();
      }, this.heartbeatMs);
    };
    beat();
    const tick = () => {
      this.tickTimer = this.env.setTimeout(() => {
        if (this.disposed) return;
        this.tick();
        tick();
      }, 1000);
    };
    tick();
  }

  private tick() {
    const remaining = this.clock.remainingMs(this.deadlineAt);
    if (remaining === null || this.phase !== 'ready') return;
    if (remaining <= PRE_DEADLINE_FLUSH_MS && remaining > 0 && !this.preDeadlineFlushed && this.hasDirty()) {
      this.preDeadlineFlushed = true;
      void this.flush('deadline');
    }
    if (remaining <= 0) void this.onDeadline();
  }

  /** Time is up by server time: flush at once, then wait for the server to close the attempt, or seal. */
  private async onDeadline() {
    if (this.deadlineHandling || this.phase !== 'ready') return;
    this.deadlineHandling = true;
    try {
      this.clearDebounce();
      const ok = await this.flush('deadline');
      if (this.disposed || this.phase !== 'ready') return;
      const remaining = this.clock.remainingMs(this.deadlineAt);
      if (remaining !== null && remaining > 0) return;
      if (ok && !this.hasDirtyAnswers()) {
        this.phase = 'finalizing';
        this.closingStep = 'waiting';
        this.finalizingSince = this.env.perfNow();
        this.emit();
        this.schedulePoll();
      } else {
        this.seal();
      }
    } finally {
      this.deadlineHandling = false;
    }
  }

  private hasDirtyAnswers(): boolean {
    for (const rec of Object.values(this.answers)) if (isDirty(rec)) return true;
    return false;
  }

  private seal() {
    if (!this.sealedAt) this.sealedAt = this.clock.nowIso() ?? new Date(this.env.deviceNow()).toISOString();
    this.phase = 'sealed';
    this.clearDebounce();
    this.persistMeta();
    this.emit();
  }

  private unseal() {
    this.sealedAt = null;
    this.phase = 'ready';
    this.preDeadlineFlushed = false;
    this.persistMeta();
    this.notify({ kind: 'unsealed' });
    this.queueFlush(0);
  }

  private schedulePoll() {
    if (this.pollTimer !== null || this.disposed) return;
    const since = this.finalizingSince ?? this.env.perfNow();
    const delay = this.env.perfNow() - since > POLL_FAST_WINDOW_MS ? POLL_SLOW_MS : POLL_FAST_MS;
    this.pollTimer = this.env.setTimeout(() => {
      this.pollTimer = null;
      if (this.phase === 'sealed' || this.phase === 'finalizing') void this.flush('poll');
    }, delay);
  }

  private updateDeadline(next: string | null | undefined) {
    if (!next) return;
    const prev = this.deadlineAt;
    this.deadlineAt = next;
    if (!prev) return;
    const delta = Math.round((Date.parse(next) - Date.parse(prev)) / 1000);
    if (delta >= 1) {
      this.preDeadlineFlushed = false;
      this.notify({ kind: 'time_extended', deltaSeconds: delta, deadlineAt: next });
    }
  }

  /** One path for every way an attempt closes. Never marks dirty answers synced; never enters backoff. */
  private handleClosed(status: AttemptStatus | null): Promise<void> {
    if (this.closing) return this.closing;
    if (this.phase === 'submitted' && this.receipt) return Promise.resolve();
    this.closing = (async () => {
      if (status) this.status = status;
      this.clearDebounce();
      this.clearRetry();
      if (this.pollTimer !== null) this.env.clearTimeout(this.pollTimer);
      this.pollTimer = null;
      if (this.phase !== 'submitted') this.phase = 'finalizing';
      this.finalizingSince = this.finalizingSince ?? this.env.perfNow();
      const dirty = this.dirtyAnswerRecords();
      if (dirty.length > 0 || this.status === 'awaiting_sync') {
        this.closingStep = 'uploading';
        this.emit();
        const uploaded = await this.uploadOfflineJournal(dirty);
        if (!uploaded || this.disposed) return;
      }
      this.closingStep = 'receipt';
      this.emit();
      const receipt = await this.fetchReceipt();
      if (this.disposed) return;
      if (receipt) {
        this.finishWithReceipt(receipt);
      } else {
        this.phase = 'submitted';
        this.closingStep = null;
        this.persistMeta();
        this.emit();
      }
    })().finally(() => {
      this.closing = null;
    });
    return this.closing;
  }

  private async uploadOfflineJournal(dirty: AnswerRecord[]): Promise<boolean> {
    const entries: AnswerChange[] = [];
    for (const rec of dirty) {
      const item = this.items.find((i) => i.id === rec.itemId);
      if (!item) continue;
      const change = this.toChange(item, rec);
      if (change.ok && entries.length < LIMITS.journal) entries.push(change.value);
    }
    const sealedAt = this.sealedAt ?? this.clock.nowIso() ?? new Date(this.env.deviceNow()).toISOString();
    const chain = await journalChain(this.attemptId, sealedAt, entries);
    const body: OfflineJournal = {
      sealedAt,
      ...(this.lastServerSync ? { lastServerSync: new Date(Date.parse(this.lastServerSync)).toISOString() } : {}),
      answers: entries,
      ...(chain ? { chain } : {}),
    };
    let failures = 0;
    for (;;) {
      if (this.disposed) return false;
      try {
        await this.transport.offlineJournal(this.attemptId, body);
        if (this.disposed) return false;
        this.markHeld(dirty);
        this.offlineUpload = { count: entries.length, at: new Date(this.env.deviceNow()).toISOString(), accepted: true };
        this.syncState = 'idle';
        this.retryAt = null;
        this.persistMeta();
        this.emit();
        return true;
      } catch (error) {
        if (this.disposed) return false;
        const err = toTransportError(error);
        if (err.code === ERROR_CODES.SESSION_TAKEN_OVER) {
          this.lockDevice();
          return false;
        }
        if (!isRetryable(err)) {
          // Refused for good (for example, after the reconnect grace period). Keep the decision visible.
          this.markHeld(dirty);
          this.offlineUpload = {
            count: entries.length,
            at: new Date(this.env.deviceNow()).toISOString(),
            accepted: false,
            message: err.message,
          };
          this.persistMeta();
          this.emit();
          return true;
        }
        failures += 1;
        await this.waitRetry(failures, err);
      }
    }
  }

  private markHeld(records: AnswerRecord[]) {
    let answers = this.answers;
    for (const rec of records) {
      const current = answers[rec.itemId];
      if (!current) continue;
      const next = { ...current, heldForReview: true };
      answers = { ...answers, [rec.itemId]: next };
      this.journal?.putAnswer(next);
    }
    this.answers = answers;
  }

  private async fetchReceipt(): Promise<SubmissionReceipt | null> {
    let failures = 0;
    for (;;) {
      if (this.disposed) return null;
      try {
        return await this.transport.receipt(this.attemptId);
      } catch (error) {
        if (this.disposed) return null;
        const err = toTransportError(error);
        failures += 1;
        if (!isRetryable(err) && failures >= 4) return null;
        await this.waitRetry(failures, err);
      }
    }
  }

  /** Backoff inside the closing loops. The 'online' event wakes it early. */
  private waitRetry(failures: number, err: TransportError): Promise<void> {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 12));
    const delay = Math.round(base * (0.5 + this.env.random() * 0.5));
    this.failures = failures;
    this.syncState = !this.env.online() ? 'offline' : isNetwork(err) ? 'reconnecting' : 'failed';
    this.retryAt = this.env.perfNow() + delay;
    this.emit();
    return new Promise((resolve) => {
      const done = () => {
        this.wakers.delete(done);
        this.env.clearTimeout(timer);
        resolve();
      };
      const timer = this.env.setTimeout(done, delay);
      this.wakers.add(done);
    });
  }

  private lockDevice() {
    this.phase = 'locked';
    this.lock = 'device';
    this.connected = false;
    this.clearDebounce();
    this.clearRetry();
    this.emit();
  }

  private lockTab() {
    this.phase = 'locked';
    this.lock = 'tab';
    this.connected = false;
    this.clearDebounce();
    this.clearRetry();
    this.emit();
  }

  // ------------------------------------------------------------------ announcements and clarifications

  private withReadFlags(list: AnnouncementView[]): AnnouncementView[] {
    for (const a of list) if (a.read) this.readSet.add(a.id);
    return [...list]
      .map((a) => (a.read || !this.readSet.has(a.id) ? a : { ...a, read: true }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /** Returns the announcements this device had not seen. */
  private mergeAnnouncements(incoming: AnnouncementView[]): AnnouncementView[] {
    if (incoming.length === 0) return [];
    const known = new Map(this.announcements.map((a) => [a.id, a]));
    const fresh: AnnouncementView[] = [];
    for (const a of incoming) {
      if (!known.has(a.id)) fresh.push(a);
      known.set(a.id, { ...a, read: a.read || this.readSet.has(a.id) || (known.get(a.id)?.read ?? false) });
    }
    if (fresh.length === 0 && incoming.every((a) => known.get(a.id) === a)) return [];
    this.announcements = this.withReadFlags([...known.values()]);
    return fresh.filter((a) => !this.readSet.has(a.id));
  }

  /** Returns clarifications that gained an answer (or arrived already answered). */
  private mergeClarifications(incoming: ClarificationView[]): ClarificationView[] {
    if (incoming.length === 0) return [];
    const known = new Map(this.clarifications.map((c) => [c.id, c]));
    const answered: ClarificationView[] = [];
    let changed = false;
    for (const c of incoming) {
      const prev = known.get(c.id);
      if (c.answer && !prev?.answer) answered.push(c);
      if (!prev || prev.answer !== c.answer || prev.answeredAt !== c.answeredAt) {
        known.set(c.id, c);
        changed = true;
      }
    }
    if (changed) this.clarifications = [...known.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return answered;
  }

  // ------------------------------------------------------------------ persistence and browser hooks

  private persistMeta() {
    if (!this.journal) return;
    const base = this.view ?? this.cachedView;
    const meta: AttemptMeta = {
      attemptId: this.attemptId,
      view: base
        ? {
            ...base,
            answers: [],
            scratchpads: [],
            announcements: this.announcements,
            clarifications: this.clarifications,
            deadlineAt: this.deadlineAt ?? base.deadlineAt,
            status: this.status ?? base.status,
          }
        : null,
      current: this.current,
      max: this.max,
      lastServerSync: this.lastServerSync,
      deviceOffsetMs: this.deviceOffsetMs,
      sealedAt: this.sealedAt,
      readAnnouncements: [...this.readSet],
      unsentReads: [],
      receipt: this.receipt,
      offlineUpload: this.offlineUpload,
      updatedAt: this.env.deviceNow(),
    };
    this.journal.putMeta(meta);
  }

  /** Best-effort delivery of unsaved answers when the page goes away. Events wait for the next session. */
  private sendBeacon() {
    if (!this.connected || this.phase !== 'ready') return;
    const batch = this.collect('full');
    if (batch.sent.answers.length === 0 && batch.sent.scratchpads.length === 0) return;
    let body: SyncRequest = { ...EMPTY_BODY, answers: batch.body.answers, scratchpads: batch.body.scratchpads };
    const size = (b: SyncRequest) => new TextEncoder().encode(JSON.stringify(b)).length;
    if (size(body) > BEACON_MAX_BYTES) {
      body = { ...EMPTY_BODY, answers: body.answers.map(({ provenance: _p, ...a }) => a) };
    }
    while (body.answers.length > 1 && size(body) > BEACON_MAX_BYTES) body = { ...body, answers: body.answers.slice(0, -1) };
    if (size(body) > BEACON_MAX_BYTES) return;
    try {
      this.transport.beacon(this.attemptId, body);
    } catch {
      /* the journal still has it */
    }
  }

  private installListeners() {
    if (!this.browser || this.listenersInstalled || typeof window === 'undefined') return;
    this.listenersInstalled = true;
    const onOnline = () => {
      if (this.offlineSince !== null) {
        this.logEvent('came_online', { offlineMs: Math.round(this.env.perfNow() - this.offlineSince) });
        this.offlineSince = null;
      }
      this.failures = 0;
      this.clearRetry();
      for (const wake of [...this.wakers]) wake();
      void this.flush('online');
    };
    const onOffline = () => {
      if (this.offlineSince === null) {
        this.offlineSince = this.env.perfNow();
        this.logEvent('went_offline', {});
      }
      if (!this.running) this.syncState = 'offline';
      this.emit();
    };
    const onVisibility = () => {
      void this.flush(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    };
    const onPageHide = () => this.sendBeacon();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.cleanup.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });
    if (!this.env.online()) onOffline();
  }

  /**
   * Two tabs of one browser share a session, so the server cannot tell them apart. A Web Lock keeps one tab
   * in charge; the other shows "Continue in this tab", which steals the lock.
   */
  private acquireTabLock(steal: boolean): Promise<boolean> {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!this.browser || !locks) return Promise.resolve(true);
    if (this.tabLockHeld) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const name = `athena-attempt:${this.attemptId}`;
      // Waiting briefly (instead of ifAvailable) absorbs a lock still being released by a remount.
      const options: LockOptions = steal ? { steal: true } : { signal: AbortSignal.timeout(1500) };
      locks
        .request(name, options, async () => {
          if (this.disposed) return;
          this.tabLockHeld = true;
          resolve(true);
          await new Promise<void>((release) => {
            this.releaseTabLock = release;
          });
          this.tabLockHeld = false;
        })
        .catch(() => {
          if (this.tabLockHeld) {
            // Another tab stole the lock: it owns the attempt now.
            this.tabLockHeld = false;
            this.releaseTabLock = null;
            if (!this.disposed) this.lockTab();
          } else {
            resolve(false);
          }
        });
    });
  }
}

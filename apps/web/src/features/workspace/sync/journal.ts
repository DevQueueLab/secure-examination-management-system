import type {
  AnswerProvenance,
  AttemptEventType,
  AttemptView,
  SubmissionReceipt,
  WorkingResponse,
} from '@athena/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * The local journal: every answer, scratchpad page and integrity event is written here the moment it changes,
 * before any network call. A refresh, a crashed tab or a restarted browser resumes from it; the outbox sends
 * whatever the server has not acknowledged yet.
 */

export interface FieldProvenance {
  response?: AnswerProvenance;
  working?: AnswerProvenance;
}

export interface AnswerRecord {
  attemptId: string;
  itemId: string;
  response: Record<string, unknown> | null;
  working: WorkingResponse | null;
  flagged: boolean;
  /** Incremented on every local change. */
  revision: number;
  /** Highest revision the server has acknowledged. The answer is dirty while revision > syncedRevision. */
  syncedRevision: number;
  timeSpentMs: number;
  /** Server-clock time of the latest local change (informational). */
  changedAt: string | null;
  provenance: FieldProvenance | null;
  /** The server refused this revision as invalid; it is not resent until the answer changes again. */
  rejected: { revision: number; message: string } | null;
  /** Sent in the sealed offline journal after the deadline: held for examiner review. */
  heldForReview: boolean;
}

export interface ScratchpadRecord {
  attemptId: string;
  pageKey: string;
  kind: 'canvas' | 'notes';
  data: Record<string, unknown>;
  revision: number;
  syncedRevision: number;
}

export interface EventRecord {
  attemptId: string;
  id: string;
  /** Local ordering only. */
  seq: number;
  type: AttemptEventType;
  clientTs?: string;
  payload: Record<string, unknown>;
}

export interface AttemptMeta {
  attemptId: string;
  /** Last attempt view from the server, without answers (those live in their own records). */
  view: AttemptView | null;
  current: number;
  /** Furthest question reached: linear exams never go back past it, even after a refresh. */
  max: number;
  lastServerSync: string | null;
  /** Device clock minus server clock at the last sync. Only used to estimate time when booting offline. */
  deviceOffsetMs: number | null;
  sealedAt: string | null;
  readAnnouncements: string[];
  /** Announcement read receipts the server has not acknowledged yet. */
  unsentReads: string[];
  receipt: SubmissionReceipt | null;
  offlineUpload: OfflineUpload | null;
  updatedAt: number;
}

/** Answers sent in the sealed offline journal after the deadline. They count only once an examiner accepts them. */
export interface OfflineUpload {
  count: number;
  at: string;
  /** False when the server refused the journal (for example, it arrived after the reconnect grace period). */
  accepted: boolean;
  message?: string;
}

export interface JournalSnapshot {
  meta: AttemptMeta | null;
  answers: AnswerRecord[];
  scratchpads: ScratchpadRecord[];
  events: EventRecord[];
}

export interface Journal {
  /** False when answers live in memory only (IndexedDB unavailable or blocked). */
  readonly durable: boolean;
  load(attemptId: string): Promise<JournalSnapshot>;
  putMeta(meta: AttemptMeta): void;
  putAnswer(record: AnswerRecord): void;
  putScratchpad(record: ScratchpadRecord): void;
  putEvent(record: EventRecord): void;
  deleteEvents(attemptId: string, ids: string[]): void;
  /** After a confirmed submission: drop answers, pages and events so a shared computer keeps nothing. */
  clearWork(attemptId: string): void;
  /** Resolves once every queued write is committed. */
  settle(): Promise<void>;
  onError?: (error: unknown) => void;
}

// ---------- in-memory (fallback and tests) ----------

export class MemoryJournal implements Journal {
  readonly durable: boolean = false;
  onError?: (error: unknown) => void;
  private meta = new Map<string, AttemptMeta>();
  private answers = new Map<string, AnswerRecord>();
  private scratchpads = new Map<string, ScratchpadRecord>();
  private events = new Map<string, EventRecord>();

  async load(attemptId: string): Promise<JournalSnapshot> {
    const of = <T extends { attemptId: string }>(m: Map<string, T>) => [...m.values()].filter((r) => r.attemptId === attemptId).map((r) => structuredClone(r));
    const meta = this.meta.get(attemptId);
    return {
      meta: meta ? structuredClone(meta) : null,
      answers: of(this.answers),
      scratchpads: of(this.scratchpads),
      events: of(this.events).sort((a, b) => a.seq - b.seq),
    };
  }
  putMeta(meta: AttemptMeta) {
    this.meta.set(meta.attemptId, structuredClone(meta));
  }
  putAnswer(record: AnswerRecord) {
    this.answers.set(`${record.attemptId}|${record.itemId}`, structuredClone(record));
  }
  putScratchpad(record: ScratchpadRecord) {
    this.scratchpads.set(`${record.attemptId}|${record.pageKey}`, structuredClone(record));
  }
  putEvent(record: EventRecord) {
    this.events.set(`${record.attemptId}|${record.id}`, structuredClone(record));
  }
  deleteEvents(attemptId: string, ids: string[]) {
    for (const id of ids) this.events.delete(`${attemptId}|${id}`);
  }
  clearWork(attemptId: string) {
    for (const map of [this.answers, this.scratchpads, this.events] as Map<string, { attemptId: string }>[]) {
      for (const [key, value] of map) if (value.attemptId === attemptId) map.delete(key);
    }
  }
  async settle() {}
}

// ---------- IndexedDB ----------

interface WorkspaceDB extends DBSchema {
  meta: { key: string; value: AttemptMeta };
  answers: { key: [string, string]; value: AnswerRecord };
  scratchpads: { key: [string, string]; value: ScratchpadRecord };
  events: { key: [string, string]; value: EventRecord };
}

type StoreName = 'meta' | 'answers' | 'scratchpads' | 'events';

type Write =
  | { op: 'put'; store: StoreName; value: AttemptMeta | AnswerRecord | ScratchpadRecord | EventRecord }
  | { op: 'delete'; store: 'events'; key: [string, string] }
  | { op: 'clear'; attemptId: string };

const DB_NAME = 'athena-workspace';
const DB_VERSION = 1;

function attemptRange(attemptId: string): IDBKeyRange {
  // Arrays sort after strings, so [id, []] bounds every [id, <string>] key.
  return IDBKeyRange.bound([attemptId], [attemptId, []]);
}

export class IdbJournal implements Journal {
  readonly durable: boolean = true;
  onError?: (error: unknown) => void;
  /** Latest write per key, in first-queued order. A newer write for the same key replaces the older one. */
  private pending = new Map<string, Write>();
  private running: Promise<void> | null = null;
  private scheduled = false;

  private constructor(private readonly db: IDBPDatabase<WorkspaceDB>) {}

  static async open(): Promise<IdbJournal> {
    const db = await openDB<WorkspaceDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'attemptId' });
        if (!database.objectStoreNames.contains('answers')) database.createObjectStore('answers', { keyPath: ['attemptId', 'itemId'] });
        if (!database.objectStoreNames.contains('scratchpads')) database.createObjectStore('scratchpads', { keyPath: ['attemptId', 'pageKey'] });
        if (!database.objectStoreNames.contains('events')) database.createObjectStore('events', { keyPath: ['attemptId', 'id'] });
      },
      blocking() {
        // A newer tab wants to upgrade: let it.
        db.close();
      },
    });
    return new IdbJournal(db);
  }

  async load(attemptId: string): Promise<JournalSnapshot> {
    await this.settle();
    const tx = this.db.transaction(['meta', 'answers', 'scratchpads', 'events'], 'readonly');
    const range = attemptRange(attemptId);
    const [meta, answers, scratchpads, events] = await Promise.all([
      tx.objectStore('meta').get(attemptId),
      tx.objectStore('answers').getAll(range),
      tx.objectStore('scratchpads').getAll(range),
      tx.objectStore('events').getAll(range),
    ]);
    await tx.done;
    return { meta: meta ?? null, answers, scratchpads, events: events.sort((a, b) => a.seq - b.seq) };
  }

  putMeta(meta: AttemptMeta) {
    this.enqueue(`meta|${meta.attemptId}`, { op: 'put', store: 'meta', value: meta });
  }
  putAnswer(record: AnswerRecord) {
    this.enqueue(`answers|${record.attemptId}|${record.itemId}`, { op: 'put', store: 'answers', value: record });
  }
  putScratchpad(record: ScratchpadRecord) {
    this.enqueue(`scratchpads|${record.attemptId}|${record.pageKey}`, { op: 'put', store: 'scratchpads', value: record });
  }
  putEvent(record: EventRecord) {
    this.enqueue(`events|${record.attemptId}|${record.id}`, { op: 'put', store: 'events', value: record });
  }
  deleteEvents(attemptId: string, ids: string[]) {
    for (const id of ids) this.enqueue(`events|${attemptId}|${id}`, { op: 'delete', store: 'events', key: [attemptId, id] });
  }
  clearWork(attemptId: string) {
    this.enqueue(`clear|${attemptId}`, { op: 'clear', attemptId });
  }

  async settle(): Promise<void> {
    while (this.pending.size > 0 || this.running) {
      await this.drain();
    }
  }

  private enqueue(key: string, write: Write) {
    // Re-inserting moves the key to the end, so a write queued after a clear lands after it.
    this.pending.delete(key);
    this.pending.set(key, write);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        while (this.pending.size > 0) {
          const batch = [...this.pending.values()];
          this.pending.clear();
          const tx = this.db.transaction(['meta', 'answers', 'scratchpads', 'events'], 'readwrite');
          for (const write of batch) {
            if (write.op === 'put') {
              // The typed stores accept their own record shape; the union is resolved by `store`.
              void (tx.objectStore(write.store) as unknown as { put: (v: unknown) => Promise<unknown> }).put(write.value);
            } else if (write.op === 'delete') {
              void tx.objectStore('events').delete(write.key);
            } else {
              const range = attemptRange(write.attemptId);
              void tx.objectStore('answers').delete(range);
              void tx.objectStore('scratchpads').delete(range);
              void tx.objectStore('events').delete(range);
            }
          }
          await tx.done;
        }
      } catch (error) {
        // Quota or a closed database. Records are full snapshots, so the next successful write repairs the state.
        this.onError?.(error);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}

/** IndexedDB when the browser allows it, otherwise memory (with `durable: false` so the UI can warn). */
export async function openJournal(): Promise<Journal> {
  if (typeof indexedDB === 'undefined') return new MemoryJournal();
  try {
    return await Promise.race([
      IdbJournal.open(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IndexedDB open timed out')), 4000)),
    ]);
  } catch {
    return new MemoryJournal();
  }
}

/** Shared by the lobby's system check. */
export async function probeIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const journal = await IdbJournal.open();
    await journal.load('__probe__');
    return true;
  } catch {
    return false;
  }
}

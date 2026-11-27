import type { AnswerProvenance, AnswerState, AttemptItemView, ScratchpadState } from '@athena/shared';
import { answerProvenanceSchema } from '@athena/shared';
import type { AnswerRecord, FieldProvenance, ScratchpadRecord } from './journal';

/**
 * Reconciles what the server holds with what this device journaled. Revisions are per item and monotonic:
 * a higher local revision wins and stays dirty (so it is re-sent); otherwise the server's copy wins.
 * Nothing the candidate typed on this device is ever dropped by a reload.
 */

function parseProvenance(value: unknown): AnswerProvenance | undefined {
  const parsed = answerProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Wire format sent as `provenance`: the primary written field's AnswerProvenance at the top level, tagged with
 * `field`, and the working text's provenance nested under `working` when both exist.
 */
export function provenanceFromWire(value: unknown): FieldProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const top = parseProvenance(obj);
  if (obj.field === 'working') return top ? { working: top } : null;
  const nested = parseProvenance(obj.working);
  if (!top && !nested) return null;
  return { ...(top ? { response: top } : {}), ...(nested ? { working: nested } : {}) };
}

export function provenanceToWire(p: FieldProvenance | null): Record<string, unknown> | undefined {
  if (!p) return undefined;
  if (p.response) return { ...p.response, field: 'response', ...(p.working ? { working: p.working } : {}) };
  if (p.working) return { ...p.working, field: 'working' };
  return undefined;
}

export function emptyAnswer(attemptId: string, itemId: string): AnswerRecord {
  return {
    attemptId,
    itemId,
    response: null,
    working: null,
    flagged: false,
    revision: 0,
    syncedRevision: 0,
    timeSpentMs: 0,
    changedAt: null,
    provenance: null,
    rejected: null,
    heldForReview: false,
  };
}

export function mergeAnswers(attemptId: string, items: AttemptItemView[], server: AnswerState[], local: AnswerRecord[]): AnswerRecord[] {
  const serverById = new Map(server.map((a) => [a.itemId, a]));
  const localById = new Map(local.map((a) => [a.itemId, a]));
  return items.map((item) => {
    const s = serverById.get(item.id);
    const l = localById.get(item.id);
    const serverRevision = s?.revision ?? 0;
    if (l && l.revision > serverRevision) {
      // This device is ahead (offline work, a crash before the last sync): keep it and send it again.
      return { ...l, attemptId, syncedRevision: Math.min(l.syncedRevision, serverRevision) };
    }
    if (s) {
      const serverProvenance = provenanceFromWire((s as AnswerState & { provenance?: unknown }).provenance);
      return {
        attemptId,
        itemId: item.id,
        response: s.response,
        working: s.working,
        flagged: s.flagged,
        revision: s.revision,
        syncedRevision: s.revision,
        timeSpentMs: l?.timeSpentMs ?? 0,
        changedAt: s.answeredAt ?? l?.changedAt ?? null,
        provenance: l && l.revision === s.revision && l.provenance ? l.provenance : (serverProvenance ?? l?.provenance ?? null),
        rejected: null,
        heldForReview: l?.heldForReview ?? false,
      };
    }
    return l ? { ...l, attemptId } : emptyAnswer(attemptId, item.id);
  });
}

export function mergeScratchpads(attemptId: string, server: ScratchpadState[], local: ScratchpadRecord[]): ScratchpadRecord[] {
  const out = new Map<string, ScratchpadRecord>();
  for (const s of server) {
    out.set(s.pageKey, { attemptId, pageKey: s.pageKey, kind: s.kind, data: s.data, revision: s.revision, syncedRevision: s.revision });
  }
  for (const l of local) {
    const s = out.get(l.pageKey);
    if (!s || l.revision > s.revision) {
      out.set(l.pageKey, { ...l, attemptId, syncedRevision: Math.min(l.syncedRevision, s?.revision ?? 0) });
    }
  }
  return [...out.values()];
}

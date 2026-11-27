import type { AttemptView, ClarificationView, OfflineJournal, SubmissionReceipt, SyncRequest, SyncResponse } from '@athena/shared';
import { API_BASE, api } from '@/lib/api';
import type { Transport } from '../sync/engine';

/** The attempt engine's view of the API. Errors are ApiError instances (status, code, message, fields). */
export function createTransport(): Transport {
  return {
    getAttempt: (id) => api.get<AttemptView>(`/attempts/${id}`, { retries: 1, timeoutMs: 15_000 }),
    sync: (id, body) => api.post<SyncResponse>(`/attempts/${id}/sync`, body, { timeoutMs: 12_000 }),
    submit: (id, body) => api.post<SubmissionReceipt>(`/attempts/${id}/submit`, body, { timeoutMs: 25_000 }),
    receipt: (id) => api.get<SubmissionReceipt>(`/attempts/${id}/receipt`, { retries: 0, timeoutMs: 15_000 }),
    offlineJournal: (id, body: OfflineJournal) => api.post(`/attempts/${id}/offline-journal`, body, { timeoutMs: 20_000 }),
    claim: (id) => api.post(`/attempts/${id}/claim`, {}),
    askClarification: (id, body) => api.post<ClarificationView>(`/monitoring/attempts/${id}/clarifications`, body),
    beacon: (id, body: SyncRequest) => {
      // sendBeacon cannot carry cookies with a JSON content type; a keepalive fetch can, and survives unload.
      void fetch(`${API_BASE}/attempts/${id}/sync`, {
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
  };
}

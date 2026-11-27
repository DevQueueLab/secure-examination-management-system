import type { Container } from '../../container';

/** Background jobs owned by the attempt engine (auto-finalize at deadline, outage detection). */
export function startAttemptJobs(_c: Container): () => void {
  return () => {};
}

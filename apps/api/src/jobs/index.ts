import type { Container } from '../container';
import { startAttemptJobs } from '../modules/attempts/attempt.jobs';

/** Starts every background job and returns a function that stops them all (graceful shutdown). */
export function startJobs(c: Container): () => void {
  const stops = [startAttemptJobs(c)];
  return () => stops.forEach((stop) => stop());
}

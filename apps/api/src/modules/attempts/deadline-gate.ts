/**
 * Holds deadline enforcement while the API starts up.
 *
 * After a server outage the deadline job first extends every affected attempt (outage compensation). Until it
 * has, a candidate whose deadline passed during our own downtime must not be finalized by a request that
 * arrives early, so lazy deadline checks wait on this gate. The gate is open by default (tests, the seed);
 * the attempt jobs close it synchronously at startup and open it once compensation has run.
 */
export class DeadlineGate {
  private pending: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;

  hold(): void {
    if (this.release) return;
    this.pending = new Promise<void>((resolve) => (this.release = resolve));
  }

  open(): void {
    this.release?.();
    this.release = null;
  }

  wait(): Promise<void> {
    return this.pending;
  }
}

/** The process-wide gate shared by the request path and the attempt jobs. */
export const deadlineGate = new DeadlineGate();

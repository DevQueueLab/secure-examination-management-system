/**
 * Server-authoritative time for the exam workspace.
 *
 * The device clock never decides how much time is left. Every API response carries `serverNow`; we pin it to the
 * performance.now() midpoint of the request that produced it, then advance with the monotonic clock:
 *
 *   remaining = deadlineAt − (serverNowAtSync + (performance.now() − perfAtSync))
 *
 * Each sync re-anchors, so drift, sleep (performance.now() can pause while a laptop sleeps) and a wrong device
 * clock are corrected at the next response.
 */
export interface ClockAnchor {
  serverMs: number;
  /** performance.now() that corresponds to serverMs (request midpoint). */
  perf: number;
  rttMs: number;
  /** performance.now() when the anchoring request was sent. A response to an older request never replaces it. */
  sentAt: number;
  /** True when the anchor was estimated from the device clock (booted offline), not measured. */
  estimated: boolean;
}

export type PerfNow = () => number;

export class ServerClock {
  private anchor: ClockAnchor | null = null;

  constructor(private readonly perfNow: PerfNow = () => performance.now()) {}

  /**
   * Re-anchor from a server timestamp. `sentAt` and `receivedAt` are performance.now() readings around the request.
   * Returns false when the sample is malformed or belongs to a request older than the current anchor.
   */
  sample(serverNowIso: string, sentAt: number, receivedAt: number): boolean {
    const serverMs = Date.parse(serverNowIso);
    if (!Number.isFinite(serverMs) || receivedAt < sentAt) return false;
    if (this.anchor && !this.anchor.estimated && sentAt < this.anchor.sentAt) return false;
    this.anchor = { serverMs, perf: (sentAt + receivedAt) / 2, rttMs: receivedAt - sentAt, sentAt, estimated: false };
    return true;
  }

  /**
   * Only for booting while the API is unreachable: estimate server time from the offset measured at the last
   * successful sync. Replaced by the first real sample.
   */
  estimate(serverMs: number): void {
    if (this.anchor && !this.anchor.estimated) return;
    const perf = this.perfNow();
    this.anchor = { serverMs, perf, rttMs: 0, sentAt: -Infinity, estimated: true };
  }

  get ready(): boolean {
    return this.anchor !== null;
  }

  get estimated(): boolean {
    return this.anchor?.estimated ?? false;
  }

  get rttMs(): number | null {
    return this.anchor && !this.anchor.estimated ? this.anchor.rttMs : null;
  }

  /** Estimated server time in epoch milliseconds, or null before the first sample. */
  now(): number | null {
    if (!this.anchor) return null;
    return this.anchor.serverMs + (this.perfNow() - this.anchor.perf);
  }

  nowIso(): string | undefined {
    const now = this.now();
    return now === null ? undefined : new Date(Math.round(now)).toISOString();
  }

  /** Milliseconds until the deadline by server time (negative once it has passed), or null when unknown. */
  remainingMs(deadlineIso: string | null | undefined): number | null {
    if (!deadlineIso) return null;
    const deadline = Date.parse(deadlineIso);
    const now = this.now();
    if (now === null || !Number.isFinite(deadline)) return null;
    return deadline - now;
  }
}

/** Device clock minus server clock, used only to explain in the lobby that the device clock does not matter. */
export function deviceClockOffsetMs(serverNowIso: string, sentAt: number, receivedAt: number, deviceNowAtReceive: number): number | null {
  const serverMs = Date.parse(serverNowIso);
  if (!Number.isFinite(serverMs)) return null;
  // The server stamped its time roughly half a round trip before the response arrived.
  return deviceNowAtReceive - (serverMs + (receivedAt - sentAt) / 2);
}

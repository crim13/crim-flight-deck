export type Phase = 'begin' | 'update' | 'end' | 'set';

export interface ArbiterOptions {
  /** an owner that sends nothing for this long loses the control (finger lifted without "end") */
  idleMs: number;
  /** other devices stay locked out this long after the owner released */
  releaseMs: number;
}

export const DEFAULT_ARBITER: ArbiterOptions = { idleMs: 2000, releaseMs: 250 };

/**
 * Conflict policy for two devices driving the same control: FIRST TOUCH WINS.
 *  - the first device to begin/update a control owns it while it keeps sending
 *  - other devices get "busy" until the owner released + releaseMs (or went idle for idleMs)
 *  - simulator-originated changes are never blocked (they only update state)
 * Predictable and symmetrical: no device can steal a control mid-gesture.
 */
export class ControlArbiter {
  private owners = new Map<string, { device: string; until: number }>();

  constructor(private readonly now: () => number = Date.now, private readonly opts: ArbiterOptions = DEFAULT_ARBITER) {}

  /** returns the owning device if `device` must be refused, otherwise null */
  request(key: string, device: string, phase: Phase): string | null {
    const t = this.now();
    const cur = this.owners.get(key);
    if (cur && cur.device !== device && t < cur.until) return cur.device;
    const hold = phase === 'end' || phase === 'set' ? this.opts.releaseMs : this.opts.idleMs;
    this.owners.set(key, { device, until: t + hold });
    return null;
  }

  ownerOf(key: string): string | null {
    const cur = this.owners.get(key);
    return cur && this.now() < cur.until ? cur.device : null;
  }

  /** a disconnecting device releases everything it holds (after the usual short hold) */
  releaseDevice(device: string): void {
    const t = this.now();
    for (const [k, o] of this.owners) if (o.device === device) this.owners.set(k, { device, until: Math.min(o.until, t + this.opts.releaseMs) });
  }
}

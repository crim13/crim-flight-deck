import type { SimCommand } from '@crim/shared';

interface Slot {
  lastSentAt: number;
  pending: SimCommand[] | null;
  timer: NodeJS.Timeout | null;
}

/**
 * Per-control coalescing of high-frequency commands (axis dragging).
 * - leading edge: the first command goes out immediately
 * - while inside the minimum interval only the LATEST command is kept (trailing edge)
 * - discrete / final commands are sent immediately and supersede anything pending
 * Nothing is ever re-sent on a timer: when a drag stops, the simulator is left alone.
 */
export class CommandScheduler {
  private slots = new Map<string, Slot>();

  constructor(
    private readonly send: (cmds: SimCommand[]) => void,
    private readonly minIntervalMs = 33,
    private readonly now: () => number = Date.now,
  ) {}

  private slot(key: string): Slot {
    let s = this.slots.get(key);
    if (!s) {
      s = { lastSentAt: -Infinity, pending: null, timer: null };
      this.slots.set(key, s);
    }
    return s;
  }

  submit(key: string, cmds: SimCommand[], opts: { continuous: boolean; immediate?: boolean }): void {
    const s = this.slot(key);
    const t = this.now();
    if (!opts.continuous || opts.immediate) {
      this.clearPending(s);
      s.lastSentAt = t;
      this.send(cmds);
      return;
    }
    const elapsed = t - s.lastSentAt;
    if (elapsed >= this.minIntervalMs && !s.timer) {
      s.lastSentAt = t;
      this.send(cmds);
      return;
    }
    s.pending = cmds;
    if (!s.timer) {
      s.timer = setTimeout(() => {
        s.timer = null;
        const p = s.pending;
        s.pending = null;
        if (p) {
          s.lastSentAt = this.now();
          this.send(p);
        }
      }, Math.max(1, this.minIntervalMs - elapsed));
    }
  }

  /** send whatever is pending right now (end of gesture) */
  flush(key: string): void {
    const s = this.slots.get(key);
    if (!s?.pending) return;
    const p = s.pending;
    this.clearPending(s);
    s.lastSentAt = this.now();
    this.send(p);
  }

  private clearPending(s: Slot): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.pending = null;
  }

  dispose(): void {
    for (const s of this.slots.values()) this.clearPending(s);
    this.slots.clear();
  }
}

/**
 * Pure decision logic for the local "hold" of a control (see useControl).
 *
 * After the finger lifts the handle keeps the released value until the simulator agrees. The simulator
 * is often slower than the finger (lever animation, trim rate, SimConnect latency), so a fixed timeout
 * made the handle jump back to an intermediate telemetry value and then crawl forward again. Instead the
 * hold lasts as long as the simulator keeps moving towards the released value and only ends when it
 * agrees, stops making progress (STALL_MS) or HARD_MS passed - then the display follows reality again.
 */
export interface Hold {
  value: number;
  dragging: boolean;
  /** hold ends at this time unless the simulator makes progress */
  until: number;
  /** absolute end of the hold, whatever the simulator does */
  hard: number;
  /** simulator value when the hold was (re)armed - used to detect progress */
  sim?: number;
}

/** wait for the first reaction of the simulator after release (command latency + lever animation start) */
export const SETTLE_MS = 1500;
/** no progress for this long -> the simulator is not going to reach the value */
export const STALL_MS = 1200;
export const HARD_MS = 8000;
/** while dragging nothing expires; this only has to outlive a very long gesture */
export const DRAG_MS = 10 * 60_000;

export const armRelease = (value: number, sim: number | undefined, now: number): Hold =>
  ({ value, dragging: false, until: now + SETTLE_MS, hard: now + HARD_MS, sim });

export const armDrag = (value: number, now: number): Hold =>
  ({ value, dragging: true, until: now + DRAG_MS, hard: now + DRAG_MS });

export type HoldDecision =
  | { action: 'keep' }
  | { action: 'drop' }
  | { action: 'extend'; hold: Hold }
  | { action: 'wait'; ms: number };

export function decideHold(hold: Hold, sim: number | undefined, now: number, tolerance: number): HoldDecision {
  if (hold.dragging) return { action: 'keep' };
  if (typeof sim === 'number' && Math.abs(sim - hold.value) <= tolerance) return { action: 'drop' };
  if (now >= hold.hard) return { action: 'drop' };
  // the simulator moved closer to the released value: it is working on it, keep waiting
  if (typeof sim === 'number' && typeof hold.sim === 'number' && sim !== hold.sim
    && Math.abs(sim - hold.value) < Math.abs(hold.sim - hold.value)) {
    return { action: 'extend', hold: { ...hold, sim, until: Math.min(hold.hard, now + STALL_MS) } };
  }
  if (typeof sim === 'number' && hold.sim === undefined) {
    // first sample after release: remember it as the baseline for progress detection
    return { action: 'extend', hold: { ...hold, sim } };
  }
  if (now >= hold.until) return { action: 'drop' };
  return { action: 'wait', ms: Math.min(hold.until, hold.hard) - now };
}

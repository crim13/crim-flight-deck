import { describe, expect, it } from 'vitest';
import { HARD_MS, SETTLE_MS, STALL_MS, armDrag, armRelease, decideHold } from './hold';

const T0 = 1_000_000;
const TOL = 0.012;

describe('hold after release', () => {
  it('never expires while the finger is down', () => {
    const h = armDrag(0.8, T0);
    expect(decideHold(h, 0.1, T0 + 60 * 60_000, TOL).action).toBe('keep');
  });

  it('drops as soon as the simulator agrees', () => {
    const h = armRelease(0.8, 0.3, T0);
    expect(decideHold(h, 0.805, T0 + 100, TOL).action).toBe('drop');
  });

  it('keeps the released value while the simulator is still moving towards it (no jump back to telemetry)', () => {
    let h = armRelease(1, 0.2, T0);
    let t = T0;
    // slow simulator: 0.2 -> 0.4 -> 0.6 -> 0.8, a sample every second (longer than SETTLE_MS in total)
    for (const sim of [0.4, 0.6, 0.8]) {
      t += 1000;
      const d = decideHold(h, sim, t, TOL);
      expect(d.action).toBe('extend');
      if (d.action === 'extend') h = d.hold;
    }
    expect(t - T0).toBeGreaterThan(SETTLE_MS);
    expect(decideHold(h, 0.8, t + 100, TOL).action).toBe('wait');
    expect(decideHold(h, 1, t + 200, TOL).action).toBe('drop');
  });

  it('gives up when the simulator stalls at another value, then shows reality', () => {
    const h = armRelease(0.9, 0.5, T0);
    expect(decideHold(h, 0.5, T0 + 10, TOL)).toEqual({ action: 'wait', ms: SETTLE_MS - 10 });
    expect(decideHold(h, 0.5, T0 + SETTLE_MS, TOL).action).toBe('drop');
  });

  it('does not extend when the simulator moves away from the released value', () => {
    const h = armRelease(0.9, 0.5, T0);
    expect(decideHold(h, 0.3, T0 + 100, TOL).action).toBe('wait');
  });

  it('stops waiting after a stall following progress', () => {
    const h = armRelease(1, 0.2, T0);
    const d = decideHold(h, 0.5, T0 + 500, TOL);
    expect(d.action).toBe('extend');
    if (d.action !== 'extend') return;
    expect(d.hold.until).toBe(T0 + 500 + STALL_MS);
    expect(decideHold(d.hold, 0.5, T0 + 500 + STALL_MS, TOL).action).toBe('drop');
  });

  it('is bounded by the hard limit even if the simulator crawls', () => {
    const h = armRelease(1, 0, T0);
    expect(decideHold({ ...h, sim: 0.01 }, 0.02, T0 + HARD_MS, TOL).action).toBe('drop');
  });

  it('takes the first sample after release as baseline', () => {
    const h = armRelease(0.8, undefined, T0);
    const d = decideHold(h, 0.3, T0 + 50, TOL);
    expect(d.action).toBe('extend');
    if (d.action === 'extend') expect(d.hold.sim).toBe(0.3);
  });
});

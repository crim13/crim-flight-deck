import { describe, expect, it } from 'vitest';
import {
  LeverDrag, StepAccumulator, TrimDrag, angleDelta, applyStep, attitudeView, formatAttitude, detentFromPointer, detentY, fineFactor, linkVisible, nearestDetent, signedTrim,
} from './math';

describe('attitude indicator', () => {
  it('applies the assumed sign convention (nose down / right wing down positive) and the flips', () => {
    expect(attitudeView(-5, -12, false, false)).toEqual({ pitchUp: 5, bankRight: 12 });
    expect(attitudeView(-5, -12, true, true)).toEqual({ pitchUp: -5, bankRight: -12 });
    expect(attitudeView(undefined, 3, false, false).pitchUp).toBeUndefined();
    expect(attitudeView(0, 0, false, false)).toEqual({ pitchUp: 0, bankRight: 0 });
    expect(attitudeView(-120, 0, false, false).pitchUp).toBe(90);
  });
  it('formats pitch and bank', () => {
    expect(formatAttitude(3.5, -12)).toEqual({ pitch: '3.5° UP', bank: '12° L' });
    expect(formatAttitude(-2, 30)).toEqual({ pitch: '2.0° DN', bank: '30° R' });
    expect(formatAttitude(undefined, undefined)).toEqual({ pitch: '--', bank: '--' });
  });
});

describe('engine lever link handle', () => {
  it('appears only when both levers are nearly equal', () => {
    expect(linkVisible(0.5, 0.55, false, false)).toBe(true);
    expect(linkVisible(0.5, 0.65, false, false)).toBe(false);
    expect(linkVisible(undefined, 0.5, false, false)).toBe(false);
  });
  it('has hysteresis so it does not flicker at the threshold', () => {
    expect(linkVisible(0.5, 0.61, false, false)).toBe(false);
    expect(linkVisible(0.5, 0.61, true, false)).toBe(true);
    expect(linkVisible(0.5, 0.64, true, false)).toBe(false);
  });
  it('stays while it is being dragged', () => {
    expect(linkVisible(0.1, 0.9, false, true)).toBe(true);
  });
  it('moves both levers identically, aligned to their mean at grab, and aligns at the stops', () => {
    const mean = (0.5 + 0.56) / 2;
    const d = new LeverDrag(mean, 400, { perPx: 1 / 400 });
    const v = d.move(300, 0, 0);
    expect(v).toBeCloseTo(mean + 0.25);
    expect(d.move(0, 0, 0)).toBe(1); // both levers reach the end together
  });
});

describe('lever drag (grab offset, boundaries)', () => {
  it('does not jump on first touch: the first event with no movement keeps the value', () => {
    const d = new LeverDrag(0.4, 500, { perPx: 1 / 400 });
    expect(d.move(500, 0, 0)).toBeCloseTo(0.4);
  });
  it('tracks the finger 1:1 at gain 1 (moving up increases)', () => {
    const d = new LeverDrag(0.4, 500, { perPx: 1 / 400 });
    expect(d.move(400, 0, 0)).toBeCloseTo(0.65);
    expect(d.move(440, 0, 0)).toBeCloseTo(0.55);
  });
  it('clamps at 0 and 1', () => {
    const d = new LeverDrag(0.9, 500, { perPx: 1 / 400 });
    expect(d.move(0, 0, 0)).toBe(1);
    const e = new LeverDrag(0.1, 100, { perPx: 1 / 400 });
    expect(e.move(900, 0, 0)).toBe(0);
  });
  it('limited windup: reversing after overshoot responds quickly but not instantly', () => {
    const d = new LeverDrag(0.95, 500, { perPx: 1 / 400, windup: 0.04 });
    d.move(100, 0, 0); // way beyond the end
    expect(d.value).toBe(1);
    expect(d.move(110, 0, 0)).toBe(1); // 10px back is still inside the windup margin
    expect(d.move(140, 0, 0)).toBeLessThan(1); // 30px back = 0.075 travel > 0.04 margin
    expect(d.value).toBeCloseTo(0.94, 5);
  });
  it('fine mode reduces gain with lateral distance, without jumps when entering it', () => {
    expect(fineFactor(0)).toBe(1);
    expect(fineFactor(60)).toBe(0.5);
    expect(fineFactor(120)).toBe(0.25);
    expect(fineFactor(-400)).toBe(0.1);
    const d = new LeverDrag(0.5, 500, { perPx: 1 / 400 });
    const coarse = d.move(480, 0, 0) - 0.5;
    const before = d.value;
    expect(d.move(480, 120, 0)).toBeCloseTo(before); // entering fine zone with no vertical movement: no change
    const fine = d.move(460, 120, 0) - before;
    expect(fine).toBeCloseTo(coarse * 0.25, 5);
  });
  it('respects per-control sensitivity', () => {
    const d = new LeverDrag(0.5, 500, { perPx: 1 / 400 });
    expect(d.move(400, 0, 0, 2) - 0.5).toBeCloseTo(0.5);
  });
});

describe('trim drag (relative, sensitivity, no jumps)', () => {
  it('is relative: touching somewhere does not change trim', () => {
    const t = new TrimDrag(0.2, 300);
    expect(t.move(300, 0, 0)).toBeCloseTo(0.2);
  });
  it('moves proportionally and in the right direction', () => {
    const t = new TrimDrag(0, 500);
    t.move(490, 0, 0); // 10px up
    expect(t.value).toBeCloseTo((10 / 1400) * 2, 5);
    const up = t.value;
    t.move(520, 0, 0); // 30px down
    expect(t.value).toBeLessThan(up);
    expect(t.value).toBeLessThan(0);
  });
  it('caps a single event so a touch glitch cannot jump the trim', () => {
    const t = new TrimDrag(0, 900);
    t.move(0, 0, 0); // 900px in one event
    expect(t.value).toBeCloseTo(0.03, 5);
  });
  it('clamps to -1..1 and supports fine mode', () => {
    const t = new TrimDrag(0.99, 900);
    for (let i = 0; i < 20; i++) t.move(900 - (i + 1) * 40, 0, 0);
    expect(t.value).toBe(1);
    const a = new TrimDrag(0, 500);
    const b = new TrimDrag(0, 500);
    a.move(480, 0, 0);
    b.move(480, 120, 0);
    expect(b.value).toBeCloseTo(a.value * 0.25, 6);
  });
  it('formats the readout', () => {
    expect(signedTrim(0)).toBe('0');
    expect(signedTrim(0.123)).toBe('UP 12');
    expect(signedTrim(-0.5)).toBe('DN 50');
  });
});

describe('flap detent snapping', () => {
  it('snaps to the nearest detent for any number of detents', () => {
    expect(nearestDetent(0, 4)).toBe(0);
    expect(nearestDetent(0.16, 4)).toBe(0);
    expect(nearestDetent(0.17, 4)).toBe(1);
    expect(nearestDetent(0.5, 4)).toBe(2);
    expect(nearestDetent(1, 4)).toBe(3);
    expect(nearestDetent(2, 4)).toBe(3);
    expect(nearestDetent(-1, 4)).toBe(0);
    expect(nearestDetent(0.5, 7)).toBe(3);
    expect(nearestDetent(0.9, 1)).toBe(0);
  });
  it('maps pointer position and back', () => {
    const top = 100, h = 400, pad = 30;
    for (let i = 0; i < 5; i++) {
      const y = top + detentY(i, 5, h, pad);
      expect(detentFromPointer(y, top, h, pad, 5)).toBe(i);
    }
    expect(detentFromPointer(0, top, h, pad, 5)).toBe(0);
    expect(detentFromPointer(9999, top, h, pad, 5)).toBe(4);
  });
});

describe('rotary encoder steps', () => {
  it('computes shortest angle deltas across the 360 boundary', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });
  it('accumulates remainders so slow turns are not lost', () => {
    const a = new StepAccumulator(10);
    expect(a.add(4)).toBe(0);
    expect(a.add(4)).toBe(0);
    expect(a.add(4)).toBe(1);
    expect(a.add(-25)).toBe(-2);
    expect(a.add(0)).toBe(0);
  });
  it('applies steps with wrap (heading) and clamp (altitude)', () => {
    expect(applyStep(359, 2, 1, 0, 359, true)).toBe(1);
    expect(applyStep(0, -1, 1, 0, 359, true)).toBe(359);
    expect(applyStep(59_900, 5, 100, 0, 60_000, false)).toBe(60_000);
    expect(applyStep(100, -5, 100, 0, 60_000, false)).toBe(0);
    expect(applyStep(1200, 1, 1, 0, 7777, false)).toBe(1201);
    expect(applyStep(275, 1, 10, 0, 359, true)).toBe(285); // coarse step from an unaligned value
    expect(applyStep(355, 1, 10, 0, 359, true)).toBe(5);
  });
});

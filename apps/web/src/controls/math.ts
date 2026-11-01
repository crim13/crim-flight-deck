// Pure interaction math (no DOM) so slider/trim/flap/encoder behaviour is unit-testable.

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

/**
 * Lateral "fine mode": the further the finger moves sideways away from a lever, the
 * smaller the gain of vertical movement (like iOS slider scrubbing).
 */
export function fineFactor(lateralPx: number): number {
  const d = Math.abs(lateralPx);
  if (d < 45) return 1;
  if (d < 100) return 0.5;
  if (d < 170) return 0.25;
  return 0.1;
}

export interface LeverDragOptions {
  /** 0..1 travel units per pixel of finger movement at gain 1 (1 / travelPx) */
  perPx: number;
  min?: number;
  max?: number;
  /** extra travel allowed beyond the ends before the virtual value stops "winding up" */
  windup?: number;
}

/**
 * Relative lever drag with grab offset. The value only ever changes by the finger's
 * movement since the previous event, so touching anywhere never makes the handle jump.
 * An unclamped virtual value (limited windup) makes reversing at an end feel natural.
 */
export class LeverDrag {
  private virtual: number;
  private lastY: number;
  private readonly min: number;
  private readonly max: number;
  private readonly windup: number;
  value: number;

  constructor(startValue: number, startY: number, private readonly o: LeverDragOptions) {
    this.min = o.min ?? 0;
    this.max = o.max ?? 1;
    this.windup = o.windup ?? 0.04;
    this.value = clamp(startValue, this.min, this.max);
    this.virtual = this.value;
    this.lastY = startY;
  }

  /** y grows downwards (screen space); moving up increases the value. `gain` 1 = finger tracks handle. */
  move(y: number, x: number, startX: number, sensitivity = 1): number {
    const dy = this.lastY - y;
    this.lastY = y;
    const gain = fineFactor(x - startX) * sensitivity;
    this.virtual = clamp(this.virtual + dy * this.o.perPx * gain, this.min - this.windup, this.max + this.windup);
    this.value = clamp(this.virtual, this.min, this.max);
    return this.value;
  }
}

/** The link handle between two engine levers appears when they are this close (0..1) ... */
export const LINK_NEAR = 0.1;
/** ... and stays until they are this far apart (hysteresis, so it does not flicker at the edge). */
export const LINK_FAR = 0.125;

/** Whether the link handle is offered: both values known and close enough, or already being used. */
export function linkVisible(a: number | undefined, b: number | undefined, wasVisible: boolean, linking: boolean): boolean {
  if (linking) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= (wasVisible ? LINK_FAR : LINK_NEAR);
}

/** Trim wheel: purely relative, rate limited per event so a glitchy touch can never jump the trim. */
export interface TrimOptions {
  /** full -1..1 range per this many pixels at gain 1 (higher = finer) */
  pxPerFullRange: number;
  maxStepPerEvent: number;
}
export const DEFAULT_TRIM: TrimOptions = { pxPerFullRange: 1400, maxStepPerEvent: 0.03 };

export class TrimDrag {
  value: number;
  /** accumulated, unclamped wheel travel in px (drives the ridge animation) */
  wheelPx = 0;
  private lastY: number;

  constructor(startValue: number, startY: number, private readonly o: TrimOptions = DEFAULT_TRIM) {
    this.value = clamp(startValue, -1, 1);
    this.lastY = startY;
  }

  move(y: number, x: number, startX: number, sensitivity = 1): number {
    const dy = this.lastY - y; // finger up = nose up = positive
    this.lastY = y;
    const gain = fineFactor(x - startX) * sensitivity;
    const raw = (dy / this.o.pxPerFullRange) * 2 * gain;
    const step = clamp(raw, -this.o.maxStepPerEvent, this.o.maxStepPerEvent);
    this.value = clamp(this.value + step, -1, 1);
    this.wheelPx += dy * gain;
    return this.value;
  }
}

// ---- flaps -----------------------------------------------------------------
/** Position (0 = top/UP .. 1 = bottom/FULL) -> nearest detent index. */
export function nearestDetent(pos01: number, count: number): number {
  if (count <= 1) return 0;
  return clamp(Math.round(clamp(pos01, 0, 1) * (count - 1)), 0, count - 1);
}

/** Index of the detent at a pointer y inside a track [top, top+height] with inner padding. */
export function detentFromPointer(y: number, top: number, height: number, pad: number, count: number): number {
  const inner = Math.max(1, height - pad * 2);
  return nearestDetent((y - top - pad) / inner, count);
}

export function detentY(index: number, count: number, height: number, pad: number): number {
  if (count <= 1) return pad;
  return pad + (index / (count - 1)) * (height - pad * 2);
}

// ---- rotary encoders ---------------------------------------------------------
/** Shortest signed angle difference in degrees (b - a), -180..180. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Converts accumulated rotation into whole steps; keeps the remainder so nothing is lost. */
export class StepAccumulator {
  private rem = 0;
  constructor(private readonly degPerStep: number) {}
  add(deg: number): number {
    this.rem += deg;
    const steps = Math.trunc(this.rem / this.degPerStep);
    this.rem -= steps * this.degPerStep;
    return steps === 0 ? 0 : steps;
  }
  reset(): void { this.rem = 0; }
}

export function applyStep(value: number, steps: number, step: number, min: number, max: number, wrap: boolean): number {
  let v = value + steps * step;
  if (wrap) {
    const span = max - min + 1; // integer setpoints (heading 0..359)
    v = ((((v - min) % span) + span) % span) + min;
  }
  return clamp(Math.round(v), min, max);
}

// ---- attitude indicator ---------------------------------------------------------
/**
 * Raw `ATTITUDE INDICATOR PITCH/BANK DEGREES` -> display angles (pitchUp: + = nose up, bankRight: + = right wing down).
 * The 2024 docs do not state the sign convention; SimConnect angles are commonly reported with the opposite sign
 * (nose down / left wing down positive), so that is the default and Settings can flip either axis after a live check.
 */
export function attitudeView(pitchRaw: number | undefined, bankRaw: number | undefined, flipPitch: boolean, flipBank: boolean) {
  const sp = flipPitch ? 1 : -1;
  const sb = flipBank ? 1 : -1;
  return {
    pitchUp: pitchRaw === undefined ? undefined : clamp(pitchRaw * sp, -90, 90) + 0,
    bankRight: bankRaw === undefined ? undefined : bankRaw * sb + 0,
  };
}

/** "5° UP" / "12° DN" and "12° R" / "3° L" captions for the indicator. */
export function formatAttitude(pitchUp: number | undefined, bankRight: number | undefined): { pitch: string; bank: string } {
  const p = pitchUp === undefined ? '--' : `${Math.abs(Math.round(pitchUp * 10) / 10).toFixed(1)}° ${pitchUp >= 0 ? 'UP' : 'DN'}`;
  const b = bankRight === undefined ? '--' : `${Math.abs(Math.round(bankRight))}° ${bankRight >= 0 ? 'R' : 'L'}`;
  return { pitch: p, bank: b };
}

/** Display helpers */
export const pct = (v: number | undefined) => (v === undefined ? '--' : `${Math.round(v * 100)}`);
export function signedTrim(v: number | undefined): string {
  if (v === undefined) return '--';
  const p = Math.round(v * 100);
  return p === 0 ? '0' : `${p > 0 ? 'UP' : 'DN'} ${Math.abs(p)}`;
}

/** Font size that lets `text` (uppercase, letter-spaced) fit into `width` px. */
export function fitFont(text: string, width: number, max = 12, min = 7): number {
  return Math.max(min, Math.min(max, (width - 6) / (Math.max(1, text.length) * 0.92)));
}

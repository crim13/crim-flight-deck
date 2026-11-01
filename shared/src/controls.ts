// Registry of logical controls. This is the contract between UI, protocol and server.
// Adding a control = add it here + a state entry (state.ts) + a command spec (commands.ts).

export const CONTROL_IDS = [
  // levers / axes
  'throttle', 'prop', 'mixture', 'trim', 'spoilers',
  // detented
  'flaps',
  // gear & brakes
  'gear', 'parkingBrake',
  // exterior lights
  'lightNav', 'lightBeacon', 'lightStrobe', 'lightLanding', 'lightTaxi',
  // systems
  'batteryMaster', 'avionicsMaster', 'fuelPump', 'pitotHeat',
  // autopilot
  'apMaster', 'apHeading', 'apNav', 'apApproach', 'apAltitude', 'apVs',
  'apHeadingSel', 'apAltitudeSel', 'apVsSel',
  // radios
  'com1Active', 'com1Standby', 'com2Active', 'com2Standby',
  'nav1Active', 'nav1Standby', 'nav2Active', 'nav2Standby',
  'xpndrCode', 'xpndrMode',
  // momentary actions
  'swapCom1', 'swapCom2', 'swapNav1', 'swapNav2', 'xpndrIdent',
] as const;

export type ControlId = (typeof CONTROL_IDS)[number];

export type ControlKind = 'axis' | 'bipolar' | 'detent' | 'switch' | 'setpoint' | 'action';

export interface ControlDef {
  id: ControlId;
  kind: ControlKind;
  label: string;
  min: number;
  max: number;
  /** quantisation step for setpoints / detent index */
  step?: number;
  perEngine?: boolean;
  /** Needs the sim to confirm a capability before being enabled. */
  needs?: 'gear' | 'flaps' | 'spoilers' | 'autopilot' | 'transponder' | 'com1' | 'com2' | 'nav1' | 'nav2';
  group: 'levers' | 'config' | 'lights' | 'systems' | 'autopilot' | 'radio';
}

const def = (d: ControlDef): [ControlId, ControlDef] => [d.id, d];

export const CONTROLS: Record<ControlId, ControlDef> = Object.fromEntries([
  def({ id: 'throttle', kind: 'axis', label: 'THROTTLE', min: 0, max: 1, perEngine: true, group: 'levers' }),
  def({ id: 'prop', kind: 'axis', label: 'PROP', min: 0, max: 1, perEngine: true, group: 'levers' }),
  def({ id: 'mixture', kind: 'axis', label: 'MIXTURE', min: 0, max: 1, perEngine: true, group: 'levers' }),
  def({ id: 'trim', kind: 'bipolar', label: 'TRIM', min: -1, max: 1, group: 'levers' }),
  def({ id: 'spoilers', kind: 'axis', label: 'SPOILERS', min: 0, max: 1, needs: 'spoilers', group: 'config' }),
  def({ id: 'flaps', kind: 'detent', label: 'FLAPS', min: 0, max: 8, step: 1, needs: 'flaps', group: 'config' }),
  def({ id: 'gear', kind: 'switch', label: 'GEAR', min: 0, max: 1, needs: 'gear', group: 'config' }),
  def({ id: 'parkingBrake', kind: 'switch', label: 'PARK BRAKE', min: 0, max: 1, group: 'config' }),
  def({ id: 'lightNav', kind: 'switch', label: 'NAV', min: 0, max: 1, group: 'lights' }),
  def({ id: 'lightBeacon', kind: 'switch', label: 'BCN', min: 0, max: 1, group: 'lights' }),
  def({ id: 'lightStrobe', kind: 'switch', label: 'STROBE', min: 0, max: 1, group: 'lights' }),
  def({ id: 'lightLanding', kind: 'switch', label: 'LDG', min: 0, max: 1, group: 'lights' }),
  def({ id: 'lightTaxi', kind: 'switch', label: 'TAXI', min: 0, max: 1, group: 'lights' }),
  def({ id: 'batteryMaster', kind: 'switch', label: 'BAT', min: 0, max: 1, group: 'systems' }),
  def({ id: 'avionicsMaster', kind: 'switch', label: 'AVIONICS', min: 0, max: 1, group: 'systems' }),
  def({ id: 'fuelPump', kind: 'switch', label: 'FUEL PUMP', min: 0, max: 1, perEngine: true, group: 'systems' }),
  def({ id: 'pitotHeat', kind: 'switch', label: 'PITOT', min: 0, max: 1, group: 'systems' }),
  def({ id: 'apMaster', kind: 'switch', label: 'AP', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apHeading', kind: 'switch', label: 'HDG', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apNav', kind: 'switch', label: 'NAV', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apApproach', kind: 'switch', label: 'APR', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apAltitude', kind: 'switch', label: 'ALT', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apVs', kind: 'switch', label: 'VS', min: 0, max: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apHeadingSel', kind: 'setpoint', label: 'HDG', min: 0, max: 359, step: 1, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apAltitudeSel', kind: 'setpoint', label: 'ALT', min: 0, max: 60000, step: 100, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'apVsSel', kind: 'setpoint', label: 'VS', min: -6000, max: 6000, step: 100, needs: 'autopilot', group: 'autopilot' }),
  def({ id: 'com1Active', kind: 'setpoint', label: 'COM1', min: 118_000_000, max: 136_990_000, step: 25_000, needs: 'com1', group: 'radio' }),
  def({ id: 'com1Standby', kind: 'setpoint', label: 'COM1 STBY', min: 118_000_000, max: 136_990_000, step: 25_000, needs: 'com1', group: 'radio' }),
  def({ id: 'com2Active', kind: 'setpoint', label: 'COM2', min: 118_000_000, max: 136_990_000, step: 25_000, needs: 'com2', group: 'radio' }),
  def({ id: 'com2Standby', kind: 'setpoint', label: 'COM2 STBY', min: 118_000_000, max: 136_990_000, step: 25_000, needs: 'com2', group: 'radio' }),
  def({ id: 'nav1Active', kind: 'setpoint', label: 'NAV1', min: 108_000_000, max: 117_950_000, step: 50_000, needs: 'nav1', group: 'radio' }),
  def({ id: 'nav1Standby', kind: 'setpoint', label: 'NAV1 STBY', min: 108_000_000, max: 117_950_000, step: 50_000, needs: 'nav1', group: 'radio' }),
  def({ id: 'nav2Active', kind: 'setpoint', label: 'NAV2', min: 108_000_000, max: 117_950_000, step: 50_000, needs: 'nav2', group: 'radio' }),
  def({ id: 'nav2Standby', kind: 'setpoint', label: 'NAV2 STBY', min: 108_000_000, max: 117_950_000, step: 50_000, needs: 'nav2', group: 'radio' }),
  def({ id: 'xpndrCode', kind: 'setpoint', label: 'XPDR', min: 0, max: 7777, step: 1, needs: 'transponder', group: 'radio' }),
  def({ id: 'xpndrMode', kind: 'setpoint', label: 'XPDR MODE', min: 0, max: 5, step: 1, needs: 'transponder', group: 'radio' }),
  def({ id: 'swapCom1', kind: 'action', label: 'COM1 SWAP', min: 0, max: 1, needs: 'com1', group: 'radio' }),
  def({ id: 'swapCom2', kind: 'action', label: 'COM2 SWAP', min: 0, max: 1, needs: 'com2', group: 'radio' }),
  def({ id: 'swapNav1', kind: 'action', label: 'NAV1 SWAP', min: 0, max: 1, needs: 'nav1', group: 'radio' }),
  def({ id: 'swapNav2', kind: 'action', label: 'NAV2 SWAP', min: 0, max: 1, needs: 'nav2', group: 'radio' }),
  def({ id: 'xpndrIdent', kind: 'action', label: 'IDENT', min: 0, max: 1, needs: 'transponder', group: 'radio' }),
] as const satisfies readonly [ControlId, ControlDef][]) as Record<ControlId, ControlDef>;

export function isControlId(s: string): s is ControlId {
  return (CONTROL_IDS as readonly string[]).includes(s);
}

export const MAX_ENGINES = 4;

/** State key of a control for a given engine (engine 1 / non-engine controls use the bare id). */
export function stateKey(control: ControlId, engine = 1): string {
  return CONTROLS[control].perEngine && engine > 1 ? `${control}${engine}` : control;
}

/** Quantise/clamp a requested value according to the control definition. */
export function sanitizeControlValue(control: ControlId, value: number): number {
  const d = CONTROLS[control];
  let v = clamp(value, d.min, d.max);
  if (d.kind === 'switch' || d.kind === 'action') return v >= 0.5 ? 1 : 0;
  if (d.step && (d.kind === 'setpoint' || d.kind === 'detent')) {
    v = Math.round((v - d.min) / d.step) * d.step + d.min;
    v = clamp(v, d.min, d.max);
  }
  return v;
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return v < min ? min : v > max ? max : v;
}

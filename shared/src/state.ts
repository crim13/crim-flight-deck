import { CONTROLS, MAX_ENGINES, type ControlId } from './controls';
import { clamp, clamp01, decodeBco16, encodeBco16 } from './util';

export type StateValue = number | string | null;
export type StateMap = Record<string, StateValue>;

export type EngineType = 'piston' | 'jet' | 'none' | 'helo' | 'unsupported' | 'turboprop' | 'electric';
// SimVar ENGINE TYPE enum: 0 Piston, 1 Jet, 2 None, 3 Helo(Bell) turbine, 4 Unsupported, 5 Turboprop, 6 Electric
const ENGINE_TYPES: EngineType[] = ['piston', 'jet', 'none', 'helo', 'unsupported', 'turboprop', 'electric'];

export function engineTypeFromEnum(n: number | null | undefined): EngineType | null {
  if (n == null) return null;
  return ENGINE_TYPES[Math.round(n)] ?? null;
}

export interface StateVarDef {
  /** state key (engine 1 / non-engine); per-engine keys get the engine number appended for n>1 */
  key: string;
  /** SimVar name; `{n}` is replaced by the engine index (omitted when the SimVar takes no index) */
  simvar: string;
  unit: string;
  type: 'num' | 'str';
  perEngine?: boolean;
  /** identity / caps / telemetry are always subscribed; control vars only when a control needs them */
  group: 'identity' | 'caps' | 'telemetry' | 'control';
  control?: ControlId;
  convert?: (raw: number) => number;
}

const pct = (v: number) => clamp01(v / 100);
const pct100 = (v: number) => clamp01(v);
const bool = (v: number) => (v >= 0.5 ? 1 : 0);
// telemetry is rounded to what the top bar shows, so jitter below that never produces a patch
const round1 = (v: number) => Math.round(v * 10) / 10;
const round10 = (v: number) => Math.round(v / 10) * 10;
const round05 = (v: number) => Math.round(v * 2) / 2 + 0; // + 0 turns -0 into 0
const heading = (v: number) => Math.round(((v % 360) + 360) % 360) % 360;

// Every SimVar name/unit here was checked against the MSFS 2024 SDK SimVar documentation
// (docs.flightsimulator.com/msfs2024 - aircraft simvars). See docs/VERIFICATION.md.
export const STATE_VARS: StateVarDef[] = [
  // --- identity (always subscribed) ---
  { key: 'id.title', simvar: 'TITLE', unit: '', type: 'str', group: 'identity' },
  { key: 'id.atcType', simvar: 'ATC TYPE', unit: '', type: 'str', group: 'identity' },
  { key: 'id.atcModel', simvar: 'ATC MODEL', unit: '', type: 'str', group: 'identity' },
  { key: 'id.engineType', simvar: 'ENGINE TYPE', unit: 'enum', type: 'num', group: 'identity' },
  { key: 'id.engineCount', simvar: 'NUMBER OF ENGINES', unit: 'number', type: 'num', group: 'identity' },
  // --- capabilities (always subscribed) ---
  { key: 'cap.gearRetractable', simvar: 'IS GEAR RETRACTABLE', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.flapsAvailable', simvar: 'FLAPS AVAILABLE', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.flapsCount', simvar: 'FLAPS NUM HANDLE POSITIONS', unit: 'number', type: 'num', group: 'caps' },
  { key: 'cap.spoilers', simvar: 'SPOILER AVAILABLE', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.autopilot', simvar: 'AUTOPILOT AVAILABLE', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.transponder', simvar: 'TRANSPONDER AVAILABLE', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.com1', simvar: 'COM AVAILABLE:1', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.com2', simvar: 'COM AVAILABLE:2', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.nav1', simvar: 'NAV AVAILABLE:1', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  { key: 'cap.nav2', simvar: 'NAV AVAILABLE:2', unit: 'bool', type: 'num', group: 'caps', convert: bool },
  // --- telemetry (top bar; read only) ---
  { key: 'tel.ias', simvar: 'AIRSPEED INDICATED', unit: 'knots', type: 'num', group: 'telemetry', convert: Math.round },
  { key: 'tel.gs', simvar: 'GROUND VELOCITY', unit: 'knots', type: 'num', group: 'telemetry', convert: Math.round },
  { key: 'tel.alt', simvar: 'INDICATED ALTITUDE', unit: 'feet', type: 'num', group: 'telemetry', convert: Math.round },
  { key: 'tel.vs', simvar: 'VERTICAL SPEED', unit: 'feet per minute', type: 'num', group: 'telemetry', convert: round10 },
  { key: 'tel.hdg', simvar: 'PLANE HEADING DEGREES MAGNETIC', unit: 'degrees', type: 'num', group: 'telemetry', convert: heading },
  // attitude indicator: raw simulator sign (the UI applies the sign convention, see web/controls/math attitudeView)
  { key: 'tel.pitch', simvar: 'ATTITUDE INDICATOR PITCH DEGREES', unit: 'degrees', type: 'num', group: 'telemetry', convert: round05 },
  { key: 'tel.bank', simvar: 'ATTITUDE INDICATOR BANK DEGREES', unit: 'degrees', type: 'num', group: 'telemetry', convert: round05 },
  { key: 'tel.fuelGal', simvar: 'FUEL TOTAL QUANTITY', unit: 'gallons', type: 'num', group: 'telemetry', convert: round1 },
  { key: 'tel.fuelLb', simvar: 'FUEL TOTAL QUANTITY WEIGHT', unit: 'pounds', type: 'num', group: 'telemetry', convert: Math.round },
  { key: 'tel.ff', simvar: 'ENG FUEL FLOW GPH:{n}', unit: 'gallons per hour', type: 'num', perEngine: true, group: 'telemetry', convert: round1 },
  // --- levers ---
  { key: 'throttle', simvar: 'GENERAL ENG THROTTLE LEVER POSITION:{n}', unit: 'percent', type: 'num', perEngine: true, group: 'control', control: 'throttle', convert: pct },
  { key: 'prop', simvar: 'GENERAL ENG PROPELLER LEVER POSITION:{n}', unit: 'percent', type: 'num', perEngine: true, group: 'control', control: 'prop', convert: pct },
  { key: 'mixture', simvar: 'GENERAL ENG MIXTURE LEVER POSITION:{n}', unit: 'percent', type: 'num', perEngine: true, group: 'control', control: 'mixture', convert: pct },
  { key: 'trim', simvar: 'ELEVATOR TRIM PCT EX2', unit: 'percent_over_100', type: 'num', group: 'control', control: 'trim', convert: (v) => clamp(v, -1, 1) },
  { key: 'spoilers', simvar: 'SPOILERS HANDLE POSITION', unit: 'percent_over_100', type: 'num', group: 'control', control: 'spoilers', convert: pct100 },
  { key: 'flaps', simvar: 'FLAPS HANDLE INDEX', unit: 'number', type: 'num', group: 'control', control: 'flaps', convert: Math.round },
  // --- gear & brakes ---
  { key: 'gear', simvar: 'GEAR HANDLE POSITION', unit: 'percent_over_100', type: 'num', group: 'control', control: 'gear', convert: (v) => (v > 0.5 ? 1 : 0) },
  { key: 'gearActual', simvar: 'GEAR TOTAL PCT EXTENDED', unit: 'percent', type: 'num', group: 'control', control: 'gear', convert: pct },
  { key: 'parkingBrake', simvar: 'BRAKE PARKING POSITION', unit: 'bool', type: 'num', group: 'control', control: 'parkingBrake', convert: bool },
  // --- lights / systems ---
  { key: 'lightNav', simvar: 'LIGHT NAV', unit: 'bool', type: 'num', group: 'control', control: 'lightNav', convert: bool },
  { key: 'lightBeacon', simvar: 'LIGHT BEACON', unit: 'bool', type: 'num', group: 'control', control: 'lightBeacon', convert: bool },
  { key: 'lightStrobe', simvar: 'LIGHT STROBE', unit: 'bool', type: 'num', group: 'control', control: 'lightStrobe', convert: bool },
  { key: 'lightLanding', simvar: 'LIGHT LANDING', unit: 'bool', type: 'num', group: 'control', control: 'lightLanding', convert: bool },
  { key: 'lightTaxi', simvar: 'LIGHT TAXI', unit: 'bool', type: 'num', group: 'control', control: 'lightTaxi', convert: bool },
  { key: 'batteryMaster', simvar: 'ELECTRICAL MASTER BATTERY:1', unit: 'bool', type: 'num', group: 'control', control: 'batteryMaster', convert: bool },
  { key: 'avionicsMaster', simvar: 'AVIONICS MASTER SWITCH', unit: 'bool', type: 'num', group: 'control', control: 'avionicsMaster', convert: bool },
  { key: 'fuelPump', simvar: 'GENERAL ENG FUEL PUMP SWITCH:{n}', unit: 'bool', type: 'num', perEngine: true, group: 'control', control: 'fuelPump', convert: bool },
  { key: 'pitotHeat', simvar: 'PITOT HEAT SWITCH:1', unit: 'enum', type: 'num', group: 'control', control: 'pitotHeat', convert: (v) => (v >= 0.5 ? 1 : 0) },
  // --- autopilot ---
  { key: 'apMaster', simvar: 'AUTOPILOT MASTER', unit: 'bool', type: 'num', group: 'control', control: 'apMaster', convert: bool },
  { key: 'apHeading', simvar: 'AUTOPILOT HEADING LOCK', unit: 'bool', type: 'num', group: 'control', control: 'apHeading', convert: bool },
  { key: 'apNav', simvar: 'AUTOPILOT NAV1 LOCK', unit: 'bool', type: 'num', group: 'control', control: 'apNav', convert: bool },
  { key: 'apApproach', simvar: 'AUTOPILOT APPROACH HOLD', unit: 'bool', type: 'num', group: 'control', control: 'apApproach', convert: bool },
  { key: 'apAltitude', simvar: 'AUTOPILOT ALTITUDE LOCK', unit: 'bool', type: 'num', group: 'control', control: 'apAltitude', convert: bool },
  { key: 'apVs', simvar: 'AUTOPILOT VERTICAL HOLD', unit: 'bool', type: 'num', group: 'control', control: 'apVs', convert: bool },
  { key: 'apHeadingSel', simvar: 'AUTOPILOT HEADING LOCK DIR', unit: 'degrees', type: 'num', group: 'control', control: 'apHeadingSel', convert: (v) => Math.round(((v % 360) + 360) % 360) },
  { key: 'apAltitudeSel', simvar: 'AUTOPILOT ALTITUDE LOCK VAR', unit: 'feet', type: 'num', group: 'control', control: 'apAltitudeSel', convert: Math.round },
  { key: 'apVsSel', simvar: 'AUTOPILOT VERTICAL HOLD VAR', unit: 'feet/minute', type: 'num', group: 'control', control: 'apVsSel', convert: Math.round },
  // --- radios (Hz) ---
  { key: 'com1Active', simvar: 'COM ACTIVE FREQUENCY:1', unit: 'hz', type: 'num', group: 'control', control: 'com1Active', convert: Math.round },
  { key: 'com1Standby', simvar: 'COM STANDBY FREQUENCY:1', unit: 'hz', type: 'num', group: 'control', control: 'com1Standby', convert: Math.round },
  { key: 'com2Active', simvar: 'COM ACTIVE FREQUENCY:2', unit: 'hz', type: 'num', group: 'control', control: 'com2Active', convert: Math.round },
  { key: 'com2Standby', simvar: 'COM STANDBY FREQUENCY:2', unit: 'hz', type: 'num', group: 'control', control: 'com2Standby', convert: Math.round },
  { key: 'nav1Active', simvar: 'NAV ACTIVE FREQUENCY:1', unit: 'hz', type: 'num', group: 'control', control: 'nav1Active', convert: Math.round },
  { key: 'nav1Standby', simvar: 'NAV STANDBY FREQUENCY:1', unit: 'hz', type: 'num', group: 'control', control: 'nav1Standby', convert: Math.round },
  { key: 'nav2Active', simvar: 'NAV ACTIVE FREQUENCY:2', unit: 'hz', type: 'num', group: 'control', control: 'nav2Active', convert: Math.round },
  { key: 'nav2Standby', simvar: 'NAV STANDBY FREQUENCY:2', unit: 'hz', type: 'num', group: 'control', control: 'nav2Standby', convert: Math.round },
  { key: 'xpndrCode', simvar: 'TRANSPONDER CODE:1', unit: 'bco16', type: 'num', group: 'control', control: 'xpndrCode', convert: decodeBco16 },
  { key: 'xpndrMode', simvar: 'TRANSPONDER STATE:1', unit: 'enum', type: 'num', group: 'control', control: 'xpndrMode', convert: Math.round },
];

export const STATE_VAR_BY_KEY: Record<string, StateVarDef> = Object.fromEntries(STATE_VARS.map((v) => [v.key, v]));

export interface SubscriptionVar {
  /** wire id == state key (with engine suffix) */
  id: string;
  name: string;
  unit: string;
  type: 'num' | 'str';
}

export function engineKey(base: string, engine: number): string {
  return engine > 1 ? `${base}${engine}` : base;
}

function expand(v: StateVarDef, engine: number): SubscriptionVar {
  const name = v.perEngine ? v.simvar.replace('{n}', String(engine)) : v.simvar;
  return { id: v.perEngine ? engineKey(v.key, engine) : v.key, name, unit: v.unit, type: v.type };
}

/** SimVars the server needs for the given set of enabled controls (+identity & capability vars). */
export function buildSubscriptions(enabled: Iterable<ControlId>, engines: number): SubscriptionVar[] {
  const wanted = new Set<ControlId>(enabled);
  const out: SubscriptionVar[] = [];
  const n = Math.max(1, Math.min(MAX_ENGINES, engines));
  for (const v of STATE_VARS) {
    if (v.group !== 'control' || (v.control && wanted.has(v.control))) {
      if (v.perEngine) for (let e = 1; e <= n; e++) out.push(expand(v, e));
      else out.push(expand(v, 1));
    }
  }
  return out;
}

/** Convert a raw SimConnect value to the normalised state value for subscription id. */
export function convertRaw(id: string, raw: number | string): StateValue {
  const base = id.replace(/^([a-zA-Z.]+?)([2-4])$/, (m, b) => (STATE_VAR_BY_KEY[b]?.perEngine ? b : m));
  const def = STATE_VAR_BY_KEY[base] ?? STATE_VAR_BY_KEY[id];
  if (!def) return null;
  if (def.type === 'str') return typeof raw === 'string' ? raw : String(raw);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return def.convert ? def.convert(n) : n;
}

function lookupDef(id: string): StateVarDef | undefined {
  if (STATE_VAR_BY_KEY[id]) return STATE_VAR_BY_KEY[id];
  const m = /^(.+?)([2-4])$/.exec(id);
  const base = m ? STATE_VAR_BY_KEY[m[1]!] : undefined;
  return base?.perEngine ? base : undefined;
}

/** Inverse of convertRaw (normalised state value -> SimConnect raw unit). Used by the mock adapter only. */
export function stateToRaw(id: string, v: number | string): number | string {
  const def = lookupDef(id);
  if (!def || typeof v === 'string') return v;
  if (def.unit === 'percent') return v * 100;
  if (def.unit === 'bco16') return encodeBco16(v);
  return v;
}

// ---- capabilities derived from state ----
export interface SimCaps {
  engineCount: number | null;
  engineType: EngineType | null;
  gearRetractable: boolean | null;
  flapsAvailable: boolean | null;
  flapsCount: number | null;
  spoilers: boolean | null;
  autopilot: boolean | null;
  transponder: boolean | null;
  com1: boolean | null;
  com2: boolean | null;
  nav1: boolean | null;
  nav2: boolean | null;
}

const b = (v: StateValue | undefined): boolean | null => (typeof v === 'number' ? v >= 0.5 : null);
const n = (v: StateValue | undefined): number | null => (typeof v === 'number' ? v : null);

export function computeCaps(s: StateMap): SimCaps {
  return {
    engineCount: n(s['id.engineCount']),
    engineType: engineTypeFromEnum(n(s['id.engineType'])),
    gearRetractable: b(s['cap.gearRetractable']),
    flapsAvailable: b(s['cap.flapsAvailable']),
    flapsCount: n(s['cap.flapsCount']),
    spoilers: b(s['cap.spoilers']),
    autopilot: b(s['cap.autopilot']),
    transponder: b(s['cap.transponder']),
    com1: b(s['cap.com1']),
    com2: b(s['cap.com2']),
    nav1: b(s['cap.nav1']),
    nav2: b(s['cap.nav2']),
  };
}

export interface AircraftIdentity {
  title: string | null;
  atcType: string | null;
  atcModel: string | null;
  engineType: EngineType | null;
  engineCount: number | null;
}

export function identityFromState(s: StateMap): AircraftIdentity {
  const str = (v: StateValue | undefined) => (typeof v === 'string' && v.length ? v : null);
  return {
    title: str(s['id.title']),
    atcType: str(s['id.atcType']),
    atcModel: str(s['id.atcModel']),
    engineType: engineTypeFromEnum(n(s['id.engineType'])),
    engineCount: n(s['id.engineCount']),
  };
}

/** Stable key used to remember a per-aircraft profile choice. */
export function aircraftKey(id: AircraftIdentity): string | null {
  const k = id.title ?? id.atcModel ?? id.atcType;
  return k ? k.trim().toLowerCase() : null;
}

export const GEAR_TRANSIT_EPS = 0.02;

export type GearIndication = 'up' | 'down' | 'transit';

export function gearIndication(actual: number | null | undefined): GearIndication | null {
  if (typeof actual !== 'number') return null;
  if (actual <= GEAR_TRANSIT_EPS) return 'up';
  if (actual >= 1 - GEAR_TRANSIT_EPS) return 'down';
  return 'transit';
}

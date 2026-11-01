import {
  decodeBco16, stateToRaw, type SimCommand, type StateMap, type SubscriptionVar,
} from '@crim/shared';
import type { Logger } from '../logger';
import { AdapterEvents, type AdapterError, type AdapterStatus, type RawValues, type SimAdapter } from './types';

export interface MockAircraft {
  title: string;
  atcModel: string;
  engineType: number; // SimVar ENGINE TYPE enum
  engines: number;
  retractable: boolean;
  flapsPositions: number;
  spoilers: boolean;
}

export const MOCK_AIRCRAFT: Record<string, MockAircraft> = {
  c172: { title: 'Cessna 172 Skyhawk (mock)', atcModel: 'C172', engineType: 0, engines: 1, retractable: false, flapsPositions: 4, spoilers: false },
  bonanza: { title: 'Beechcraft Bonanza G36 (mock)', atcModel: 'BE36', engineType: 0, engines: 1, retractable: true, flapsPositions: 3, spoilers: false },
  baron: { title: 'Beechcraft Baron G58 (mock)', atcModel: 'BE58', engineType: 0, engines: 2, retractable: true, flapsPositions: 3, spoilers: false },
  tbm: { title: 'TBM 930 (mock)', atcModel: 'TBM9', engineType: 5, engines: 1, retractable: true, flapsPositions: 3, spoilers: false },
  citation: { title: 'Cessna Citation CJ4 (mock)', atcModel: 'C25C', engineType: 1, engines: 2, retractable: true, flapsPositions: 4, spoilers: true },
};

const MOCK_FIELD_FT = 1200;
const MOCK_LB_PER_GAL = 6;

const TOGGLES: Record<string, string> = {
  TOGGLE_NAV_LIGHTS: 'lightNav', TOGGLE_BEACON_LIGHTS: 'lightBeacon', STROBES_TOGGLE: 'lightStrobe',
  LANDING_LIGHTS_TOGGLE: 'lightLanding', TOGGLE_TAXI_LIGHTS: 'lightTaxi', TOGGLE_MASTER_BATTERY: 'batteryMaster',
  PITOT_HEAT_TOGGLE: 'pitotHeat', AP_PANEL_HEADING_HOLD: 'apHeading', AP_NAV1_HOLD: 'apNav', AP_APR_HOLD: 'apApproach',
  AP_PANEL_ALTITUDE_HOLD: 'apAltitude', AP_PANEL_VS_HOLD: 'apVs',
};
const SETS: Record<string, string> = {
  COM_RADIO_SET_HZ: 'com1Active', COM_STBY_RADIO_SET_HZ: 'com1Standby', COM2_RADIO_SET_HZ: 'com2Active',
  COM2_STBY_RADIO_SET_HZ: 'com2Standby', NAV1_RADIO_SET_HZ: 'nav1Active', NAV1_STBY_SET_HZ: 'nav1Standby',
  NAV2_RADIO_SET_HZ: 'nav2Active', NAV2_STBY_SET_HZ: 'nav2Standby',
  HEADING_BUG_SET: 'apHeadingSel', AP_ALT_VAR_SET_ENGLISH: 'apAltitudeSel', AP_VS_VAR_SET_ENGLISH: 'apVsSel',
  AVIONICS_MASTER_SET: 'avionicsMaster', PARKING_BRAKE_SET: 'parkingBrake', GEAR_SET: 'gear',
};
const SWAPS: Record<string, [string, string]> = {
  COM1_RADIO_SWAP: ['com1Active', 'com1Standby'], COM2_RADIO_SWAP: ['com2Active', 'com2Standby'],
  NAV1_RADIO_SWAP: ['nav1Active', 'nav1Standby'], NAV2_RADIO_SWAP: ['nav2Active', 'nav2Standby'],
};

/** Every event name the mock understands - tests assert it covers all default mappings. */
export const MOCK_SUPPORTED_EVENTS: string[] = [
  ...Object.keys(TOGGLES), ...Object.keys(SETS), ...Object.keys(SWAPS),
  'THROTTLE1_SET', 'THROTTLE2_SET', 'THROTTLE3_SET', 'THROTTLE4_SET',
  'PROP_PITCH1_SET', 'PROP_PITCH2_SET', 'PROP_PITCH3_SET', 'PROP_PITCH4_SET',
  'MIXTURE1_SET', 'MIXTURE2_SET', 'MIXTURE3_SET', 'MIXTURE4_SET',
  'ELEVATOR_TRIM_SET', 'SPOILERS_SET', 'FLAPS_SET', 'FUEL_PUMP', 'AUTOPILOT_ON', 'AUTOPILOT_OFF', 'XPNDR_SET', 'XPNDR_IDENT_ON',
];

export interface MockOptions {
  latencyMs?: number;
  connectDelayMs?: number;
  autoConnect?: boolean;
  aircraft?: string;
  /** run a toy flight model so the top bar telemetry moves (off by default so tests stay deterministic) */
  flight?: boolean;
}

/**
 * Development-only simulator stand-in. It reports itself as `mock: true` so every UI shows a
 * MOCK banner; it is never selected unless explicitly requested (--adapter mock).
 */
export class MockAdapter implements SimAdapter {
  readonly kind = 'mock' as const;
  readonly mock = true;
  private ev = new AdapterEvents();
  private values: StateMap = {};
  private subs = new Set<string>();
  private connected = false;
  private timers = new Set<NodeJS.Timeout>();
  private gearTimer: NodeJS.Timeout | null = null;
  private flightTimer: NodeJS.Timeout | null = null;
  private aircraft: MockAircraft = MOCK_AIRCRAFT.c172!;
  readonly sent: SimCommand[] = [];

  constructor(private readonly log: Logger, private readonly opts: MockOptions = {}) {
    this.loadAircraft(opts.aircraft ?? 'c172');
  }

  onStatus(cb: (s: AdapterStatus) => void): void { this.ev.onStatus(cb); }
  onData(cb: (v: RawValues) => void): void { this.ev.onData(cb); }
  onError(cb: (e: AdapterError) => void): void { this.ev.onError(cb); }
  getStatus(): AdapterStatus { return this.ev.status; }

  start(): void {
    this.ev.emitStatus({ bridge: 'running', sim: 'disconnected', detail: 'MOCK adapter (no simulator)' });
    if (this.opts.autoConnect !== false) this.connect();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.gearTimer) clearInterval(this.gearTimer);
    if (this.flightTimer) clearInterval(this.flightTimer);
    this.flightTimer = null;
    this.connected = false;
    this.ev.emitStatus({ bridge: 'stopped', sim: 'disconnected' });
  }

  // --- development controls (mock only) ---
  connect(): void {
    this.ev.emitStatus({ sim: 'connecting', detail: 'MOCK connecting' });
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.connected = true;
      this.ev.emitStatus({ sim: 'connected', detail: 'MOCK simulator', simApp: 'Mock MSFS 2024' });
      this.emitAll();
      this.startFlight();
    }, this.opts.connectDelayMs ?? 60);
    this.timers.add(t);
  }

  disconnect(): void {
    this.connected = false;
    this.ev.emitStatus({ sim: 'disconnected', detail: 'MOCK simulator went away', simApp: undefined });
  }

  setAircraft(key: string): void {
    this.loadAircraft(key);
    if (this.connected) this.emitAll();
  }

  /** Simulates a change made inside the virtual cockpit (value is normalised state, not raw). */
  simulate(id: string, value: number | string): void {
    this.values[id] = value;
    this.emit([id]);
  }

  snapshot(): StateMap { return { ...this.values }; }

  private loadAircraft(key: string): void {
    const a = MOCK_AIRCRAFT[key];
    if (!a) throw new Error(`unknown mock aircraft ${key}`);
    this.aircraft = a;
    const v: StateMap = {
      'id.title': a.title, 'id.atcType': a.atcModel, 'id.atcModel': a.atcModel, 'id.engineType': a.engineType, 'id.engineCount': a.engines,
      'cap.gearRetractable': a.retractable ? 1 : 0, 'cap.flapsAvailable': 1, 'cap.flapsCount': a.flapsPositions,
      'cap.spoilers': a.spoilers ? 1 : 0, 'cap.autopilot': 1, 'cap.transponder': 1, 'cap.com1': 1, 'cap.com2': 1, 'cap.nav1': 1, 'cap.nav2': 1,
      throttle: 0, prop: 1, mixture: 1, trim: 0, spoilers: 0, flaps: 0, gear: a.retractable ? 1 : 1, gearActual: 1, parkingBrake: 1,
      lightNav: 0, lightBeacon: 0, lightStrobe: 0, lightLanding: 0, lightTaxi: 0, batteryMaster: 0, avionicsMaster: 0, pitotHeat: 0, fuelPump: 0,
      apMaster: 0, apHeading: 0, apNav: 0, apApproach: 0, apAltitude: 0, apVs: 0, apHeadingSel: 90, apAltitudeSel: 3000, apVsSel: 0,
      com1Active: 118_300_000, com1Standby: 121_500_000, com2Active: 118_000_000, com2Standby: 119_000_000,
      nav1Active: 110_300_000, nav1Standby: 111_500_000, nav2Active: 108_000_000, nav2Standby: 109_000_000,
      xpndrCode: 1200, xpndrMode: 1,
      'tel.ias': 0, 'tel.gs': 0, 'tel.alt': MOCK_FIELD_FT, 'tel.vs': 0, 'tel.hdg': 90, 'tel.pitch': 0, 'tel.bank': 0,
      'tel.fuelGal': a.engines > 1 ? 120 : 53, 'tel.fuelLb': (a.engines > 1 ? 120 : 53) * MOCK_LB_PER_GAL,
    };
    for (let e = 1; e <= a.engines; e++) v[e === 1 ? 'tel.ff' : `tel.ff${e}`] = 0;
    for (let e = 2; e <= 4; e++) {
      v[`throttle${e}`] = 0; v[`prop${e}`] = 1; v[`mixture${e}`] = 1; v[`fuelPump${e}`] = 0;
    }
    this.values = v;
  }

  // --- toy flight model (mock only): speed follows the throttle, climb follows throttle/trim, AP holds ---
  private startFlight(): void {
    if (!this.opts.flight || this.flightTimer) return;
    this.flightTimer = setInterval(() => this.tickFlight(0.5), 500);
  }

  private tickFlight(dt: number): void {
    if (!this.connected) return;
    const v = this.values;
    const num = (k: string, d = 0) => (typeof v[k] === 'number' ? (v[k] as number) : d);
    const n = this.aircraft.engines;
    const thr = (e: number) => num(e === 1 ? 'throttle' : `throttle${e}`);
    let avg = 0;
    for (let e = 1; e <= n; e++) avg += thr(e) / n;

    const target = num('parkingBrake') ? 0 : Math.max(0, avg - 0.15) * 150;
    const ias = num('tel.ias') + (target - num('tel.ias')) * 0.25;
    const airborne = ias > 55;
    let vs = airborne ? (avg - 0.6) * 1400 - num('trim') * 700 : 0;
    if (airborne && num('apAltitude')) vs = Math.max(-1000, Math.min(1000, (num('apAltitudeSel') - num('tel.alt')) * 0.5));
    let alt = num('tel.alt') + (vs / 60) * dt;
    if (alt < MOCK_FIELD_FT) { alt = MOCK_FIELD_FT; vs = Math.max(0, vs); }
    let hdg = num('tel.hdg');
    let bankRight = 0;
    if (airborne && num('apHeading')) {
      const diff = ((num('apHeadingSel') - hdg + 540) % 360) - 180;
      hdg += Math.max(-3 * dt, Math.min(3 * dt, diff));
      bankRight = Math.max(-25, Math.min(25, diff * 0.6));
    }
    // simulator sign convention assumed by the UI default: nose down / right wing down are positive (see attitudeView)
    const pitchUp = airborne ? Math.atan2(vs / 60, Math.max(1, ias) * 1.688) * (180 / Math.PI) + 2 : 0;
    v['tel.pitch'] = -pitchUp;
    v['tel.bank'] = -bankRight;
    let burn = 0;
    for (let e = 1; e <= n; e++) {
      const gph = 1.2 + thr(e) * 9;
      v[e === 1 ? 'tel.ff' : `tel.ff${e}`] = gph;
      burn += gph;
    }
    const gal = Math.max(0, num('tel.fuelGal') - (burn * dt) / 3600);
    v['tel.ias'] = ias;
    v['tel.gs'] = ias;
    v['tel.alt'] = alt;
    v['tel.vs'] = vs;
    v['tel.hdg'] = ((hdg % 360) + 360) % 360;
    v['tel.fuelGal'] = gal;
    v['tel.fuelLb'] = gal * MOCK_LB_PER_GAL;
    this.emit(Object.keys(v).filter((k) => k.startsWith('tel.')));
  }

  // --- SimAdapter ---
  setSubscriptions(vars: SubscriptionVar[]): void {
    this.subs = new Set(vars.map((x) => x.id));
    if (this.connected) this.emitAll();
  }

  send(cmd: SimCommand): void {
    this.sent.push(cmd);
    if (this.sent.length > 500) this.sent.shift();
    if (!this.connected) {
      this.ev.emitError({ code: 'sim-offline', message: 'MOCK simulator not connected' });
      return;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.apply(cmd);
    }, this.opts.latencyMs ?? 30);
    this.timers.add(t);
  }

  private apply(cmd: SimCommand): void {
    const changed: string[] = [];
    const set = (k: string, v: number) => { if (this.values[k] !== v) { this.values[k] = v; changed.push(k); } };
    const bool = (n: number) => (n >= 1 ? 1 : 0);
    if (cmd.kind === 'setvar') {
      set(cmd.var, cmd.value);
    } else if (cmd.kind === 'inputEvent') {
      this.log.debug(`mock: input event ${cmd.name}=${cmd.value} ignored`);
    } else {
      const { event: e, data: d } = cmd;
      const d0 = d[0] ?? 0;
      let m: RegExpExecArray | null;
      const eng = (n: string) => (n === '1' ? '' : n);
      if ((m = /^THROTTLE([1-4])_SET$/.exec(e))) set(`throttle${eng(m[1]!)}`, d0 / 16383);
      else if ((m = /^PROP_PITCH([1-4])_SET$/.exec(e))) set(`prop${eng(m[1]!)}`, d0 / 16383);
      else if ((m = /^MIXTURE([1-4])_SET$/.exec(e))) set(`mixture${eng(m[1]!)}`, d0 / 16383);
      else if (e === 'ELEVATOR_TRIM_SET') set('trim', Math.max(-1, Math.min(1, d0 / 16383)));
      else if (e === 'SPOILERS_SET') set('spoilers', d0 / 16383);
      else if (e === 'FLAPS_SET') set('flaps', Math.round((d0 / 16383) * (this.aircraft.flapsPositions - 1)));
      else if (e === 'GEAR_SET') { set('gear', bool(d0)); this.animateGear(); }
      else if (e === 'FUEL_PUMP') { const k = `fuelPump${eng(String(d0 || 1))}`; set(k, this.values[k] ? 0 : 1); }
      else if (e === 'AUTOPILOT_ON') set('apMaster', 1);
      else if (e === 'AUTOPILOT_OFF') set('apMaster', 0);
      else if (e === 'XPNDR_SET') set('xpndrCode', decodeBco16(d0));
      else if (e === 'XPNDR_IDENT_ON') { /* no visible state */ }
      else if (TOGGLES[e]) set(TOGGLES[e]!, this.values[TOGGLES[e]!] ? 0 : 1);
      else if (SWAPS[e]) { const [a, b] = SWAPS[e]!; const x = this.values[a]; set(a, this.values[b] as number); set(b, x as number); }
      else if (SETS[e]) {
        const k = SETS[e]!;
        set(k, k === 'apVsSel' ? (d0 | 0) : k === 'avionicsMaster' || k === 'parkingBrake' ? bool(d0) : d0);
      } else {
        this.ev.emitError({ code: 'sdk-error', message: `MOCK: unknown event ${e}` });
      }
    }
    if (changed.length) this.emit(changed);
  }

  private animateGear(): void {
    if (this.gearTimer) return;
    this.gearTimer = setInterval(() => {
      const target = this.values.gear as number;
      const cur = this.values.gearActual as number;
      const next = cur + Math.sign(target - cur) * 0.1;
      const done = Math.abs(target - next) < 0.05;
      this.values.gearActual = done ? target : next;
      this.emit(['gearActual']);
      if (done && this.gearTimer) { clearInterval(this.gearTimer); this.gearTimer = null; }
    }, 100);
  }

  private emit(ids: string[]): void {
    if (!this.connected) return;
    const out: RawValues = {};
    for (const id of ids) if (this.subs.has(id) && this.values[id] != null) out[id] = stateToRaw(id, this.values[id]!);
    if (Object.keys(out).length) this.ev.emitData(out);
  }

  private emitAll(): void {
    this.emit(Object.keys(this.values));
  }
}

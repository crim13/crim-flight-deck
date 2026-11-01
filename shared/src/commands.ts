import { z } from 'zod';
import { CONTROLS, stateKey, type ControlId } from './controls';
import type { StateMap } from './state';
import { encodeBco16, toRaw16383, toSigned16383 } from './util';

// ---------------------------------------------------------------------------
// Command mappings: how a logical control value becomes SimConnect traffic.
// Profiles may override the default mapping of any control (extension point for
// aircraft specific integrations, including Input Events).
// ---------------------------------------------------------------------------

export const EncodingSchema = z.enum(['raw16383', 'signed16383', 'bool', 'int', 'detent16383', 'bco16', 'none']);
export type Encoding = z.infer<typeof EncodingSchema>;

export const CommandMappingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    event: z.string().min(1).max(64),
    encoding: EncodingSchema,
    /** pass the engine index as first data parameter */
    engineParam: z.boolean().optional(),
    /** extra trailing data parameters, e.g. a "pilot" index */
    extra: z.array(z.number().int()).max(3).optional(),
  }),
  z.object({
    kind: z.literal('toggle'),
    event: z.string().min(1).max(64),
    engineParam: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('absolutePair'),
    onEvent: z.string().min(1).max(64),
    offEvent: z.string().min(1).max(64),
  }),
  z.object({ kind: z.literal('setvar') }),
  z.object({
    kind: z.literal('inputEvent'),
    /** Input Event name as enumerated from the aircraft (B:var). Aircraft specific. */
    name: z.string().min(1).max(128),
    scale: z.number().optional(),
  }),
]);
export type CommandMapping = z.infer<typeof CommandMappingSchema>;

export type SimCommand =
  | { kind: 'event'; event: string; data: number[] }
  | { kind: 'setvar'; var: string; value: number }
  | { kind: 'inputEvent'; name: string; value: number };

/** Default mapping per control. Event names: MSFS 2024 SDK "Key Events" (see docs/VERIFICATION.md). */
export const DEFAULT_MAPPINGS: Record<ControlId, CommandMapping> = {
  throttle: { kind: 'event', event: 'THROTTLE{n}_SET', encoding: 'raw16383' },
  prop: { kind: 'event', event: 'PROP_PITCH{n}_SET', encoding: 'raw16383' },
  mixture: { kind: 'event', event: 'MIXTURE{n}_SET', encoding: 'raw16383' },
  trim: { kind: 'event', event: 'ELEVATOR_TRIM_SET', encoding: 'signed16383' },
  spoilers: { kind: 'event', event: 'SPOILERS_SET', encoding: 'raw16383' },
  flaps: { kind: 'event', event: 'FLAPS_SET', encoding: 'detent16383' },
  gear: { kind: 'event', event: 'GEAR_SET', encoding: 'bool' },
  parkingBrake: { kind: 'event', event: 'PARKING_BRAKE_SET', encoding: 'bool' },
  lightNav: { kind: 'toggle', event: 'TOGGLE_NAV_LIGHTS' },
  lightBeacon: { kind: 'toggle', event: 'TOGGLE_BEACON_LIGHTS' },
  lightStrobe: { kind: 'toggle', event: 'STROBES_TOGGLE' },
  lightLanding: { kind: 'toggle', event: 'LANDING_LIGHTS_TOGGLE' },
  lightTaxi: { kind: 'toggle', event: 'TOGGLE_TAXI_LIGHTS' },
  batteryMaster: { kind: 'toggle', event: 'TOGGLE_MASTER_BATTERY' },
  avionicsMaster: { kind: 'event', event: 'AVIONICS_MASTER_SET', encoding: 'bool' },
  fuelPump: { kind: 'toggle', event: 'FUEL_PUMP', engineParam: true },
  pitotHeat: { kind: 'toggle', event: 'PITOT_HEAT_TOGGLE' },
  apMaster: { kind: 'absolutePair', onEvent: 'AUTOPILOT_ON', offEvent: 'AUTOPILOT_OFF' },
  apHeading: { kind: 'toggle', event: 'AP_PANEL_HEADING_HOLD' },
  apNav: { kind: 'toggle', event: 'AP_NAV1_HOLD' },
  apApproach: { kind: 'toggle', event: 'AP_APR_HOLD' },
  apAltitude: { kind: 'toggle', event: 'AP_PANEL_ALTITUDE_HOLD' },
  apVs: { kind: 'toggle', event: 'AP_PANEL_VS_HOLD' },
  apHeadingSel: { kind: 'event', event: 'HEADING_BUG_SET', encoding: 'int', extra: [1] },
  apAltitudeSel: { kind: 'event', event: 'AP_ALT_VAR_SET_ENGLISH', encoding: 'int', extra: [1] },
  apVsSel: { kind: 'event', event: 'AP_VS_VAR_SET_ENGLISH', encoding: 'int', extra: [1] },
  com1Active: { kind: 'event', event: 'COM_RADIO_SET_HZ', encoding: 'int' },
  com1Standby: { kind: 'event', event: 'COM_STBY_RADIO_SET_HZ', encoding: 'int' },
  com2Active: { kind: 'event', event: 'COM2_RADIO_SET_HZ', encoding: 'int' },
  com2Standby: { kind: 'event', event: 'COM2_STBY_RADIO_SET_HZ', encoding: 'int' },
  nav1Active: { kind: 'event', event: 'NAV1_RADIO_SET_HZ', encoding: 'int' },
  nav1Standby: { kind: 'event', event: 'NAV1_STBY_SET_HZ', encoding: 'int' },
  nav2Active: { kind: 'event', event: 'NAV2_RADIO_SET_HZ', encoding: 'int' },
  nav2Standby: { kind: 'event', event: 'NAV2_STBY_SET_HZ', encoding: 'int' },
  xpndrCode: { kind: 'event', event: 'XPNDR_SET', encoding: 'bco16' },
  xpndrMode: { kind: 'setvar' },
  swapCom1: { kind: 'event', event: 'COM1_RADIO_SWAP', encoding: 'none' },
  swapCom2: { kind: 'event', event: 'COM2_RADIO_SWAP', encoding: 'none' },
  swapNav1: { kind: 'event', event: 'NAV1_RADIO_SWAP', encoding: 'none' },
  swapNav2: { kind: 'event', event: 'NAV2_RADIO_SWAP', encoding: 'none' },
  xpndrIdent: { kind: 'event', event: 'XPNDR_IDENT_ON', encoding: 'none' },
};

export interface PlanContext {
  control: ControlId;
  engine: number;
  /** already sanitised via sanitizeControlValue */
  value: number;
  state: StateMap;
  /** highest flap handle index (needed to encode FLAPS_SET) */
  flapsMax: number | null;
  mapping?: CommandMapping;
}

export type PlanResult =
  | { ok: true; commands: SimCommand[]; redundant: boolean }
  | { ok: false; code: 'state-unknown' | 'bad-mapping'; message: string };

const tpl = (name: string, engine: number) => name.replace('{n}', String(engine));

function encode(enc: Encoding, value: number, ctx: PlanContext): number | null | 'missing' {
  switch (enc) {
    case 'raw16383': return toRaw16383(value);
    case 'signed16383': return toSigned16383(value);
    case 'bool': return value >= 0.5 ? 1 : 0;
    case 'int': return Math.round(value);
    case 'bco16': return encodeBco16(value);
    case 'detent16383':
      if (!ctx.flapsMax || ctx.flapsMax < 1) return 'missing';
      return toRaw16383(value / ctx.flapsMax);
    case 'none': return null;
  }
}

/**
 * Pure planner: turns "control X should be value V" into the minimum set of SimConnect
 * commands. Toggle-style simulator events become absolute commands by comparing with the
 * current simulator state, so a stale or repeated UI request can never flip the wrong way.
 */
export function planCommand(ctx: PlanContext): PlanResult {
  const mapping = ctx.mapping ?? DEFAULT_MAPPINGS[ctx.control];
  const key = stateKey(ctx.control, ctx.engine);
  const current = ctx.state[key];
  const def = CONTROLS[ctx.control];

  switch (mapping.kind) {
    case 'event': {
      if (def.kind === 'action' && ctx.value < 0.5) return { ok: true, commands: [], redundant: true };
      const enc = encode(mapping.encoding, ctx.value, ctx);
      if (enc === 'missing') return { ok: false, code: 'state-unknown', message: 'Flap detent count not known yet' };
      const data: number[] = [];
      if (mapping.engineParam) data.push(ctx.engine);
      if (enc !== null) data.push(enc);
      if (mapping.extra) data.push(...mapping.extra);
      return { ok: true, redundant: false, commands: [{ kind: 'event', event: tpl(mapping.event, ctx.engine), data }] };
    }
    case 'toggle': {
      if (typeof current !== 'number') return { ok: false, code: 'state-unknown', message: `State of ${key} unknown; refusing blind toggle` };
      if ((current >= 0.5) === (ctx.value >= 0.5)) return { ok: true, commands: [], redundant: true };
      return {
        ok: true,
        redundant: false,
        commands: [{ kind: 'event', event: tpl(mapping.event, ctx.engine), data: mapping.engineParam ? [ctx.engine] : [] }],
      };
    }
    case 'absolutePair': {
      const want = ctx.value >= 0.5;
      if (typeof current === 'number' && current >= 0.5 === want) return { ok: true, commands: [], redundant: true };
      return { ok: true, redundant: false, commands: [{ kind: 'event', event: want ? mapping.onEvent : mapping.offEvent, data: [] }] };
    }
    case 'setvar':
      return { ok: true, redundant: false, commands: [{ kind: 'setvar', var: key, value: ctx.value }] };
    case 'inputEvent':
      return { ok: true, redundant: false, commands: [{ kind: 'inputEvent', name: mapping.name, value: ctx.value * (mapping.scale ?? 1) }] };
  }
}

/** Minimum change that is worth sending for continuous controls (one 16383 step or a setpoint step). */
export function significantChange(control: ControlId, prev: number | undefined, next: number): boolean {
  if (prev === undefined) return true;
  const d = CONTROLS[control];
  if (d.kind === 'axis' || d.kind === 'bipolar') return Math.abs(next - prev) >= 1 / 16383;
  return next !== prev;
}

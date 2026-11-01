import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES, CONTROL_IDS, CONTROLS, DEFAULT_MAPPINGS, aircraftKey, buildSubscriptions, computeAvailability,
  computeCaps, convertRaw, decodeBco16, defaultTabletLayout, encodeBco16, flapDetents, flapsMaxIndex, fromRaw16383,
  DeviceSettingsSchema, TABLET_LAYOUT_REV, defaultTabletPages, gearIndication, identityFromState, isTabletLayoutCurrent, parseClientMessage, planCommand,
  profileEnabledControls, sanitizeControlValue, selectProfile, significantChange, snapFrequency, stateKey,
  stepFrequency, toRaw16383, toSigned16383, wrap360,
  type StateMap,
} from './index';

const caps = (over: StateMap = {}) => computeCaps({ 'id.engineCount': 1, 'id.engineType': 0, 'cap.gearRetractable': 1, 'cap.flapsAvailable': 1, 'cap.flapsCount': 4, 'cap.spoilers': 0, 'cap.autopilot': 1, 'cap.transponder': 1, 'cap.com1': 1, 'cap.com2': 0, 'cap.nav1': 1, 'cap.nav2': 0, ...over });
const profile = (id: string) => BUILTIN_PROFILES.find((p) => p.id === id)!;

describe('value normalisation', () => {
  it('maps 0..1 to 0..16383 and back with clamping', () => {
    expect(toRaw16383(0)).toBe(0);
    expect(toRaw16383(1)).toBe(16383);
    expect(toRaw16383(0.5)).toBe(8192);
    expect(toRaw16383(-3)).toBe(0);
    expect(toRaw16383(9)).toBe(16383);
    expect(fromRaw16383(16383)).toBe(1);
  });
  it('maps trim -1..1 to signed raw', () => {
    expect(toSigned16383(-1)).toBe(-16383);
    expect(toSigned16383(0)).toBe(0);
    expect(toSigned16383(2)).toBe(16383);
  });
  it('converts percent SimVars and clamps', () => {
    expect(convertRaw('throttle', 75)).toBeCloseTo(0.75);
    expect(convertRaw('throttle2', 130)).toBe(1);
    expect(convertRaw('trim', -1.4)).toBe(-1);
    expect(convertRaw('gear', 0.99)).toBe(1);
    expect(convertRaw('id.title', 'Cessna 172')).toBe('Cessna 172');
    expect(convertRaw('unknown.key', 3)).toBeNull();
  });
  it('encodes transponder codes as BCO16', () => {
    expect(encodeBco16(1200)).toBe(0x1200);
    expect(decodeBco16(0x7700)).toBe(7700);
    expect(decodeBco16(encodeBco16(21))).toBe(21);
  });
  it('quantises setpoints and switches', () => {
    expect(sanitizeControlValue('apAltitudeSel', 4960)).toBe(5000);
    expect(sanitizeControlValue('apHeadingSel', 400)).toBe(359);
    expect(sanitizeControlValue('apVsSel', -99999)).toBe(-6000);
    expect(sanitizeControlValue('gear', 0.7)).toBe(1);
    expect(sanitizeControlValue('throttle', 1.5)).toBe(1);
    expect(wrap360(-10)).toBe(350);
  });
  it('snaps and steps frequencies inside the band', () => {
    expect(snapFrequency(121_512_000, 'com')).toBe(121_500_000);
    expect(stepFrequency(136_975_000, 'com', 1, false)).toBe(118_000_000);
    expect(stepFrequency(118_000_000, 'com', 1, true)).toBe(119_000_000);
    expect(stepFrequency(108_000_000, 'nav', -1, false)).toBe(117_950_000);
  });
});

describe('command planning', () => {
  const base = { engine: 1, flapsMax: 3 } as const;
  it('encodes lever positions as event data', () => {
    const r = planCommand({ ...base, control: 'throttle', value: 0.75, state: {} });
    expect(r).toEqual({ ok: true, redundant: false, commands: [{ kind: 'event', event: 'THROTTLE1_SET', data: [12287] }] });
    const e2 = planCommand({ ...base, engine: 2, control: 'mixture', value: 1, state: {} });
    expect(e2.ok && e2.commands[0]).toEqual({ kind: 'event', event: 'MIXTURE2_SET', data: [16383] });
  });
  it('gear uses absolute GEAR_SET (never a toggle)', () => {
    const r = planCommand({ ...base, control: 'gear', value: 0, state: { gear: 1 } });
    expect(r).toEqual({ ok: true, redundant: false, commands: [{ kind: 'event', event: 'GEAR_SET', data: [0] }] });
  });
  it('parking brake uses absolute PARKING_BRAKE_SET', () => {
    const r = planCommand({ ...base, control: 'parkingBrake', value: 1, state: { parkingBrake: 0 } });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'event', event: 'PARKING_BRAKE_SET', data: [1] });
  });
  it('toggle events become absolute by comparing with simulator state', () => {
    const on = planCommand({ ...base, control: 'lightNav', value: 1, state: { lightNav: 1 } });
    expect(on).toEqual({ ok: true, commands: [], redundant: true });
    const flip = planCommand({ ...base, control: 'lightNav', value: 0, state: { lightNav: 1 } });
    expect(flip.ok && flip.commands).toEqual([{ kind: 'event', event: 'TOGGLE_NAV_LIGHTS', data: [] }]);
  });
  it('refuses blind toggles when state is unknown', () => {
    const r = planCommand({ ...base, control: 'lightBeacon', value: 1, state: {} });
    expect(r.ok).toBe(false);
  });
  it('autopilot master uses absolute ON/OFF events', () => {
    const r = planCommand({ ...base, control: 'apMaster', value: 1, state: { apMaster: 0 } });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'event', event: 'AUTOPILOT_ON', data: [] });
  });
  it('encodes flap detents from the highest detent index', () => {
    const r = planCommand({ ...base, control: 'flaps', value: 2, state: {} });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'event', event: 'FLAPS_SET', data: [10922] });
    const none = planCommand({ ...base, flapsMax: null, control: 'flaps', value: 1, state: {} });
    expect(none.ok).toBe(false);
  });
  it('encodes setpoints with trailing index and BCO16 transponder codes', () => {
    const hdg = planCommand({ ...base, control: 'apHeadingSel', value: 270, state: {} });
    expect(hdg.ok && hdg.commands[0]).toEqual({ kind: 'event', event: 'HEADING_BUG_SET', data: [270, 1] });
    const x = planCommand({ ...base, control: 'xpndrCode', value: 7000, state: {} });
    expect(x.ok && x.commands[0]).toEqual({ kind: 'event', event: 'XPNDR_SET', data: [0x7000] });
  });
  it('transponder mode is a settable SimVar', () => {
    const r = planCommand({ ...base, control: 'xpndrMode', value: 4, state: {} });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'setvar', var: 'xpndrMode', value: 4 });
  });
  it('momentary actions ignore the release value', () => {
    expect(planCommand({ ...base, control: 'swapCom1', value: 0, state: {} })).toEqual({ ok: true, commands: [], redundant: true });
    const r = planCommand({ ...base, control: 'swapCom1', value: 1, state: {} });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'event', event: 'COM1_RADIO_SWAP', data: [] });
  });
  it('profile mapping override replaces the default', () => {
    const r = planCommand({ ...base, control: 'throttle', value: 1, state: {}, mapping: { kind: 'inputEvent', name: 'THROTTLE_LEVER' } });
    expect(r.ok && r.commands[0]).toEqual({ kind: 'inputEvent', name: 'THROTTLE_LEVER', value: 1 });
  });
  it('detects significant continuous changes only', () => {
    expect(significantChange('throttle', 0.5, 0.5)).toBe(false);
    expect(significantChange('throttle', 0.5, 0.5001)).toBe(true);
    expect(significantChange('throttle', undefined, 0.2)).toBe(true);
  });
  it('has a mapping for every control', () => {
    for (const id of CONTROL_IDS) expect(DEFAULT_MAPPINGS[id], id).toBeDefined();
  });
});

describe('gear indication', () => {
  it('distinguishes up / transit / down', () => {
    expect(gearIndication(0)).toBe('up');
    expect(gearIndication(0.5)).toBe('transit');
    expect(gearIndication(1)).toBe('down');
    expect(gearIndication(null)).toBeNull();
  });
});

describe('aircraft profile selection', () => {
  const id = (title: string, engineType: number, engineCount = 1) =>
    identityFromState({ 'id.title': title, 'id.engineType': engineType, 'id.engineCount': engineCount });
  it('picks the fixed pitch profile for a Cessna 172', () => {
    const s = selectProfile(id('Cessna 172 Skyhawk G1000', 0), BUILTIN_PROFILES, null)!;
    expect(s.profile.id).toBe('generic-ga-fixed-pitch');
    expect(s.profile.controls.prop?.enabled).toBe(false);
  });
  it('picks constant speed for a Bonanza (title match beats generic)', () => {
    const s = selectProfile(id('Beechcraft Bonanza G36', 0), BUILTIN_PROFILES, null)!;
    expect(s.profile.id).toBe('generic-ga-constant-speed');
    expect(s.reason).toBe('match');
  });
  it('picks twin / turboprop / jet by engine data', () => {
    expect(selectProfile(id('Baron', 0, 2), BUILTIN_PROFILES, null)!.profile.id).toBe('generic-twin-piston');
    expect(selectProfile(id('TBM 930', 5), BUILTIN_PROFILES, null)!.profile.id).toBe('generic-turboprop');
    expect(selectProfile(id('Citation', 1, 2), BUILTIN_PROFILES, null)!.profile.id).toBe('generic-jet');
  });
  it('honours a per-aircraft override', () => {
    const s = selectProfile(id('Cessna 172', 0), BUILTIN_PROFILES, 'generic-ga-constant-speed')!;
    expect(s.profile.id).toBe('generic-ga-constant-speed');
    expect(s.reason).toBe('override');
  });
  it('falls back for unknown engine types', () => {
    const s = selectProfile(id('Weird thing', 4), BUILTIN_PROFILES, null)!;
    expect(s.reason).toBe('fallback');
  });
  it('builds a stable aircraft key', () => {
    expect(aircraftKey(id('  Cessna 172 ', 0))).toBe('cessna 172');
  });
});

describe('capabilities & unsupported controls', () => {
  it('disables the prop lever for fixed pitch aircraft with a reason', () => {
    const av = computeAvailability(profile('generic-ga-fixed-pitch'), caps(), true);
    expect(av.prop).toEqual({ enabled: false, reason: 'Fixed-pitch propeller' });
    expect(av.throttle.enabled).toBe(true);
  });
  it('enables the prop lever for constant speed', () => {
    expect(computeAvailability(profile('generic-ga-constant-speed'), caps(), true).prop.enabled).toBe(true);
  });
  it('disables fixed-gear aircraft gear and missing equipment', () => {
    const av = computeAvailability(profile('generic-ga-fixed-pitch'), caps({ 'cap.gearRetractable': 0, 'cap.autopilot': 0 }), true);
    expect(av.gear.enabled).toBe(false);
    expect(av.apMaster.enabled).toBe(false);
    expect(av.com2Standby.enabled).toBe(false);
    expect(av.com1Standby.enabled).toBe(true);
  });
  it('disables everything while the simulator is offline', () => {
    const av = computeAvailability(profile('generic-ga-fixed-pitch'), caps(), false);
    expect(av.throttle).toEqual({ enabled: false, reason: 'Simulator not connected' });
  });
  it('keeps controls enabled while a capability is still unknown', () => {
    const av = computeAvailability(profile('generic-ga-fixed-pitch'), computeCaps({}), true);
    expect(av.gear.enabled).toBe(true);
  });
  it('never assumes flap detents', () => {
    const p = profile('generic-ga-fixed-pitch');
    expect(flapDetents(p, caps({ 'cap.flapsCount': 4 })).map((d) => d.label)).toEqual(['UP', '1', '2', 'FULL']);
    expect(flapsMaxIndex(p, caps({ 'cap.flapsCount': 7 }))).toBe(6);
    expect(flapDetents(p, caps({ 'cap.flapsCount': 0 }))).toEqual([]);
  });
});

describe('subscriptions', () => {
  it('only subscribes variables for enabled controls plus identity and capabilities', () => {
    const subs = buildSubscriptions(profileEnabledControls(profile('generic-ga-fixed-pitch')), 1);
    const ids = subs.map((s) => s.id);
    expect(ids).toContain('id.title');
    expect(ids).toContain('cap.gearRetractable');
    expect(ids).toContain('throttle');
    expect(ids).not.toContain('prop');
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('expands per-engine variables', () => {
    const subs = buildSubscriptions(['throttle'], 2);
    expect(subs.find((s) => s.id === 'throttle2')?.name).toBe('GENERAL ENG THROTTLE LEVER POSITION:2');
  });
  it('stateKey suffixes engines above one', () => {
    expect(stateKey('throttle', 1)).toBe('throttle');
    expect(stateKey('throttle', 3)).toBe('throttle3');
    expect(stateKey('gear', 2)).toBe('gear');
  });
});

describe('default layouts', () => {
  it('omits the propeller lever for fixed pitch aircraft', () => {
    const l = defaultTabletLayout(profile('generic-ga-fixed-pitch'));
    expect(l.items.some((i) => i.control === 'prop')).toBe(false);
    expect(l.items.filter((i) => i.type === 'lever')).toHaveLength(2);
    for (const i of l.items) expect(i.x + i.w).toBeLessThanOrEqual(l.grid.cols);
  });
  it('pairs the engine levers of twins (T1+T2, P1+P2, M1+M2) so a link handle fits between them', () => {
    const l = defaultTabletLayout(profile('generic-twin-piston'));
    const pairs = l.items.filter((i) => i.type === 'leverPair');
    expect(pairs.map((p) => p.control)).toEqual(['throttle', 'prop', 'mixture']);
    expect(pairs.every((p) => p.engine === 1)).toBe(true);
    expect(l.items.filter((i) => i.type === 'lever')).toHaveLength(0);
    for (const i of l.items) expect(i.x + i.w).toBeLessThanOrEqual(l.grid.cols);
    const ids = l.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(l.rev).toBe(TABLET_LAYOUT_REV);
  });
  it('keeps single engine layouts as plain levers', () => {
    const l = defaultTabletLayout(profile('generic-ga-constant-speed'));
    expect(l.items.filter((i) => i.type === 'lever').map((i) => i.control)).toEqual(['throttle', 'prop', 'mixture']);
    expect(l.items.some((i) => i.type === 'leverPair')).toBe(false);
  });
  it('drops saved multi-engine layouts that predate the lever pairs, but keeps single engine ones', () => {
    const old = { version: 1 as const, grid: { cols: 32, rows: 16 }, items: [] };
    expect(isTabletLayoutCurrent(old)).toBe(false);
    expect(isTabletLayoutCurrent({ ...old, rev: 2 })).toBe(false);
    expect(isTabletLayoutCurrent({ ...old, rev: TABLET_LAYOUT_REV })).toBe(true);
  });
  it('puts the attitude indicator above gear and parking brake, without overlaps', () => {
    for (const id of ['generic-ga-fixed-pitch', 'generic-twin-piston', 'generic-jet']) {
      const l = defaultTabletLayout(profile(id));
      const att = l.items.find((i) => i.type === 'attitude')!;
      const gear = l.items.find((i) => i.id === 'gear');
      const brake = l.items.find((i) => i.id === 'parkingBrake')!;
      expect(att.y + att.h).toBeLessThanOrEqual(brake.y);
      if (gear) expect(gear.y).toBe(brake.y);
      for (const a of l.items) {
        expect(a.y + a.h).toBeLessThanOrEqual(l.grid.rows);
        for (const b of l.items) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${id}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });
  it('generates landscape pages for the tablet (AP, radios, systems, quick) that fit the grid', () => {
    const t = defaultTabletPages();
    expect(t.pages.map((p) => p.id)).toEqual(['autopilot', 'radios', 'systems', 'quick']);
    for (const p of t.pages) {
      for (const i of p.items) {
        expect(i.x + i.w, `${p.id}/${i.id}`).toBeLessThanOrEqual(p.grid.cols);
        expect(i.y + i.h, `${p.id}/${i.id}`).toBeLessThanOrEqual(p.grid.rows);
        for (const o of p.items) {
          if (o === i) continue;
          const overlap = i.x < o.x + o.w && o.x < i.x + i.w && i.y < o.y + o.h && o.y < i.y + i.h;
          expect(overlap, `${p.id}: ${i.id} overlaps ${o.id}`).toBe(false);
        }
      }
    }
    expect(t.pages[0]!.items.some((i) => i.type === 'attitude')).toBe(true);
    expect(DeviceSettingsSchema.safeParse({ version: 1, tabletPages: { x: t } }).success).toBe(true);
    expect(DeviceSettingsSchema.parse({ version: 1 }).tabletPages).toEqual({});
  });
});

describe('telemetry state', () => {
  it('is always subscribed and rounded for display', () => {
    const ids = buildSubscriptions([], 2).map((s) => s.id);
    expect(convertRaw('tel.pitch', -3.26)).toBe(-3.5);
    expect(convertRaw('tel.bank', -0.1)).toBe(0);
    for (const k of ['tel.pitch', 'tel.bank', 'tel.ias', 'tel.gs', 'tel.alt', 'tel.vs', 'tel.hdg', 'tel.fuelGal', 'tel.fuelLb', 'tel.ff', 'tel.ff2']) expect(ids).toContain(k);
    expect(convertRaw('tel.vs', 487)).toBe(490);
    expect(convertRaw('tel.vs', -12)).toBe(-10);
    expect(convertRaw('tel.hdg', 359.7)).toBe(0);
    expect(convertRaw('tel.hdg', -10)).toBe(350);
    expect(convertRaw('tel.fuelGal', 52.349)).toBe(52.3);
    expect(convertRaw('tel.ff2', 11.04)).toBe(11);
  });
});

describe('protocol validation', () => {
  it('accepts a well formed control.set', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'control.set', control: 'throttle', value: 0.75, engine: 1, sequence: 123 }));
    expect(r.ok).toBe(true);
  });
  it('rejects unknown controls, bad types, unknown fields and NaN', () => {
    expect(parseClientMessage({ type: 'control.set', control: 'selfDestruct', value: 1, sequence: 1 }).ok).toBe(false);
    expect(parseClientMessage({ type: 'control.set', control: 'throttle', value: '1', sequence: 1 }).ok).toBe(false);
    expect(parseClientMessage({ type: 'control.set', control: 'throttle', value: 1, sequence: 1, extra: 1 }).ok).toBe(false);
    expect(parseClientMessage('{"type":"control.set","control":"throttle","value":null,"sequence":1}').ok).toBe(false);
    expect(parseClientMessage({ type: 'control.set', control: 'throttle', value: 1, sequence: -1 }).ok).toBe(false);
    expect(parseClientMessage({ type: 'control.set', control: 'throttle', value: 1, engine: 9, sequence: 1 }).ok).toBe(false);
  });
  it('rejects garbage and oversize payloads', () => {
    expect(parseClientMessage('not json').ok).toBe(false);
    expect(parseClientMessage({ type: 'exec', cmd: 'calc' }).ok).toBe(false);
    expect(parseClientMessage('x'.repeat(200_000)).ok).toBe(false);
  });
  it('validates hello', () => {
    expect(parseClientMessage({ type: 'hello', token: 't', deviceId: 'abcdefgh1234', role: 'tablet', protocol: 1 }).ok).toBe(true);
    expect(parseClientMessage({ type: 'hello', token: 't', deviceId: 'bad id!', role: 'tablet', protocol: 1 }).ok).toBe(false);
  });
});

describe('control registry', () => {
  it('has definitions for all ids with sane ranges', () => {
    for (const id of CONTROL_IDS) {
      const d = CONTROLS[id];
      expect(d.id).toBe(id);
      expect(d.max).toBeGreaterThan(d.min);
    }
  });
});

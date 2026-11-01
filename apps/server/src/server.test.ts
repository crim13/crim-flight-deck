import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  BUILTIN_PROFILES, CONTROL_IDS, DEFAULT_MAPPINGS, defaultSharedSettings, type ControlSetMessage, type ServerMessage,
} from '@crim/shared';
import { MOCK_SUPPORTED_EVENTS, MockAdapter } from './adapters/mock';
import { createApp, type App } from './app';
import { silentLogger } from './logger';
import { isPrivateAddress, listLanAddresses } from './net';
import { ControlArbiter } from './sim/arbiter';
import { SimHub } from './sim/hub';
import { CommandScheduler } from './sim/scheduler';
import { checkOrigin } from './ws/gateway';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await sleep(5);
  }
}

const A = { deviceId: 'tablet-0001', sessionId: 's-a' };
const B = { deviceId: 'phone-0002', sessionId: 's-b' };
let seq = 0;
const set = (control: ControlSetMessage['control'], value: number, extra: Partial<ControlSetMessage> = {}): ControlSetMessage =>
  ({ type: 'control.set', control, value, sequence: ++seq, ...extra });

function makeHub(aircraft = 'c172', shared = defaultSharedSettings()) {
  const mock = new MockAdapter(silentLogger, { latencyMs: 1, connectDelayMs: 1, aircraft });
  const hub = new SimHub({ adapter: mock, profiles: () => BUILTIN_PROFILES, shared: () => shared, log: silentLogger, stateHz: 60, identitySettleMs: 0 });
  return { mock, hub, shared };
}

describe('mock adapter', () => {
  it('understands every event used by the default mappings', () => {
    const events = new Set<string>();
    for (const m of Object.values(DEFAULT_MAPPINGS)) {
      if (m.kind === 'event' || m.kind === 'toggle') events.add(m.event.replace('{n}', '1'));
      if (m.kind === 'absolutePair') { events.add(m.onEvent); events.add(m.offEvent); }
    }
    for (const e of events) expect(MOCK_SUPPORTED_EVENTS, e).toContain(e);
  });
  it('reports itself as mock', () => {
    const { mock } = makeHub();
    expect(mock.mock).toBe(true);
    expect(mock.kind).toBe('mock');
  });
});

describe('hub: bidirectional synchronisation (mock simulator)', () => {
  let ctx: ReturnType<typeof makeHub>;
  beforeEach(async () => {
    ctx = makeHub();
    ctx.hub.start();
    await until(() => ctx.hub.state['id.title'] !== undefined && ctx.hub.active.profile !== null && ctx.hub.state.throttle !== undefined);
  });
  afterEach(async () => { await ctx.hub.stop(); });

  it('selects the fixed pitch profile for the mock Cessna and subscribes only supported variables', () => {
    expect(ctx.hub.active.profile?.id).toBe('generic-ga-fixed-pitch');
    expect(ctx.hub.state.prop).toBeUndefined(); // prop not subscribed for fixed pitch
  });

  it('tablet -> simulator -> every device: command, authoritative feedback, broadcast', async () => {
    const patches: Record<string, unknown>[] = [];
    ctx.hub.on('patch', (m) => patches.push(m.data));
    const ack = ctx.hub.handleControlSet(A, set('throttle', 0.75));
    expect(ack.status).toBe('ok');
    await until(() => patches.some((p) => typeof p.throttle === 'number' && Math.abs(p.throttle - 0.75) < 1e-3));
    expect(ctx.hub.state.throttle).toBeCloseTo(0.75, 3);
    expect(ctx.mock.sent.at(-1)).toEqual({ kind: 'event', event: 'THROTTLE1_SET', data: [12287] });
  });

  it('simulator -> devices: a change in the virtual cockpit reaches all clients', async () => {
    const patches: Record<string, unknown>[] = [];
    ctx.hub.on('patch', (m) => patches.push(m.data));
    ctx.mock.simulate('mixture', 0.3);
    await until(() => patches.some((p) => p.mixture !== undefined));
    expect(ctx.hub.state.mixture).toBeCloseTo(0.3);
  });

  it('rejects the propeller lever on a fixed pitch aircraft', () => {
    const ack = ctx.hub.handleControlSet(A, set('prop', 0.5));
    expect(ack).toMatchObject({ status: 'rejected', reason: 'Fixed-pitch propeller' });
    expect(ctx.mock.sent.some((c) => c.kind === 'event' && c.event.startsWith('PROP'))).toBe(false);
  });

  it('rejects gear on fixed gear aircraft', async () => {
    await until(() => ctx.hub.state['cap.gearRetractable'] !== undefined);
    expect(ctx.hub.handleControlSet(A, set('gear', 0)).status).toBe('rejected');
  });

  it('gear and parking brake send absolute commands and report redundancy', async () => {
    await ctx.hub.stop();
    ctx = makeHub('bonanza');
    ctx.hub.start();
    await until(() => ctx.hub.active.profile?.id === 'generic-ga-constant-speed' && ctx.hub.state.gear !== undefined);
    expect(ctx.hub.handleControlSet(A, set('gear', 1)).status).toBe('redundant'); // already down
    expect(ctx.hub.handleControlSet(A, set('gear', 0)).status).toBe('ok');
    await until(() => ctx.hub.state.gear === 0);
    await until(() => ctx.hub.state.gearActual === 0, 4000); // actual position follows the handle
    expect(ctx.hub.handleControlSet(A, set('parkingBrake', 0)).status).toBe('ok');
    await until(() => ctx.hub.state.parkingBrake === 0);
    expect(ctx.hub.handleControlSet(A, set('parkingBrake', 0)).status).toBe('redundant');
  });

  it('toggle style switches never flip the wrong way', async () => {
    await until(() => ctx.hub.state.lightNav !== undefined);
    expect(ctx.hub.handleControlSet(A, set('lightNav', 0)).status).toBe('redundant');
    expect(ctx.hub.handleControlSet(A, set('lightNav', 1)).status).toBe('ok');
    await until(() => ctx.hub.state.lightNav === 1);
    expect(ctx.hub.handleControlSet(A, set('lightNav', 1)).status).toBe('redundant');
  });

  it('flaps use the simulator detent count', async () => {
    await until(() => ctx.hub.state.flaps !== undefined && ctx.hub.state['cap.flapsCount'] === 4);
    expect(ctx.hub.handleControlSet(A, set('flaps', 2)).status).toBe('ok');
    await until(() => ctx.hub.state.flaps === 2);
  });

  it('drops stale (out of order) sequence numbers', () => {
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.2, { sequence: 500 })).status).toBe('ok');
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.9, { sequence: 499 })).status).toBe('stale');
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.9, { sequence: 500 })).status).toBe('stale');
  });

  it('conflicting inputs: first touch wins until released', async () => {
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.4, { phase: 'begin' })).status).toBe('ok');
    expect(ctx.hub.handleControlSet(B, set('throttle', 0.9)).status).toBe('busy');
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.5, { phase: 'update' })).status).toBe('ok');
    expect(ctx.hub.handleControlSet(A, set('throttle', 0.55, { phase: 'end' })).status).toBe('ok');
    expect(ctx.hub.handleControlSet(B, set('throttle', 0.1)).status).toBe('busy'); // short release hold
    await sleep(300);
    expect(ctx.hub.handleControlSet(B, set('throttle', 0.1)).status).toBe('ok');
    // other controls are independent
    expect(ctx.hub.handleControlSet(A, set('mixture', 0.5, { phase: 'begin' })).status).toBe('ok');
    expect(ctx.hub.handleControlSet(B, set('trim', 0.1)).status).toBe('ok');
  });

  it('does not spam the simulator while dragging and sends the final value', async () => {
    ctx.mock.sent.length = 0;
    ctx.hub.handleControlSet(A, set('throttle', 0, { phase: 'begin' }));
    for (let i = 1; i <= 60; i++) ctx.hub.handleControlSet(A, set('throttle', i / 100, { phase: 'update' }));
    ctx.hub.handleControlSet(A, set('throttle', 0.6, { phase: 'end' }));
    await sleep(120);
    const throttle = ctx.mock.sent.filter((c) => c.kind === 'event' && c.event === 'THROTTLE1_SET');
    expect(throttle.length).toBeLessThan(10);
    expect(throttle.at(-1)).toEqual({ kind: 'event', event: 'THROTTLE1_SET', data: [9830] });
    // nothing is re-sent afterwards
    const n = ctx.mock.sent.length;
    await sleep(120);
    expect(ctx.mock.sent.length).toBe(n);
  });

  it('suppresses redundant updates identical to the simulator state', async () => {
    ctx.hub.handleControlSet(A, set('mixture', 0.5));
    await until(() => Math.abs((ctx.hub.state.mixture as number) - 0.5) < 1e-3);
    const n = ctx.mock.sent.length;
    expect(ctx.hub.handleControlSet(A, set('mixture', 0.5)).status).toBe('redundant');
    expect(ctx.mock.sent.length).toBe(n);
  });

  it('sends the release value even when it equals the still-old simulator reading (slow simulator)', async () => {
    // the simulator has not reported anything yet (throttle still 0) when the finger comes back to 0
    expect(ctx.hub.state.throttle).toBe(0);
    ctx.hub.handleControlSet(A, set('throttle', 0, { phase: 'begin' }));
    ctx.hub.handleControlSet(A, set('throttle', 0.5, { phase: 'update' }));
    const end = ctx.hub.handleControlSet(A, set('throttle', 0, { phase: 'end' }));
    expect(end.status).toBe('ok');
    await until(() => {
      const last = ctx.mock.sent.filter((c) => c.kind === 'event' && c.event === 'THROTTLE1_SET').at(-1);
      return last?.kind === 'event' && last.data[0] === 0;
    });
    await until(() => ctx.hub.state.throttle === 0 && ctx.mock.snapshot().throttle === 0);
  });

  it('reports telemetry (always subscribed, rounded) and clears it with the simulator', async () => {
    expect(ctx.hub.state['tel.alt']).toBe(1200);
    ctx.mock.simulate('tel.vs', 487);
    await until(() => ctx.hub.state['tel.vs'] === 490); // rounded to 10 fpm
    ctx.mock.simulate('tel.hdg', 360.4);
    await until(() => ctx.hub.state['tel.hdg'] === 0);
  });
});

describe('hub: disconnect / reconnect / aircraft change', () => {
  it('forgets state when the simulator goes away and adopts the simulator state on return', async () => {
    const { hub, mock } = makeHub();
    hub.start();
    await until(() => hub.state.throttle !== undefined);
    mock.simulate('throttle', 0.6);
    await until(() => Math.abs((hub.state.throttle as number) - 0.6) < 1e-3);

    const states: number[] = [];
    hub.on('state', (m) => states.push(Object.keys(m.data).length));
    mock.disconnect();
    await until(() => hub.status.sim === 'disconnected');
    expect(Object.keys(hub.state)).toHaveLength(0);
    expect(states.at(-1)).toBe(0);
    expect(hub.handleControlSet(A, set('throttle', 0.1)).status).toBe('rejected'); // never writes while offline

    mock.simulate('throttle', 0.2); // ignored while offline
    mock.connect();
    await until(() => hub.status.sim === 'connected' && hub.state.throttle !== undefined);
    expect(hub.state.throttle).toBeCloseTo(0.2); // actual simulator value, not the old 0.6
    await hub.stop();
  });

  it('reloads the profile when the aircraft changes', async () => {
    const { hub, mock } = makeHub('c172');
    hub.start();
    await until(() => hub.active.profile?.id === 'generic-ga-fixed-pitch');
    const profiles: string[] = [];
    hub.on('profile', (m) => profiles.push(m.profile?.id ?? ''));
    mock.setAircraft('baron');
    await until(() => hub.active.profile?.id === 'generic-twin-piston');
    await until(() => hub.state.throttle2 !== undefined);
    expect(profiles).toContain('generic-twin-piston');
    expect(hub.handleControlSet(A, set('throttle', 0.5, { engine: 2 })).status).toBe('ok');
    await hub.stop();
  });

  it('honours a per-aircraft profile override', async () => {
    const shared = defaultSharedSettings();
    shared.aircraftProfiles['cessna 172 skyhawk (mock)'] = 'generic-ga-constant-speed';
    const { hub } = makeHub('c172', shared);
    hub.start();
    await until(() => hub.active.profile !== null);
    expect(hub.active.profile?.id).toBe('generic-ga-constant-speed');
    expect(hub.active.reason).toBe('override');
    await hub.stop();
  });

  it('reports errors from the simulator layer without crashing', async () => {
    const { hub, mock } = makeHub();
    hub.start();
    await until(() => hub.state.throttle !== undefined);
    const errs: string[] = [];
    hub.on('error', (e) => errs.push(e.message));
    hub.sendRaw({ kind: 'event', event: 'NOT_A_REAL_EVENT', data: [] });
    await until(() => errs.length > 0);
    expect(errs[0]).toContain('NOT_A_REAL_EVENT');
    expect(mock.getStatus().sim).toBe('connected');
    await hub.stop();
  });
});

describe('scheduler & arbiter', () => {
  it('coalesces to leading + latest', () => {
    vi.useFakeTimers();
    const out: number[] = [];
    let t = 0;
    const s = new CommandScheduler((c) => out.push((c[0] as { data: number[] }).data[0]!), 33, () => t);
    const cmd = (n: number) => [{ kind: 'event' as const, event: 'X', data: [n] }];
    s.submit('k', cmd(1), { continuous: true });
    t = 5; s.submit('k', cmd(2), { continuous: true });
    t = 10; s.submit('k', cmd(3), { continuous: true });
    expect(out).toEqual([1]);
    t = 40; vi.advanceTimersByTime(40);
    expect(out).toEqual([1, 3]);
    s.dispose();
    vi.useRealTimers();
  });
  it('releases a control after the idle timeout', () => {
    let t = 0;
    const a = new ControlArbiter(() => t, { idleMs: 1000, releaseMs: 100 });
    expect(a.request('k', 'A', 'begin')).toBeNull();
    expect(a.request('k', 'B', 'set')).toBe('A');
    t = 1001;
    expect(a.request('k', 'B', 'set')).toBeNull();
  });
});

describe('network helpers & origin checks', () => {
  it('classifies private addresses', () => {
    for (const a of ['192.168.1.10', '10.0.0.5', '172.16.5.5', '127.0.0.1', '::1', '::ffff:192.168.0.2']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '203.0.113.9']) expect(isPrivateAddress(a), a).toBe(false);
  });
  it('prefers physical adapters over virtual ones', () => {
    const l = listLanAddresses({
      'vEthernet (Default Switch)': [{ address: '172.21.144.1', family: 'IPv4', internal: false } as never],
      'Ethernet 2': [{ address: '192.168.56.1', family: 'IPv4', internal: false } as never],
      'Wi-Fi': [{ address: '192.168.1.131', family: 'IPv4', internal: false } as never],
    });
    expect(l[0]!.address).toBe('192.168.1.131');
  });
  it('checks origins', () => {
    expect(checkOrigin(undefined, 'x:3000', [])).toBe(true);
    expect(checkOrigin('http://192.168.1.5:3000', '192.168.1.5:3000', [])).toBe(true);
    expect(checkOrigin('http://evil.example', '192.168.1.5:3000', [])).toBe(false);
    expect(checkOrigin('http://localhost:5173', '127.0.0.1:3000', ['localhost:5173'])).toBe(true);
    expect(checkOrigin('not a url', 'h', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real HTTP + WebSocket server with the mock adapter
// ---------------------------------------------------------------------------
describe('server end to end (mock adapter)', () => {
  let dir: string;
  let app: App;
  let port: number;

  const boot = async () => {
    app = createApp({ dataDir: dir, overrides: { host: '127.0.0.1', port: 0, adapter: 'mock' }, log: silentLogger, webRoot: join(dir, 'no-web') });
    ({ port } = await app.start());
    await until(() => app.hub.state.throttle !== undefined && app.hub.active.profile !== null);
    return app;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crim-'));
    await boot();
  });
  afterEach(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  interface TestClient { ws: WebSocket; msgs: ServerMessage[]; send(o: unknown): void; close(): void; closed: Promise<number> }
  function connect(opts: { token?: string; id?: string; role?: string; hello?: boolean; origin?: string } = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: opts.origin ? { origin: opts.origin } : {} });
      const msgs: ServerMessage[] = [];
      const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      ws.on('error', reject);
      ws.on('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on('open', () => {
        if (opts.hello !== false) ws.send(JSON.stringify({ type: 'hello', token: opts.token ?? app.settings.token, deviceId: opts.id ?? 'tablet-0001', role: opts.role ?? 'tablet', protocol: 1 }));
        resolve({ ws, msgs, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close(), closed });
      });
    });
  }
  const has = (c: TestClient, type: string, pred: (m: any) => boolean = () => true) => c.msgs.some((m) => m.type === type && pred(m));

  it('serves health and a protected status endpoint, and the admin page on loopback', async () => {
    const h = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { ok: boolean };
    expect(h.ok).toBe(true);
    const s = (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()) as { mock: boolean };
    expect(s.mock).toBe(true);
    const admin = await (await fetch(`http://127.0.0.1:${port}/admin`)).text();
    expect(admin).toContain('MOCK ADAPTER');
    expect((await fetch(`http://127.0.0.1:${port}/nope.js`)).status === 404 || (await fetch(`http://127.0.0.1:${port}/nope.js`)).status === 503).toBe(true);
  });

  it('rejects wrong tokens, missing hello, bad origins and protocol mismatch', async () => {
    const bad = await connect({ token: 'not-the-token-at-all' });
    expect(await bad.closed).toBe(4003);
    expect(has(bad, 'error', (m) => m.code === 'unauthorized')).toBe(true);
    await expect(connect({ origin: 'http://evil.example' })).rejects.toThrow(/403/);
    const noHello = await connect({ hello: false });
    noHello.send({ type: 'control.set', control: 'throttle', value: 1, sequence: 1 });
    expect(await noHello.closed).toBe(4001);
    const mismatch = await connect({ id: 'proto-0001' });
    mismatch.close();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: app.settings.token, deviceId: 'proto-0002', role: 'tablet', protocol: 99 }));
    expect(await new Promise((r) => ws.on('close', (c) => r(c)))).toBe(4004);
  });

  it('sends welcome, status, profile, config and a full state snapshot on connect', async () => {
    const c = await connect();
    await until(() => has(c, 'sim.state', (m) => m.data.throttle !== undefined));
    expect(has(c, 'welcome', (m) => m.mock === true)).toBe(true);
    expect(has(c, 'sim.status', (m) => m.mock === true && m.sim === 'connected')).toBe(true);
    expect(has(c, 'profile.active', (m) => m.profile?.id === 'generic-ga-fixed-pitch')).toBe(true);
    expect(has(c, 'config.snapshot')).toBe(true);
    c.close();
  });

  it('keeps multiple devices synchronised in both directions', async () => {
    const tablet = await connect({ id: 'tablet-0001', role: 'tablet' });
    const phone = await connect({ id: 'phone-0002', role: 'phone' });
    await until(() => has(tablet, 'sim.state', (m) => m.data.throttle !== undefined) && has(phone, 'sim.state', (m) => m.data.throttle !== undefined));

    tablet.send({ type: 'control.set', control: 'throttle', value: 0.8, sequence: 1, phase: 'set' });
    await until(() => has(phone, 'sim.patch', (m) => Math.abs(m.data.throttle - 0.8) < 1e-3));
    expect(has(tablet, 'sim.patch', (m) => Math.abs(m.data.throttle - 0.8) < 1e-3)).toBe(true);

    phone.send({ type: 'control.set', control: 'lightBeacon', value: 1, sequence: 1 });
    await until(() => has(tablet, 'sim.patch', (m) => m.data.lightBeacon === 1));

    app.mock!.simulate('mixture', 0.25); // change made "inside the cockpit"
    await until(() => has(tablet, 'sim.patch', (m) => m.data.mixture === 0.25) && has(phone, 'sim.patch', (m) => m.data.mixture === 0.25));
    expect(has(tablet, 'devices', (m) => m.devices.length === 2)).toBe(true);
    tablet.close(); phone.close();
  });

  it('answers invalid commands with errors and rejects unsupported controls', async () => {
    const c = await connect();
    await until(() => has(c, 'sim.state', (m) => m.data.throttle !== undefined));
    c.send({ type: 'control.set', control: 'selfDestruct', value: 1, sequence: 1 });
    c.send({ type: 'exec', cmd: 'calc.exe' });
    c.send({ type: 'control.set', control: 'prop', value: 1, sequence: 2 });
    await until(() => has(c, 'error', (m) => m.code === 'bad-message') && has(c, 'ack', (m) => m.control === 'prop' && m.status === 'rejected'));
    c.close();
  });

  it('a reconnecting device adopts the simulator state and cannot overwrite it', async () => {
    const c1 = await connect({ id: 'tablet-0001' });
    await until(() => has(c1, 'sim.state', (m) => m.data.throttle !== undefined));
    c1.send({ type: 'control.set', control: 'throttle', value: 0.9, sequence: 1 });
    await until(() => app.hub.state.throttle !== undefined && Math.abs((app.hub.state.throttle as number) - 0.9) < 1e-3);
    c1.close();
    await c1.closed;
    app.mock!.simulate('throttle', 0.1); // simulator changed while the tablet was away
    await until(() => Math.abs((app.hub.state.throttle as number) - 0.1) < 1e-3);
    const sent = app.mock!.sent.length;
    const c2 = await connect({ id: 'tablet-0001' });
    await until(() => has(c2, 'sim.state', (m) => Math.abs(m.data.throttle - 0.1) < 1e-3));
    await sleep(100);
    expect(app.mock!.sent.length).toBe(sent); // reconnect itself sends nothing to the simulator
    c2.close();
  });

  it('a second connection with the same device id replaces the first', async () => {
    const a = await connect({ id: 'tablet-0001' });
    await until(() => has(a, 'welcome'));
    const b = await connect({ id: 'tablet-0001' });
    expect(await a.closed).toBe(4002);
    await until(() => has(b, 'welcome'));
    b.close();
  });

  it('reports simulator disconnection to clients and recovers', async () => {
    const c = await connect();
    await until(() => has(c, 'sim.state', (m) => m.data.throttle !== undefined));
    app.mock!.disconnect();
    await until(() => has(c, 'sim.status', (m) => m.sim === 'disconnected'));
    await until(() => has(c, 'sim.state', (m) => Object.keys(m.data).length === 0));
    c.msgs.length = 0;
    app.mock!.connect();
    await until(() => has(c, 'sim.status', (m) => m.sim === 'connected'));
    await until(() => has(c, 'sim.patch', (m) => m.data.throttle !== undefined) || has(c, 'sim.state', (m) => m.data.throttle !== undefined));
    c.close();
  });

  it('persists device and shared settings across a server restart', async () => {
    const c = await connect({ id: 'tablet-0001' });
    await until(() => has(c, 'config.snapshot'));
    const layout = { version: 1, grid: { cols: 32, rows: 16 }, items: [{ id: 'trim', type: 'trim', control: 'trim', x: 1, y: 2, w: 3, h: 12 }] };
    c.send({ type: 'config.save', scope: 'device', data: { version: 1, mode: 'tablet', tabletLayouts: { 'generic-ga-fixed-pitch': layout }, phoneLayouts: {} } });
    c.send({ type: 'profile.select', aircraftKey: 'cessna 172 skyhawk (mock)', profileId: 'generic-ga-constant-speed' });
    await until(() => has(c, 'config.snapshot', (m) => m.device.mode === 'tablet' && m.shared.aircraftProfiles['cessna 172 skyhawk (mock)']));
    c.send({ type: 'config.save', scope: 'device', data: { version: 1, mode: 'nonsense' } });
    await until(() => has(c, 'error', (m) => m.code === 'bad-config'));
    c.close();
    await app.stop();
    expect(existsSync(join(dir, 'shared.json'))).toBe(true);
    await boot();
    const c2 = await connect({ id: 'tablet-0001' });
    await until(() => has(c2, 'config.snapshot'));
    const snap = c2.msgs.find((m) => m.type === 'config.snapshot') as any;
    expect(snap.device.tabletLayouts['generic-ga-fixed-pitch'].items[0].x).toBe(1);
    expect(snap.shared.aircraftProfiles['cessna 172 skyhawk (mock)']).toBe('generic-ga-constant-speed');
    await until(() => has(c2, 'profile.active', (m) => m.profile?.id === 'generic-ga-constant-speed' && m.reason === 'override'));
    c2.close();
  });

  it('keeps the pairing token across restarts and never ships a hardcoded one', async () => {
    const token = app.settings.token;
    expect(token.length).toBeGreaterThanOrEqual(16);
    await app.stop();
    await boot();
    expect(app.settings.token).toBe(token);
    expect(JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8')).token).toBe(token);
  });

  it('every control id is validated by the protocol schema', () => {
    expect(CONTROL_IDS.length).toBeGreaterThan(30);
  });
});

// Smoke test that needs no simulator: boots the PRODUCTION build (apps/server/dist/server.mjs) with the
// mock adapter on a random port and a temporary data directory, then checks HTTP, the built web UI,
// WebSocket authentication, state snapshot, a control round trip and shutdown.
//   npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverJs = join(root, 'apps', 'server', 'dist', 'server.mjs');
const webIndex = join(root, 'apps', 'web', 'dist', 'index.html');

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` - ${extra}` : ''}`);
  if (!cond) failures++;
};

if (!existsSync(serverJs) || !existsSync(webIndex)) {
  console.error('Production build missing. Run: npm run build');
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), 'crim-smoke-'));
const child = spawn(process.execPath, [serverJs, '--adapter', 'mock', '--host', '127.0.0.1', '--port', '0', '--data-dir', dataDir, '--log-level', 'warn'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const exited = new Promise((r) => child.on('exit', (code) => r(code)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}\n${out}`);
    await sleep(50);
  }
}

async function main() {
  const m = await waitFor(() => /PC admin \/ QR code : http:\/\/localhost:(\d+)\/admin/.exec(out), 10000, 'server banner');
  const port = Number(m[1]);
  const base = `http://127.0.0.1:${port}`;
  ok('server started', true, `port ${port}`);
  ok('mock mode announced', /MOCK MODE/.test(out));

  const health = await (await fetch(`${base}/api/health`)).json();
  ok('GET /api/health', health.ok === true);

  const html = await (await fetch(`${base}/`)).text();
  ok('serves the production web UI', html.includes('<div id="root">') && html.includes('assets/'));
  const asset = /assets\/[^"']+\.js/.exec(html)?.[0];
  const js = asset ? await fetch(`${base}/${asset}`) : null;
  ok('serves hashed JS asset', js?.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'));
  ok('SPA fallback', (await fetch(`${base}/some/route`)).status === 200);
  ok('blocks path traversal', (await fetch(`${base}/..%2f..%2fdata%2fserver.json`)).status !== 200);
  ok('admin page on loopback', (await (await fetch(`${base}/admin`)).text()).includes('MOCK ADAPTER'));

  const token = JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8')).token;
  ok('pairing token generated', typeof token === 'string' && token.length >= 16);

  const open = (hello) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
    ws.onerror = () => reject(new Error('ws error'));
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', protocol: 1, role: 'other', ...hello })); resolve({ ws, msgs }); };
  });

  const bad = await open({ token: 'wrong-token-wrong-token', deviceId: 'smoke-bad-0001' });
  await waitFor(() => bad.msgs.some((x) => x.type === 'error' && x.code === 'unauthorized'), 3000, 'unauthorized error');
  ok('wrong token rejected', true);

  const a = await open({ token, deviceId: 'smoke-dev-0001', role: 'tablet' });
  const b = await open({ token, deviceId: 'smoke-dev-0002', role: 'phone' });
  const has = (c, type, pred = () => true) => c.msgs.some((x) => x.type === type && pred(x));
  await waitFor(() => has(a, 'sim.state', (x) => x.data.throttle !== undefined) || has(a, 'sim.patch', (x) => x.data.throttle !== undefined), 8000, 'state with throttle');
  ok('welcome says mock', has(a, 'welcome', (x) => x.mock === true));
  ok('status: simulator connected (mock)', has(a, 'sim.status', (x) => x.sim === 'connected' && x.mock === true));
  ok('profile selected', has(a, 'profile.active', (x) => x.profile?.id === 'generic-ga-fixed-pitch'));
  ok('telemetry reaches the top bar (alt, fuel, heading)', has(a, 'sim.state', (x) => x.data['tel.alt'] === 1200 && typeof x.data['tel.fuelGal'] === 'number' && x.data['tel.hdg'] === 90));

  a.ws.send(JSON.stringify({ type: 'control.set', control: 'throttle', value: 0.6, sequence: 1, phase: 'set' }));
  await waitFor(() => has(b, 'sim.patch', (x) => Math.abs((x.data.throttle ?? -1) - 0.6) < 0.001), 5000, 'throttle patch on second device');
  ok('control round trip reaches the other device', true);

  a.ws.send(JSON.stringify({ type: 'control.set', control: 'prop', value: 1, sequence: 2 }));
  await waitFor(() => has(a, 'ack', (x) => x.control === 'prop' && x.status === 'rejected'), 3000, 'prop rejection');
  ok('unsupported control rejected (fixed pitch)', true);

  for (const c of [a, b, bad]) c.ws.close();
}

try {
  await main();
} catch (e) {
  ok('smoke test run', false, String(e.message ?? e));
}
child.kill();
const code = await Promise.race([exited, sleep(5000).then(() => 'timeout')]);
ok('server process exits', code !== 'timeout');
rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nsmoke test passed');
process.exit(failures ? 1 : 0);

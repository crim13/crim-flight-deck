import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import QRCode from 'qrcode';
import { ROOT_DIR } from './paths';
import type { UpdateChecker } from './update';
import { aircraftKey, identityFromState } from '@crim/shared';
import type { MockAdapter } from './adapters/mock';
import type { SettingsService } from './config/settings';
import { isLoopback } from './net';
import type { Logger } from './logger';
import type { SimHub } from './sim/hub';
import { tokensEqual, type Gateway } from './ws/gateway';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** Starts scripts\update.ps1, which stops this server, installs the latest release and starts it again. */
function defaultApplyUpdate(): void {
  const script = join(ROOT_DIR, 'scripts', 'update.ps1');
  // not `detached`: a detached (console-less) powershell.exe exits silently without running the script. The child
  // outlives this server anyway, because the updater stops the server by pid and not as a process tree.
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Apply', '-Restart'], {
    cwd: ROOT_DIR, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
}

/**
 * "Update now" is only accepted from this PC (loopback), from a page of this server (no foreign Origin) and with a
 * custom header, which a web page of another site cannot add without a CORS preflight that this server never answers.
 */
export function updateRequestAllowed(req: IncomingMessage): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false;
  if (req.headers['x-crim-action'] !== 'update') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export interface HttpDeps {
  updates: UpdateChecker;
  installMode: 'release' | 'dev';
  /** what "Update now" does (tests inject a stub) */
  applyUpdate?: () => void;
  hub: SimHub;
  gateway: Gateway;
  settings: SettingsService;
  log: Logger;
  version: string;
  webRoot: string;
  lanUrls: () => string[];
  mock?: MockAdapter;
  startedAt: number;
}

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'",
};

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, code: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(body);
}

function authorised(req: IncomingMessage, deps: HttpDeps): boolean {
  if (isLoopback(req.socket.remoteAddress)) return true;
  const h = req.headers.authorization;
  return !!h && h.startsWith('Bearer ') && tokensEqual(h.slice(7), deps.settings.token);
}

export function statusPayload(deps: HttpDeps) {
  const id = identityFromState(deps.hub.state);
  return {
    name: 'CRIM Flight Deck',
    version: deps.version,
    adapter: deps.hub.status.adapter,
    mock: deps.hub.status.mock,
    sim: deps.hub.status,
    aircraft: { title: id.title, key: aircraftKey(id), profile: deps.hub.active.profile?.id ?? null, profileReason: deps.hub.active.reason },
    devices: deps.gateway.devices,
    uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000),
  };
}

async function adminPage(deps: HttpDeps): Promise<string> {
  const urls = deps.lanUrls();
  const token = deps.settings.token;
  const items = await Promise.all(
    urls.map(async (u) => {
      const pair = `${u}/?t=${encodeURIComponent(token)}`;
      const qr = await QRCode.toString(pair, { type: 'svg', margin: 1, width: 200, color: { dark: '#111111', light: '#ffffff' } });
      return `<div class="u"><div class="qr">${qr}</div><div><div class="k">LAN address</div><a href="${pair}">${u}</a><div class="k">Pairing link (scan or type on tablet / phone)</div><code>${pair}</code></div></div>`;
    }),
  );
  const mock = deps.hub.status.mock ? '<div class="mock">MOCK ADAPTER - simulated data, not connected to MSFS</div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRIM Flight Deck</title>
<style>body{margin:0;background:#17191c;color:#d8dade;font:15px/1.5 Segoe UI,system-ui,sans-serif;padding:24px}h1{font-size:18px;letter-spacing:.14em;margin:0 0 4px}
.k{color:#8a8f98;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-top:8px}a{color:#ff9d3d}code{font-size:12px;word-break:break-all;color:#aab}
.card{border:1px solid #2c3036;background:#1e2125;border-radius:6px;padding:14px 16px;margin:14px 0;max-width:760px}.u{display:flex;gap:16px;align-items:center;margin:10px 0}.qr svg{width:150px;height:150px;border-radius:4px}
.mock{background:#7a4a00;color:#fff;padding:8px 12px;border-radius:4px;font-weight:700;max-width:760px}.st{font-weight:600}.ok{color:#6fd36f}.warn{color:#ffb347}.bad{color:#ff6b6b}</style></head><body>
<h1>CRIM FLIGHT DECK</h1><div class="k">server v${deps.version}</div>${mock}
<div class="card"><div class="k">Simulator</div><div id="sim" class="st">...</div><div id="detail" class="k"></div><div class="k">Aircraft / profile</div><div id="ac">-</div></div>
<div class="card"><div class="k">Connected devices</div><div id="dev">none</div></div>
<div class="card" id="upd"><div class="k">Updates</div><div class="k">checking...</div></div>
<div class="card"><div class="k">Open on tablet or phone (same Wi-Fi)</div>${items.join('') || '<div class="bad">No private LAN address detected - check your network connection.</div>'}
<div class="k">After the first visit the token is remembered by the browser; revoke it by deleting "token" in data\\server.json.</div></div>
<script>
async function tick(){try{const s=await (await fetch('/api/status',{cache:'no-store'})).json();
const el=document.getElementById('sim');const c=s.sim.sim;el.textContent=(s.mock?'MOCK - ':'')+(c==='connected'?'CONNECTED to MSFS':c==='connecting'?'CONNECTING...':'NOT CONNECTED (waiting for MSFS)');
el.className='st '+(c==='connected'?(s.mock?'warn':'ok'):'bad');document.getElementById('detail').textContent='bridge: '+s.sim.bridge+(s.sim.detail?' - '+s.sim.detail:'');
document.getElementById('ac').textContent=(s.aircraft.title||'unknown')+' -> '+(s.aircraft.profile||'no profile');
document.getElementById('dev').textContent=s.devices.length?s.devices.map(d=>d.name+' ('+d.role+', '+d.remote+')').join(' | '):'none';}catch(e){document.getElementById('sim').textContent='server unreachable'}}
tick();setInterval(tick,2000);
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
let cur='${deps.version}';
function checkBtn(box){const b=el('button',null,'Check now');b.onclick=async()=>{b.disabled=true;try{await fetch('/api/update/check',{method:'POST',headers:{'X-CRIM-Action':'update'}})}catch(e){}upd()};box.append(b)}
async function upd(){try{const u=await (await fetch('/api/update',{cache:'no-store'})).json();const box=document.getElementById('upd');box.replaceChildren(el('div','k','Updates'));
if(u.available){box.append(el('div','st ok','v'+u.latest+' available (installed v'+u.current+')'));
if(u.releaseUrl){const a=el('a',null,'Release notes');a.href=u.releaseUrl;a.target='_blank';a.rel='noopener';box.append(a,document.createTextNode(' '))}
if(u.installMode==='release'){const b=el('button',null,'Update now');b.onclick=apply;box.append(b)}else box.append(el('div','k','Development checkout: update with git pull'))}
else if(!u.enabled)box.append(el('div','k','Update check is off (checkForUpdates in data\\\\server.json)'));
else{box.append(el('div',null,u.latest?'Up to date: v'+u.current:(u.error||'waiting for the first check...')));checkBtn(box)}}catch(e){}}
async function apply(){if(!confirm('Install the update now? The server restarts (about 20 seconds); tablet and phone reconnect by themselves.'))return;
const box=document.getElementById('upd');const b=box.querySelector('button');if(b)b.disabled=true;
const r=await fetch('/api/update/apply',{method:'POST',headers:{'X-CRIM-Action':'update'}});
if(!r.ok){box.append(el('div','bad',(await r.json()).error||'update failed'));return}
box.replaceChildren(el('div','st warn','Updating... this page reloads when the new version is running.'));
const t0=Date.now();const t=setInterval(async()=>{try{const h=await (await fetch('/api/health',{cache:'no-store'})).json();if(h.version&&h.version!==cur){clearInterval(t);location.reload();return}}catch(e){}
if(Date.now()-t0>120000){clearInterval(t);box.replaceChildren(el('div','bad','The update did not finish. The old version keeps running; see data\\\\logs\\\\update.log.'))}},2000)}
upd();setInterval(upd,60000);
</script></body></html>`;
}

function serveFile(res: ServerResponse, file: string, immutable: boolean): void {
  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SEC_HEADERS,
  });
  createReadStream(file).pipe(res);
}

export function createRequestHandler(deps: HttpDeps) {
  const root = resolve(deps.webRoot);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (path === '/api/health') return json(res, 200, { ok: true, name: 'crim-flight-deck', version: deps.version });
      if (path === '/api/status') {
        if (!authorised(req, deps)) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, statusPayload(deps));
      }
      if (path === '/api/update' && req.method === 'GET') {
        if (!authorised(req, deps)) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, { enabled: deps.updates.enabled, installMode: deps.installMode, ...deps.updates.info });
      }
      if (path === '/api/update/check' && req.method === 'POST') {
        if (!updateRequestAllowed(req)) return json(res, 403, { error: 'only from this PC' });
        const info = await deps.updates.check();
        return json(res, 200, { enabled: deps.updates.enabled, installMode: deps.installMode, ...info });
      }
      if (path === '/api/update/apply' && req.method === 'POST') {
        if (!updateRequestAllowed(req)) return json(res, 403, { error: 'only from this PC' });
        if (deps.installMode !== 'release') return json(res, 409, { error: 'this is a development checkout - update it with git' });
        if (!deps.updates.info.available) return json(res, 409, { error: 'no update available (check first)' });
        deps.log.info(`update to v${deps.updates.info.latest} requested from the admin page`);
        (deps.applyUpdate ?? defaultApplyUpdate)();
        return json(res, 202, { ok: true, restarting: true });
      }
      if (path === '/admin') {
        if (!isLoopback(req.socket.remoteAddress)) return text(res, 403, 'The admin page is only available on the PC running the server (http://localhost).');
        return text(res, 200, await adminPage(deps), 'text/html; charset=utf-8');
      }
      if (path === '/api/dev/mock' && req.method === 'POST') {
        if (!deps.mock) return json(res, 404, { error: 'mock adapter not active' });
        if (!authorised(req, deps)) return json(res, 401, { error: 'unauthorized' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return json(res, 413, { error: 'too large' });
        }
        const b = JSON.parse(body || '{}') as { op?: string; key?: string; id?: string; value?: number | string };
        switch (b.op) {
          case 'connect': deps.mock.connect(); break;
          case 'disconnect': deps.mock.disconnect(); break;
          case 'aircraft': deps.mock.setAircraft(String(b.key)); break;
          case 'simulate': deps.mock.simulate(String(b.id), b.value as number | string); break;
          default: return json(res, 400, { error: 'unknown op' });
        }
        return json(res, 200, { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method Not Allowed');
      if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' });

      // static files with SPA fallback
      if (!existsSync(join(root, 'index.html'))) {
        return text(res, 503, 'The web UI has not been built yet. Run "npm run build" (or use scripts\\start.cmd).');
      }
      const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
      const file = resolve(root, rel);
      if (file !== root && !file.startsWith(root + sep)) return text(res, 403, 'Forbidden');
      if (rel && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, rel.startsWith('assets' + sep) || rel.startsWith('assets/'));
      if (extname(path)) return text(res, 404, 'Not found');
      return serveFile(res, join(root, 'index.html'), false);
    } catch (e) {
      deps.log.error(`http error: ${(e as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    }
  };
}

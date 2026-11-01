import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  DeviceSettingsSchema, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, SharedSettingsSchema, parseClientMessage,
  type ClientMessage, type DeviceRole, type ErrorCode, type ServerMessage,
} from '@crim/shared';
import type { SettingsService } from '../config/settings';
import { isLoopback, isPrivateAddress } from '../net';
import type { Logger } from '../logger';
import type { SimHub } from '../sim/hub';

export interface GatewayOptions {
  hub: SimHub;
  settings: SettingsService;
  log: Logger;
  version: string;
  lanUrls: () => string[];
  allowedOrigins: () => string[];
  allowPublicClients: boolean;
}

interface Client {
  ws: WebSocket;
  sessionId: string;
  deviceId: string;
  name: string;
  role: DeviceRole;
  remote: string;
  alive: boolean;
  resync: boolean;
  tokens: number;
  lastRefill: number;
}

const HELLO_TIMEOUT_MS = 5000;
const BUCKET = { capacity: 400, perSecond: 250 };

/** Same-origin browsers always pass; other browser origins must be allow-listed. Non-browser clients send no Origin. */
export function checkOrigin(origin: string | undefined, hostHeader: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (hostHeader && host === hostHeader.toLowerCase()) return true;
  return allowed.some((a) => a.toLowerCase() === host);
}

export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export class Gateway {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private clients = new Map<string, Client>(); // deviceId -> client
  private heartbeat: NodeJS.Timeout;
  private failures = new Map<string, { n: number; until: number }>();
  private lastErrorAt = new Map<string, number>();

  constructor(private readonly o: GatewayOptions) {
    const { hub } = o;
    hub.on('patch', (m) => this.broadcast(m));
    hub.on('state', (m) => this.broadcast(m));
    hub.on('status', (m) => this.broadcast(m));
    hub.on('profile', (m) => this.broadcast(m));
    hub.on('error', (m) => {
      // identical SDK errors (e.g. a repeating exception) are shown at most every 3 s
      const key = `${m.code}|${m.message}`;
      const now = Date.now();
      if ((this.lastErrorAt.get(key) ?? 0) + 3000 > now) return;
      this.lastErrorAt.set(key, now);
      this.broadcast(m);
    });
    this.heartbeat = setInterval(() => this.beat(), 10_000);
  }

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
  }

  get devices(): { id: string; name: string; role: DeviceRole; remote: string }[] {
    return [...this.clients.values()].map((c) => ({ id: c.deviceId, name: c.name, role: c.role, remote: c.remote }));
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (code: number, why: string) => {
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return reject(404, 'Not Found');
    const remote = req.socket.remoteAddress ?? '';
    if (!this.o.allowPublicClients && !isPrivateAddress(remote)) {
      this.o.log.warn(`rejected WebSocket from non-private address ${remote}`);
      return reject(403, 'Forbidden');
    }
    if (!checkOrigin(req.headers.origin, req.headers.host, this.o.allowedOrigins())) {
      this.o.log.warn(`rejected WebSocket with bad origin ${req.headers.origin} from ${remote}`);
      return reject(403, 'Forbidden');
    }
    const f = this.failures.get(remote);
    if (f && f.n >= 5 && Date.now() < f.until) return reject(429, 'Too Many Requests');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, remote));
  }

  private onConnection(ws: WebSocket, remote: string): void {
    let client: Client | null = null;
    const helloTimer = setTimeout(() => {
      this.rawSend(ws, { type: 'error', code: 'unauthorized', message: 'hello expected' });
      ws.close(4001, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text only');
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        this.rawSend(ws, { type: 'error', code: 'bad-message', message: parsed.message });
        return;
      }
      const msg = parsed.msg;
      if (!client) {
        if (msg.type !== 'hello') {
          this.rawSend(ws, { type: 'error', code: 'unauthorized', message: 'hello expected first' });
          return ws.close(4001, 'hello expected');
        }
        clearTimeout(helloTimer);
        client = this.handleHello(ws, remote, msg);
        return;
      }
      if (!this.take(client)) {
        this.send(client, { type: 'error', code: 'rate-limited', message: 'too many messages' });
        return;
      }
      this.handle(client, msg);
    });
    ws.on('pong', () => { if (client) client.alive = true; });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (client && this.clients.get(client.deviceId)?.sessionId === client.sessionId) {
        this.clients.delete(client.deviceId);
        this.o.hub.endSession({ deviceId: client.deviceId, sessionId: client.sessionId });
        this.o.log.info(`device left: ${client.name} (${client.role}) ${client.remote}`);
        this.broadcastDevices();
      }
    });
    ws.on('error', (e) => this.o.log.debug(`ws error: ${e.message}`));
  }

  private fail(ws: WebSocket, remote: string, code: ErrorCode, message: string, close: number): null {
    this.rawSend(ws, { type: 'error', code, message });
    ws.close(close, message);
    if (code === 'unauthorized') {
      const f = this.failures.get(remote) ?? { n: 0, until: 0 };
      f.n++;
      f.until = Date.now() + 60_000;
      this.failures.set(remote, f);
      this.o.log.warn(`authentication failed from ${remote}`);
    }
    return null;
  }

  private handleHello(ws: WebSocket, remote: string, msg: Extract<ClientMessage, { type: 'hello' }>): Client | null {
    if (msg.protocol !== PROTOCOL_VERSION) return this.fail(ws, remote, 'protocol-mismatch', `server speaks protocol ${PROTOCOL_VERSION}`, 4004);
    if (!tokensEqual(msg.token, this.o.settings.token)) return this.fail(ws, remote, 'unauthorized', 'invalid pairing token', 4003);
    this.failures.delete(remote);

    const old = this.clients.get(msg.deviceId);
    if (old) {
      this.o.hub.endSession({ deviceId: old.deviceId, sessionId: old.sessionId });
      this.clients.delete(old.deviceId); // detach first so its close handler does not remove the new client
      old.ws.close(4002, 'replaced by a newer connection');
    }
    const dev = this.o.settings.device(msg.deviceId).value;
    const c: Client = {
      ws, sessionId: randomUUID(), deviceId: msg.deviceId, name: msg.deviceName ?? dev.deviceName ?? msg.role, role: msg.role,
      remote, alive: true, resync: false, tokens: BUCKET.capacity, lastRefill: Date.now(),
    };
    this.clients.set(c.deviceId, c);
    this.o.log.info(`device joined: ${c.name} (${c.role}) ${remote}`);

    const hub = this.o.hub;
    // Always adopt the simulator state: a (re)connecting device receives the current snapshot and never pushes its own.
    this.send(c, { type: 'welcome', protocol: PROTOCOL_VERSION, serverVersion: this.o.version, deviceId: c.deviceId, adapter: hub.status.adapter, mock: hub.status.mock });
    this.send(c, hub.status);
    this.send(c, hub.profileMessage());
    this.send(c, this.snapshot(c));
    this.send(c, hub.stateMessage());
    this.broadcastDevices();
    return c;
  }

  private snapshot(c: Client): ServerMessage {
    return { type: 'config.snapshot', shared: this.o.settings.shared.value, device: this.o.settings.device(c.deviceId).value, lanUrls: this.o.lanUrls() };
  }

  private handle(c: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        return;
      case 'ping':
        return this.send(c, { type: 'pong', t: msg.t });
      case 'control.set': {
        const ack = this.o.hub.handleControlSet({ deviceId: c.deviceId, sessionId: c.sessionId }, msg);
        // chatty "ok" acks for every drag update are skipped; clients only need outcomes that matter
        if (ack.status !== 'ok' || msg.phase !== 'update') this.send(c, ack);
        return;
      }
      case 'config.get':
        return this.send(c, this.snapshot(c));
      case 'config.save': {
        if (msg.scope === 'shared') {
          const r = SharedSettingsSchema.safeParse(msg.data);
          if (!r.success) return this.send(c, { type: 'error', code: 'bad-config', message: r.error.issues[0]?.message ?? 'invalid shared settings' });
          this.o.settings.shared.set(r.data);
          this.o.hub.reselect();
          for (const other of this.clients.values()) this.send(other, this.snapshot(other));
        } else {
          const r = DeviceSettingsSchema.safeParse(msg.data);
          if (!r.success) return this.send(c, { type: 'error', code: 'bad-config', message: r.error.issues[0]?.message ?? 'invalid device settings' });
          this.o.settings.device(c.deviceId).set(r.data);
          if (r.data.deviceName && r.data.deviceName !== c.name) { c.name = r.data.deviceName; this.broadcastDevices(); }
          this.send(c, this.snapshot(c));
        }
        return;
      }
      case 'profile.select': {
        const profiles = this.o.hub.profileMessage().profiles;
        if (msg.profileId && !profiles.some((p) => p.id === msg.profileId)) return this.send(c, { type: 'error', code: 'bad-config', message: 'unknown profile' });
        const cur = this.o.settings.shared.value;
        const map = { ...cur.aircraftProfiles };
        if (msg.profileId) map[msg.aircraftKey] = msg.profileId;
        else delete map[msg.aircraftKey];
        this.o.settings.shared.set({ ...cur, aircraftProfiles: map });
        this.o.hub.reselect();
        for (const other of this.clients.values()) this.send(other, this.snapshot(other));
        return;
      }
      case 'device.update':
        if (msg.deviceName) c.name = msg.deviceName;
        if (msg.role) c.role = msg.role;
        return this.broadcastDevices();
    }
  }

  private take(c: Client): boolean {
    const now = Date.now();
    c.tokens = Math.min(BUCKET.capacity, c.tokens + ((now - c.lastRefill) / 1000) * BUCKET.perSecond);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private rawSend(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  send(c: Client, msg: ServerMessage): void {
    const ws = c.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1_000_000) {
      // slow consumer: drop incremental updates and resync with a full snapshot once it drains
      if (msg.type === 'sim.patch') { c.resync = true; return; }
    } else if (c.resync) {
      c.resync = false;
      ws.send(JSON.stringify(this.o.hub.stateMessage()));
      if (msg.type === 'sim.patch') return; // snapshot already includes it
    }
    ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.clients.values()) this.send(c, msg);
  }

  private broadcastDevices(): void {
    this.broadcast({ type: 'devices', devices: this.devices.map(({ id, name, role }) => ({ id, name, role })) });
  }

  private beat(): void {
    for (const c of this.clients.values()) {
      if (!c.alive) {
        this.o.log.info(`device timed out: ${c.name}`);
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try { c.ws.ping(); } catch { /* closing */ }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const c of this.clients.values()) c.ws.close(1001, 'server shutting down');
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

export { isLoopback };

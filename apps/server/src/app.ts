import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SimAdapter } from './adapters/types';
import { MockAdapter } from './adapters/mock';
import { SimConnectAdapter } from './adapters/simconnect';
import { SettingsService, type ServerOverrides } from './config/settings';
import { createRequestHandler } from './http';
import { createLogger, type Logger } from './logger';
import { listLanAddresses } from './net';
import { DEFAULT_BRIDGE_PATH, WEB_DIST_DIR } from './paths';
import { SimHub } from './sim/hub';
import { UpdateChecker } from './update';
import { SERVER_VERSION, UPDATE_REPO, installMode } from './version';
import { Gateway } from './ws/gateway';

export { SERVER_VERSION };

export interface AppOptions {
  dataDir: string;
  /** inject the update checker (tests); otherwise one is created from the config */
  updates?: UpdateChecker;
  /** inject what "Update now" does (tests); default starts scripts\update.ps1 */
  applyUpdate?: () => void;
  /** override release / dev detection (tests) */
  installMode?: 'release' | 'dev';
  overrides?: ServerOverrides;
  webRoot?: string;
  log?: Logger;
  /** inject an adapter (tests); otherwise chosen from config */
  adapter?: SimAdapter;
  /** extra Origin hosts allowed to open the WebSocket (dev server) */
  devOrigins?: string[];
}

export interface App {
  settings: SettingsService;
  hub: SimHub;
  gateway: Gateway;
  mock?: MockAdapter;
  log: Logger;
  start(): Promise<{ port: number; hosts: string[]; urls: string[] }>;
  stop(): Promise<void>;
  readonly port: number;
}

export function resolveListenHosts(host: string, lan: string[]): string[] {
  if (host === 'auto') return [...lan.slice(0, 1), '127.0.0.1'];
  if (host === '0.0.0.0' || host === '::') return [host];
  return host === '127.0.0.1' || host === 'localhost' ? ['127.0.0.1'] : [host, '127.0.0.1'];
}

export function createApp(opts: AppOptions): App {
  const bootLog = opts.log ?? createLogger('info');
  const settings = new SettingsService(opts.dataDir, bootLog.child('config'), opts.overrides);
  const cfg = settings.effective;
  const log = opts.log ?? createLogger(cfg.logLevel);
  log.setLevel(cfg.logLevel);

  let mock: MockAdapter | undefined;
  let adapter = opts.adapter;
  if (!adapter) {
    if (cfg.adapter === 'mock') {
      mock = new MockAdapter(log.child('mock'), { flight: true });
      adapter = mock;
    } else {
      adapter = new SimConnectAdapter(cfg.bridgePath ?? DEFAULT_BRIDGE_PATH, log.child('bridge'));
    }
  } else if (adapter instanceof MockAdapter) mock = adapter;

  const profiles = settings.loadProfiles();
  const hub = new SimHub({ adapter, profiles: () => profiles, shared: () => settings.shared.value, log: log.child('hub'), stateHz: cfg.stateHz, enumerateInputEvents: cfg.logInputEvents });

  let port = cfg.port;
  const lanUrls = () => listLanAddresses().map((a) => `http://${a.address}:${port}`);
  const startedAt = Date.now();

  const allowed = [...cfg.allowedOrigins, ...(opts.devOrigins ?? [])];
  const gateway = new Gateway({
    hub, settings, log: log.child('ws'), version: SERVER_VERSION, lanUrls,
    allowedOrigins: () => allowed, allowPublicClients: cfg.allowPublicClients,
  });

  // update checks only for a real simulator install (never in mock / tests), and never when switched off
  const updates = opts.updates ?? new UpdateChecker({
    repo: UPDATE_REPO,
    current: SERVER_VERSION,
    log: log.child('update'),
    enabled: cfg.checkForUpdates && cfg.adapter !== 'mock' && !opts.adapter && !process.env.CRIM_NO_UPDATE_CHECK,
    apiBase: process.env.CRIM_UPDATE_API,
  });

  const handler = createRequestHandler({
    hub, gateway, settings, log: log.child('http'), version: SERVER_VERSION, webRoot: opts.webRoot ?? WEB_DIST_DIR, lanUrls, mock, startedAt,
    updates, installMode: opts.installMode ?? installMode(), applyUpdate: opts.applyUpdate,
  });

  const servers: Server[] = [];

  const listen = (host: string, p: number) =>
    new Promise<Server>((resolve, reject) => {
      const s = createServer((req, res) => void handler(req, res));
      gateway.attach(s);
      s.once('error', reject);
      s.listen(p, host, () => resolve(s));
    });

  return {
    settings, hub, gateway, mock, log,
    get port() { return port; },
    async start() {
      hub.start();
      updates.start();
      const lan = listLanAddresses().map((a) => a.address);
      const hosts = resolveListenHosts(cfg.host, lan);
      if (cfg.host === 'auto' && !lan.length) log.warn('no private LAN address found; listening on loopback only');
      for (const h of hosts) {
        try {
          const s = await listen(h, port);
          servers.push(s);
          port = (s.address() as AddressInfo).port; // port 0 -> actual port, reused for the remaining interfaces
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (servers.length === 0) throw new Error(err.code === 'EADDRINUSE' ? `port ${port} is already in use (is CRIM Flight Deck already running?)` : `cannot listen on ${h}:${port}: ${err.message}`);
          log.warn(`could not listen on ${h}:${port}: ${err.message}`);
        }
      }
      return { port, hosts, urls: lanUrls() };
    },
    async stop() {
      log.info('shutting down');
      updates.stop();
      await gateway.close();
      await Promise.all(servers.map((s) => new Promise<void>((r) => { s.close(() => r()); s.closeAllConnections?.(); })));
      await hub.stop();
      settings.flushAll();
    },
  };
}

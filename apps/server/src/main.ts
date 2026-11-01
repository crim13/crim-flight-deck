import { parseArgs } from 'node:util';
import { createApp, SERVER_VERSION } from './app';
import { createLogger } from './logger';
import { defaultDataDir } from './paths';
import type { ServerOverrides } from './config/settings';
import type { LogLevel } from '@crim/shared';

const { values } = parseArgs({
  options: {
    adapter: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    'log-level': { type: 'string' },
    'data-dir': { type: 'string' },
    'bridge-path': { type: 'string' },
    'log-input-events': { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`CRIM Flight Deck server v${SERVER_VERSION}
  --adapter simconnect|mock   simulator adapter (default: simconnect; "mock" is for development only)
  --host auto|0.0.0.0|<ip>    interface to bind (default: auto = LAN address + loopback)
  --port <n>                  HTTP/WebSocket port (default 3000)
  --log-level error|warn|info|debug
  --data-dir <path>           settings directory (default: <repo>/data)
  --bridge-path <exe>         SimConnect bridge executable
  --log-input-events          log the aircraft's Input Events (discovery aid)
  --dev                       also allow the Vite dev server origin (http://localhost:5173)
Environment: CRIM_ADAPTER, CRIM_PORT, CRIM_HOST, CRIM_LOG_LEVEL, CRIM_DATA_DIR`);
  process.exit(0);
}

const pick = (cli: string | undefined, env: string | undefined) => cli ?? env;
const adapter = pick(values.adapter, process.env.CRIM_ADAPTER);
if (adapter && adapter !== 'simconnect' && adapter !== 'mock') {
  console.error(`invalid --adapter "${adapter}" (use simconnect or mock)`);
  process.exit(2);
}
const level = pick(values['log-level'], process.env.CRIM_LOG_LEVEL);
if (level && !['error', 'warn', 'info', 'debug'].includes(level)) {
  console.error(`invalid log level "${level}"`);
  process.exit(2);
}
const portStr = pick(values.port, process.env.CRIM_PORT);
const overrides: ServerOverrides = {
  adapter: adapter as ServerOverrides['adapter'],
  host: pick(values.host, process.env.CRIM_HOST),
  port: portStr ? Number(portStr) : undefined,
  logLevel: level as LogLevel | undefined,
  bridgePath: values['bridge-path'],
  logInputEvents: values['log-input-events'] ? true : undefined,
};
if (overrides.port !== undefined && !(overrides.port >= 0 && overrides.port < 65536)) {
  console.error(`invalid port "${portStr}"`);
  process.exit(2);
}

const log = createLogger((overrides.logLevel ?? 'info') as LogLevel);
const dataDir = values['data-dir'] ?? defaultDataDir();
const app = createApp({
  dataDir,
  overrides,
  log,
  devOrigins: values.dev ? ['localhost:5173', '127.0.0.1:5173'] : [],
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`received ${signal}`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    await app.stop();
  } catch (e) {
    log.error(`error during shutdown: ${(e as Error).message}`);
  }
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(s, () => void shutdown(s));
process.on('uncaughtException', (e) => { log.error(`uncaught exception: ${e.stack ?? e.message}`); void shutdown('uncaughtException'); });
process.on('unhandledRejection', (e) => log.error(`unhandled rejection: ${e instanceof Error ? e.stack : String(e)}`));

app.start().then(({ port, urls }) => {
  const token = app.settings.token;
  const bar = '='.repeat(64);
  console.log(`\n${bar}\n  CRIM FLIGHT DECK  v${SERVER_VERSION}   adapter: ${app.settings.effective.adapter.toUpperCase()}`);
  if (app.hub.status.mock) console.log('  *** MOCK MODE: simulated data - NOT connected to MSFS ***');
  console.log(`  PC admin / QR code : http://localhost:${port}/admin`);
  if (urls.length) {
    for (const u of urls) console.log(`  Tablet / phone     : ${u}/?t=${token}`);
    console.log('  (open the link once per device; the browser remembers the pairing token)');
  } else console.log('  No LAN address detected - devices cannot reach this PC.');
  console.log(`  Data directory     : ${dataDir}\n${bar}\n`);
}).catch((e: Error) => {
  log.error(e.message);
  process.exit(1);
});

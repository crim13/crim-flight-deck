import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/server/src/paths.ts and apps/server/dist/server.mjs are both three levels below the repo root.
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(here, '..', '..', '..');
export const WEB_DIST_DIR = join(ROOT_DIR, 'apps', 'web', 'dist');
export const DEFAULT_BRIDGE_PATH = join(ROOT_DIR, 'apps', 'simconnect-bridge', 'bin', 'CrimSimConnectBridge.exe');

export function defaultDataDir(): string {
  return process.env.CRIM_DATA_DIR ? resolve(process.env.CRIM_DATA_DIR) : join(ROOT_DIR, 'data');
}

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_PROFILES, DeviceSettingsSchema, ServerConfigSchema, SharedSettingsSchema, defaultDeviceSettings,
  defaultSharedSettings, parseProfile, type DeviceSettings, type Profile, type ServerConfig, type SharedSettings,
} from '@crim/shared';
import type { Logger } from '../logger';
import { JsonFile } from './jsonfile';

export interface ServerOverrides {
  host?: string;
  port?: number;
  adapter?: 'simconnect' | 'mock';
  logLevel?: ServerConfig['logLevel'];
  bridgePath?: string;
  logInputEvents?: boolean;
}

export function newToken(): string {
  return randomBytes(18).toString('base64url');
}

export class SettingsService {
  readonly server: JsonFile<ServerConfig>;
  readonly shared: JsonFile<SharedSettings>;
  /** server config with run-time (CLI/env) overrides applied; overrides are not persisted */
  readonly effective: ServerConfig;
  private devices = new Map<string, JsonFile<DeviceSettings>>();

  constructor(readonly dataDir: string, private readonly log: Logger, overrides: ServerOverrides = {}) {
    mkdirSync(join(dataDir, 'devices'), { recursive: true });
    mkdirSync(join(dataDir, 'profiles'), { recursive: true });
    this.server = new JsonFile(
      join(dataDir, 'server.json'),
      ServerConfigSchema,
      () => ServerConfigSchema.parse({ version: 1, token: newToken() }),
      log,
    );
    if (!this.server.value.token) this.server.set({ ...this.server.value, token: newToken() }, 0);
    this.shared = new JsonFile(join(dataDir, 'shared.json'), SharedSettingsSchema, defaultSharedSettings, log);
    const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
    this.effective = { ...this.server.value, ...defined } as ServerConfig;
  }

  get token(): string {
    return this.server.value.token!;
  }

  device(deviceId: string): JsonFile<DeviceSettings> {
    let f = this.devices.get(deviceId);
    if (!f) {
      f = new JsonFile(join(this.dataDir, 'devices', `${deviceId}.json`), DeviceSettingsSchema, defaultDeviceSettings, this.log);
      this.devices.set(deviceId, f);
    }
    return f;
  }

  /** built-in profiles + user profiles from data/profiles (same id overrides built-in) */
  loadProfiles(): Profile[] {
    const byId = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]));
    const dir = join(this.dataDir, 'profiles');
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        try {
          const p = parseProfile(JSON.parse(readFileSync(join(dir, f), 'utf8')));
          byId.set(p.id, p);
          this.log.info(`loaded user profile ${p.id} (${f})`);
        } catch (e) {
          this.log.warn(`ignoring invalid profile ${f}: ${(e as Error).message}`);
        }
      }
    }
    return [...byId.values()];
  }

  flushAll(): void {
    this.server.flush();
    this.shared.flush();
    for (const d of this.devices.values()) d.flush();
  }
}

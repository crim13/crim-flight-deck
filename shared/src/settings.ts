import { z } from 'zod';
import { CONTROL_IDS } from './controls';
import { PhoneLayoutSchema, TabletLayoutSchema } from './layout';

// ---------------------------------------------------------------------------
// Shared settings: apply to every device (per-aircraft decisions, control tuning).
// Device settings: belong to one tablet/phone (layouts, mode, start page).
// Server config: process level (port, bind address, adapter ...).
// All three are versioned; unknown versions are backed up and reset by the loader.
// ---------------------------------------------------------------------------

export const ControlSettingSchema = z.object({
  /** reverse direction of the lever / trim wheel */
  invert: z.boolean().optional(),
  /** drag gain multiplier 0.25 .. 2 */
  sensitivity: z.number().min(0.25).max(2).optional(),
  hidden: z.boolean().optional(),
});
export type ControlSetting = z.infer<typeof ControlSettingSchema>;

export const SharedSettingsSchema = z.object({
  version: z.literal(1),
  /** aircraftKey -> profile id (user override of automatic selection) */
  aircraftProfiles: z.record(z.string().max(160), z.string().max(64)).default({}),
  /** profile id -> control id -> tuning */
  controlSettings: z.record(z.string().max(64), z.record(z.enum(CONTROL_IDS), ControlSettingSchema)).default({}),
  preferredStartPage: z.enum(['autopilot', 'radios', 'systems', 'quick']).default('autopilot'),
});
export type SharedSettings = z.infer<typeof SharedSettingsSchema>;

export const DeviceModeSchema = z.enum(['auto', 'tablet', 'phone']);
export type DeviceMode = z.infer<typeof DeviceModeSchema>;

export const DeviceSettingsSchema = z.object({
  version: z.literal(1),
  deviceName: z.string().max(40).optional(),
  mode: DeviceModeSchema.default('auto'),
  startPage: z.enum(['autopilot', 'radios', 'systems', 'quick']).optional(),
  /** profile id -> layout; falls back to the generated default */
  tabletLayouts: z.record(z.string().max(64), TabletLayoutSchema).default({}),
  phoneLayouts: z.record(z.string().max(64), PhoneLayoutSchema).default({}),
  /** profile id -> extra pages of the tablet (AP, radios, systems, quick) laid out for landscape; the throttle quadrant is `tabletLayouts` */
  tabletPages: z.record(z.string().max(64), PhoneLayoutSchema).default({}),
});
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;

export const LogLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ServerConfigSchema = z.object({
  version: z.literal(1),
  /** "auto" = detected private LAN address (+ loopback); "0.0.0.0"; or an explicit interface address */
  host: z.string().default('auto'),
  port: z.number().int().min(1).max(65535).default(3000),
  adapter: z.enum(['simconnect', 'mock']).default('simconnect'),
  logLevel: LogLevelSchema.default('info'),
  /** max state broadcast rate to clients (Hz) */
  stateHz: z.number().int().min(1).max(60).default(30),
  /** pairing token; generated on first start */
  token: z.string().min(16).optional(),
  /** extra allowed Origin hosts (host[:port]); same-origin is always allowed */
  allowedOrigins: z.array(z.string()).default([]),
  /** allow clients outside private/loopback ranges (never enabled by default) */
  allowPublicClients: z.boolean().default(false),
  bridgePath: z.string().optional(),
  /** log the Input Events exposed by the loaded aircraft (discovery aid for aircraft specific mappings) */
  logInputEvents: z.boolean().default(false),
  /** look for a newer GitHub release now and then (read only; never installs by itself) */
  checkForUpdates: z.boolean().default(true),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export function defaultSharedSettings(): SharedSettings {
  return SharedSettingsSchema.parse({ version: 1 });
}
export function defaultDeviceSettings(): DeviceSettings {
  return DeviceSettingsSchema.parse({ version: 1 });
}

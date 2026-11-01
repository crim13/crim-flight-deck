import { z } from 'zod';
import { CONTROL_IDS } from './controls';
import { ProfileSchema } from './profile';
import type { StateMap } from './state';

export const PROTOCOL_VERSION = 1;

export const DeviceRoleSchema = z.enum(['tablet', 'phone', 'other']);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const ERROR_CODES = [
  'bad-message', 'unauthorized', 'bad-origin', 'protocol-mismatch', 'unsupported-control',
  'sim-offline', 'rate-limited', 'sdk-error', 'bad-config', 'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

const ControlId = z.enum(CONTROL_IDS);

export const HelloSchema = z.object({
  type: z.literal('hello'),
  token: z.string().min(1).max(128),
  deviceId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  deviceName: z.string().max(40).optional(),
  role: DeviceRoleSchema,
  protocol: z.number().int(),
}).strict();

/**
 * phase: begin/update/end bracket a continuous gesture (the device "owns" the control while
 * dragging); "set" is a discrete, one-shot command (the default).
 */
export const ControlSetSchema = z.object({
  type: z.literal('control.set'),
  control: ControlId,
  value: z.number().finite(),
  engine: z.number().int().min(1).max(4).optional(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(['begin', 'update', 'end', 'set']).optional(),
}).strict();

export const ConfigSaveSchema = z.object({
  type: z.literal('config.save'),
  scope: z.enum(['device', 'shared']),
  data: z.unknown(),
}).strict();

export const ConfigGetSchema = z.object({ type: z.literal('config.get') }).strict();

export const ProfileSelectSchema = z.object({
  type: z.literal('profile.select'),
  aircraftKey: z.string().min(1).max(160),
  profileId: z.string().max(64).nullable(),
}).strict();

export const DeviceUpdateSchema = z.object({
  type: z.literal('device.update'),
  deviceName: z.string().max(40).optional(),
  role: DeviceRoleSchema.optional(),
}).strict();

export const PingSchema = z.object({ type: z.literal('ping'), t: z.number() }).strict();

export const ClientMessageSchema = z.discriminatedUnion('type', [
  HelloSchema, ControlSetSchema, ConfigSaveSchema, ConfigGetSchema, ProfileSelectSchema, DeviceUpdateSchema, PingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ControlSetMessage = z.infer<typeof ControlSetSchema>;
export type HelloMessage = z.infer<typeof HelloSchema>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type SimLinkState = 'disconnected' | 'connecting' | 'connected';
export type BridgeState = 'stopped' | 'starting' | 'running' | 'failed';

export interface SimStatus {
  type: 'sim.status';
  adapter: 'simconnect' | 'mock';
  /** true when the data is simulated - must be shown prominently by every UI */
  mock: boolean;
  bridge: BridgeState;
  /** SimConnect link to MSFS. "connected" only after the simulator answered. */
  sim: SimLinkState;
  detail?: string;
  simApp?: string;
}

export interface WelcomeMessage {
  type: 'welcome';
  protocol: number;
  serverVersion: string;
  deviceId: string;
  adapter: 'simconnect' | 'mock';
  mock: boolean;
}

export interface SimStateMessage { type: 'sim.state'; rev: number; full: true; data: StateMap }
export interface SimPatchMessage { type: 'sim.patch'; rev: number; data: StateMap }

export const ProfileSummarySchema = z.object({ id: z.string(), name: z.string() });
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export interface ProfileActiveMessage {
  type: 'profile.active';
  profile: z.infer<typeof ProfileSchema> | null;
  reason: 'override' | 'match' | 'fallback' | 'none';
  aircraftKey: string | null;
  profiles: ProfileSummary[];
}

export type AckStatus = 'ok' | 'redundant' | 'rejected' | 'busy' | 'stale';
export interface AckMessage {
  type: 'ack';
  sequence: number;
  control: string;
  status: AckStatus;
  reason?: string;
}

export interface ErrorMessage { type: 'error'; code: ErrorCode; message: string; detail?: string }

export interface ConfigSnapshotMessage {
  type: 'config.snapshot';
  shared: unknown;
  device: unknown;
  /** local address info for the settings sheet */
  lanUrls: string[];
}

export interface DevicesMessage {
  type: 'devices';
  devices: { id: string; name: string; role: DeviceRole }[];
}

export interface PongMessage { type: 'pong'; t: number }

export type ServerMessage =
  | WelcomeMessage | SimStatus | SimStateMessage | SimPatchMessage | ProfileActiveMessage
  | AckMessage | ErrorMessage | ConfigSnapshotMessage | DevicesMessage | PongMessage;

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; message: string };

export const MAX_MESSAGE_BYTES = 128 * 1024;

export function parseClientMessage(raw: string | unknown): ParseResult {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, message: 'message too large' };
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, message: 'invalid JSON' };
    }
  }
  const r = ClientMessageSchema.safeParse(obj);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, message: `${first?.path.join('.') || 'message'}: ${first?.message ?? 'invalid'}` };
  }
  return { ok: true, msg: r.data };
}

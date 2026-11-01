import { z } from 'zod';
import { CommandMappingSchema } from './commands';
import { CONTROL_IDS, CONTROLS, MAX_ENGINES, isControlId, type ControlId } from './controls';
import type { AircraftIdentity, EngineType, SimCaps } from './state';

const ControlIdSchema = z.enum(CONTROL_IDS);
const EngineTypeSchema = z.enum(['piston', 'jet', 'none', 'helo', 'unsupported', 'turboprop', 'electric']);

export const ProfileControlSchema = z.object({
  enabled: z.boolean(),
  /** shown when disabled, e.g. "Fixed-pitch propeller" */
  reason: z.string().max(120).optional(),
  label: z.string().max(24).optional(),
  /** Override of the default command mapping (aircraft specific integration point). */
  mapping: CommandMappingSchema.optional(),
});

export const FlapDetentSchema = z.object({
  index: z.number().int().min(0).max(16),
  label: z.string().max(8),
  /** informational, e.g. degrees */
  detail: z.string().max(12).optional(),
});

export const ProfileSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  engines: z.number().int().min(1).max(MAX_ENGINES),
  propeller: z.enum(['none', 'fixed', 'constantSpeed']),
  match: z.object({
    engineTypes: z.array(EngineTypeSchema).optional(),
    titleIncludes: z.array(z.string().min(1)).optional(),
    atcModelIncludes: z.array(z.string().min(1)).optional(),
    engineCountMin: z.number().int().optional(),
    engineCountMax: z.number().int().optional(),
    /** higher wins; explicit title matches should use > 50 */
    priority: z.number().int().default(0),
  }),
  controls: z.record(ControlIdSchema, ProfileControlSchema),
  /** Optional flap labelling. Without it, detents are derived from the simulator (FLAPS NUM HANDLE POSITIONS). */
  flapDetents: z.array(FlapDetentSchema).max(17).optional(),
  labels: z.record(z.string(), z.string().max(16)).optional(),
  verification: z.object({
    status: z.enum(['docs', 'live']),
    notes: z.string().max(600).optional(),
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function parseProfile(json: unknown): Profile {
  return ProfileSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function matchScore(profile: Profile, id: AircraftIdentity): number | null {
  const m = profile.match;
  const title = (id.title ?? '').toLowerCase();
  const atcModel = (id.atcModel ?? '').toLowerCase();
  let score = m.priority;
  let specific = false;
  if (m.engineTypes && m.engineTypes.length) {
    if (!id.engineType || !m.engineTypes.includes(id.engineType)) return null;
  }
  if (m.engineCountMin != null && (id.engineCount ?? 1) < m.engineCountMin) return null;
  if (m.engineCountMax != null && (id.engineCount ?? 1) > m.engineCountMax) return null;
  if (m.titleIncludes && m.titleIncludes.length) {
    if (!m.titleIncludes.some((t) => title.includes(t.toLowerCase()))) return null;
    specific = true;
  }
  if (m.atcModelIncludes && m.atcModelIncludes.length) {
    if (!m.atcModelIncludes.some((t) => atcModel.includes(t.toLowerCase()))) return null;
    specific = true;
  }
  return score + (specific ? 100 : 0);
}

export interface ProfileSelection {
  profile: Profile;
  reason: 'override' | 'match' | 'fallback';
}

/**
 * Choose the profile for an aircraft:
 *  1. explicit per-aircraft override (user choice, persisted)
 *  2. best matching profile by score
 *  3. the default fallback profile
 */
export function selectProfile(
  id: AircraftIdentity,
  profiles: Profile[],
  overrideId: string | null | undefined,
  fallbackId = 'generic-ga-fixed-pitch',
): ProfileSelection | null {
  if (overrideId) {
    const o = profiles.find((p) => p.id === overrideId);
    if (o) return { profile: o, reason: 'override' };
  }
  let best: { p: Profile; s: number } | null = null;
  for (const p of profiles) {
    const s = matchScore(p, id);
    if (s !== null && (!best || s > best.s)) best = { p, s };
  }
  if (best) return { profile: best.p, reason: 'match' };
  const fb = profiles.find((p) => p.id === fallbackId) ?? profiles[0];
  return fb ? { profile: fb, reason: 'fallback' } : null;
}

// ---------------------------------------------------------------------------
// Availability (profile x simulator capabilities)
// ---------------------------------------------------------------------------

export interface Availability {
  enabled: boolean;
  reason?: string;
}
export type AvailabilityMap = Record<ControlId, Availability>;

export function computeAvailability(profile: Profile | null, caps: SimCaps, simReady: boolean): AvailabilityMap {
  const out = {} as AvailabilityMap;
  for (const id of CONTROL_IDS) {
    if (!profile) {
      out[id] = { enabled: false, reason: 'No aircraft profile' };
      continue;
    }
    const pc = profile.controls[id];
    if (!pc || !pc.enabled) {
      out[id] = { enabled: false, reason: pc?.reason ?? 'Not supported by this aircraft profile' };
      continue;
    }
    if (!simReady) {
      out[id] = { enabled: false, reason: 'Simulator not connected' };
      continue;
    }
    const need = CONTROLS[id].needs;
    const capFalse: Record<string, boolean> = {
      gear: caps.gearRetractable === false,
      flaps: caps.flapsAvailable === false || (caps.flapsCount != null && caps.flapsCount < 2),
      spoilers: caps.spoilers === false,
      autopilot: caps.autopilot === false,
      transponder: caps.transponder === false,
      com1: caps.com1 === false,
      com2: caps.com2 === false,
      nav1: caps.nav1 === false,
      nav2: caps.nav2 === false,
    };
    if (need && capFalse[need]) {
      out[id] = { enabled: false, reason: 'Not equipped on this aircraft' };
      continue;
    }
    out[id] = { enabled: true };
  }
  return out;
}

export function isEngineAvailable(profile: Profile | null, caps: SimCaps, engine: number): boolean {
  if (!profile) return false;
  if (engine < 1 || engine > profile.engines) return false;
  if (caps.engineCount != null && caps.engineCount > 0 && engine > caps.engineCount) return false;
  return true;
}

export interface FlapDetent {
  index: number;
  label: string;
  detail?: string;
}

/**
 * Flap detents for the selector. Never assumes 0/10/20/30: uses the profile labels if given,
 * otherwise the number of handle positions reported by the simulator.
 */
export function flapDetents(profile: Profile | null, caps: SimCaps): FlapDetent[] {
  if (profile?.flapDetents?.length) return profile.flapDetents;
  const n = caps.flapsCount;
  if (!n || n < 2) return [];
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    label: i === 0 ? 'UP' : i === n - 1 ? 'FULL' : String(i),
  }));
}

export function flapsMaxIndex(profile: Profile | null, caps: SimCaps): number | null {
  const d = flapDetents(profile, caps);
  return d.length ? d[d.length - 1]!.index : null;
}

/** Controls a profile declares as supported (independent of live simulator capabilities). */
export function profileEnabledControls(profile: Profile): ControlId[] {
  return CONTROL_IDS.filter((id) => profile.controls[id]?.enabled);
}

export function enabledControls(av: AvailabilityMap): ControlId[] {
  return (Object.keys(av) as ControlId[]).filter((k) => isControlId(k) && av[k].enabled);
}

export type { EngineType };

import { create } from 'zustand';
import {
  computeAvailability, computeCaps, defaultDeviceSettings, defaultSharedSettings,
  type AckMessage, type AvailabilityMap, type DeviceSettings, type Profile, type ProfileSummary, type ServerMessage,
  type SharedSettings, type SimCaps, type SimStatus, type StateMap,
} from '@crim/shared';

export type LinkState = 'connecting' | 'open' | 'closed' | 'unauthorized';

export interface SimStoreState {
  link: LinkState;
  status: SimStatus | null;
  values: StateMap;
  rev: number;
  profile: Profile | null;
  profileReason: string;
  aircraftKey: string | null;
  profiles: ProfileSummary[];
  caps: SimCaps;
  availability: AvailabilityMap;
  devices: { id: string; name: string; role: string }[];
  shared: SharedSettings;
  device: DeviceSettings;
  lanUrls: string[];
  /** true once the server's config snapshot for this connection arrived */
  configReady: boolean;
  lastError: { message: string; at: number } | null;
  serverVersion: string | null;
  apply(msg: ServerMessage): void;
  setLink(l: LinkState): void;
  patchDevice(d: DeviceSettings): void;
  patchShared(s: SharedSettings): void;
}

type AckListener = (a: AckMessage) => void;
const ackListeners = new Set<AckListener>();
export const onAck = (cb: AckListener) => {
  ackListeners.add(cb);
  return () => { ackListeners.delete(cb); };
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const useSim = create<SimStoreState>((set, get) => {
  const recompute = (patch: Partial<SimStoreState>): Partial<SimStoreState> => {
    const s = { ...get(), ...patch };
    const caps = computeCaps(s.values);
    const availability = computeAvailability(s.profile, caps, s.status?.sim === 'connected');
    return {
      ...patch,
      caps: sameJson(caps, get().caps) ? get().caps : caps,
      availability: sameJson(availability, get().availability) ? get().availability : availability,
    };
  };

  return {
    link: 'connecting',
    status: null,
    values: {},
    rev: 0,
    profile: null,
    profileReason: 'none',
    aircraftKey: null,
    profiles: [],
    caps: computeCaps({}),
    availability: computeAvailability(null, computeCaps({}), false),
    devices: [],
    shared: defaultSharedSettings(),
    device: defaultDeviceSettings(),
    lanUrls: [],
    configReady: false,
    lastError: null,
    serverVersion: null,

    setLink: (link) => set(link === 'open' ? { link } : { link, configReady: false, ...(link === 'closed' ? recompute({ status: null, values: {} }) : {}) }),
    patchDevice: (device) => set({ device }),
    patchShared: (shared) => set({ shared }),

    apply(msg) {
      switch (msg.type) {
        case 'welcome':
          set({ serverVersion: msg.serverVersion, link: 'open' });
          break;
        case 'sim.status':
          set(recompute({ status: msg }));
          break;
        case 'sim.state':
          set(recompute({ values: msg.data, rev: msg.rev }));
          break;
        case 'sim.patch': {
          if (msg.rev <= get().rev) break; // stale / reordered after a resync
          const touchesCaps = Object.keys(msg.data).some((k) => k.startsWith('cap.') || k.startsWith('id.'));
          const next = { values: { ...get().values, ...msg.data }, rev: msg.rev };
          set(touchesCaps ? recompute(next) : next);
          break;
        }
        case 'profile.active':
          set(recompute({ profile: msg.profile, profileReason: msg.reason, aircraftKey: msg.aircraftKey, profiles: msg.profiles }));
          break;
        case 'config.snapshot':
          set({ shared: msg.shared as SharedSettings, device: msg.device as DeviceSettings, lanUrls: msg.lanUrls, configReady: true });
          break;
        case 'devices':
          set({ devices: msg.devices });
          break;
        case 'ack':
          for (const l of ackListeners) l(msg);
          break;
        case 'error':
          set({ lastError: { message: msg.message, at: Date.now() }, ...(msg.code === 'unauthorized' ? { link: 'unauthorized' as const } : {}) });
          break;
        case 'pong':
          break;
      }
    },
  };
});

/** simulator confirmed + authenticated socket: the only state in which the UI may claim "connected" */
export const selectLive = (s: SimStoreState) => s.link === 'open' && s.status?.sim === 'connected';

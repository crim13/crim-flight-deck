import type { DeviceSettings, SharedSettings } from '@crim/shared';
import { useSim } from '../stores/sim';
import { connection } from './connection';

// Settings are edited optimistically in the local store and persisted to the server (debounced).
// The server validates and stores them; shared settings are pushed back to every device.
let deviceTimer: ReturnType<typeof setTimeout> | null = null;
let sharedTimer: ReturnType<typeof setTimeout> | null = null;

export function saveDevice(mut: (d: DeviceSettings) => DeviceSettings, delay = 350): void {
  const next = mut(useSim.getState().device);
  useSim.getState().patchDevice(next);
  if (deviceTimer) clearTimeout(deviceTimer);
  deviceTimer = setTimeout(() => {
    deviceTimer = null;
    connection.send({ type: 'config.save', scope: 'device', data: useSim.getState().device });
  }, delay);
}

export function saveShared(mut: (s: SharedSettings) => SharedSettings, delay = 350): void {
  const next = mut(useSim.getState().shared);
  useSim.getState().patchShared(next);
  if (sharedTimer) clearTimeout(sharedTimer);
  sharedTimer = setTimeout(() => {
    sharedTimer = null;
    connection.send({ type: 'config.save', scope: 'shared', data: useSim.getState().shared });
  }, delay);
}

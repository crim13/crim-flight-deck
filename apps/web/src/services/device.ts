// Per-browser identity and pairing token. localStorage can be unavailable (private mode), so
// every access is wrapped and falls back to memory.
import type { DeviceMode } from '@crim/shared';

const mem = new Map<string, string>();

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? mem.get(key) ?? null;
  } catch {
    return mem.get(key) ?? null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
  if (value === null) mem.delete(key);
  else mem.set(key, value);
}

function randomId(len: number): string {
  const bytes = new Uint8Array(len);
  (globalThis.crypto ?? ({ getRandomValues: (a: Uint8Array) => a.map(() => Math.random() * 256) } as Crypto)).getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function getDeviceId(): string {
  let id = load('crim.deviceId');
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = `dev-${randomId(16)}`;
    save('crim.deviceId', id);
  }
  return id;
}

export const getToken = (): string | null => load('crim.token');
export const setToken = (t: string | null): void => save('crim.token', t);

/** Accepts a bare token or a full pairing link (http://ip:3000/?t=TOKEN). */
export function parseToken(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.searchParams.get('t');
  } catch {
    return /^[A-Za-z0-9_-]{16,128}$/.test(s) ? s : null;
  }
}

/**
 * Reads ?t=<token> and ?mode=tablet|phone from the URL, stores them and removes them from the
 * address bar so the token does not stay visible / in history.
 */
export function consumeUrlParams(): DeviceMode | null {
  let requested: DeviceMode | null = null;
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('t');
    const mode = u.searchParams.get('mode');
    if (t) {
      setToken(t);
      u.searchParams.delete('t');
    }
    if (mode === 'tablet' || mode === 'phone' || mode === 'auto') {
      save('crim.mode', mode);
      requested = mode;
      u.searchParams.delete('mode');
    }
    if (t || mode) history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
  } catch { /* ignore */ }
  return requested;
}

export function storedMode(): DeviceMode {
  const m = load('crim.mode');
  return m === 'tablet' || m === 'phone' || m === 'auto' ? m : 'auto';
}

/** Tablet = landscape and large enough; everything else gets the phone layout. */
export function detectMode(w = window.innerWidth, h = window.innerHeight): 'tablet' | 'phone' {
  return w > h && Math.min(w, h) >= 560 ? 'tablet' : 'phone';
}

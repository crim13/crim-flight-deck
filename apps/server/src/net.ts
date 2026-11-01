import { networkInterfaces } from 'node:os';

export interface LanAddress {
  name: string;
  address: string;
}

const VIRTUAL = /(vethernet|virtualbox|vmware|hyper-v|loopback|docker|wsl|vpn|tailscale|zerotier|bluetooth|host-only|tap|tun)/i;

export function isPrivateAddress(addr: string): boolean {
  let a = addr;
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1' || a.startsWith('127.')) return true;
  if (a.includes(':')) return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a); // ULA / link-local IPv6
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
}

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || a.startsWith('127.');
}

/** Private IPv4 addresses, physical-looking adapters first (Wi-Fi / Ethernet before virtual switches). */
export function listLanAddresses(ifaces = networkInterfaces()): LanAddress[] {
  const out: (LanAddress & { score: number })[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || !isPrivateAddress(i.address) || i.address.startsWith('169.254.')) continue;
      let score = 0;
      if (VIRTUAL.test(name)) score += 10;
      if (/wi-?fi|wlan|wireless/i.test(name)) score -= 2;
      if (i.address.startsWith('192.168.')) score -= 1;
      out.push({ name, address: i.address, score });
    }
  }
  return out.sort((a, b) => a.score - b.score).map(({ name, address }) => ({ name, address }));
}

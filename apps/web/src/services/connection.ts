import { PROTOCOL_VERSION, type ClientMessage, type ControlId, type ServerMessage } from '@crim/shared';
import { useSim } from '../stores/sim';
import { getDeviceId, getToken, setToken } from './device';

export type Phase = 'begin' | 'update' | 'end' | 'set';

const PING_MS = 8000;
const DEAD_MS = 22000;
const UPDATE_MIN_MS = 30;

/**
 * WebSocket client: authenticates with the pairing token, adopts the server snapshot on every
 * (re)connect and never replays old values. Commands are dropped (not queued) while offline so a
 * stale gesture can never be applied to the simulator later.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastRx = 0;
  private seq = 0;
  private lastUpdateAt = new Map<string, number>();
  private pendingUpdate = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
  private stopped = true;
  role: 'tablet' | 'phone' | 'other' = 'other';
  deviceName: string | undefined;

  start(role: 'tablet' | 'phone'): void {
    this.role = role;
    if (!this.stopped) return;
    this.stopped = false;
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    this.open();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    if (this.retry) clearTimeout(this.retry);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  /** forget the token and reconnect (re-pairing) */
  reset(): void {
    setToken(null);
    useSim.getState().setLink('unauthorized');
    this.ws?.close();
  }

  private onVisible = () => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (!this.ws || this.ws.readyState > 1) {
      if (this.retry) clearTimeout(this.retry);
      this.open();
    }
  };

  private url(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  private open(): void {
    if (this.stopped) return;
    const token = getToken();
    if (!token) {
      useSim.getState().setLink('unauthorized');
      return;
    }
    useSim.getState().setLink('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.lastRx = Date.now();
      this.seq = 0;
      this.sendRaw({ type: 'hello', token, deviceId: getDeviceId(), deviceName: this.deviceName, role: this.role, protocol: PROTOCOL_VERSION });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.heartbeat(), PING_MS);
    };
    ws.onmessage = (ev) => {
      this.lastRx = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') this.attempt = 0;
      useSim.getState().apply(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.cancelPending();
      if (ev.code === 4003 || ev.code === 4004) {
        if (ev.code === 4003) setToken(null);
        useSim.getState().setLink('unauthorized');
        return;
      }
      // 4002: replaced by another tab using the same device id - do not fight it
      if (ev.code === 4002) {
        useSim.getState().setLink('closed');
        return;
      }
      useSim.getState().setLink('closed');
      this.scheduleRetry();
    };
    ws.onerror = () => { /* close follows */ };
  }

  private heartbeat(): void {
    if (Date.now() - this.lastRx > DEAD_MS) {
      this.ws?.close(); // half-open connection (e.g. Wi-Fi roaming): reconnect and resync
      return;
    }
    this.sendRaw({ type: 'ping', t: Date.now() });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry) return;
    const delay = Math.min(5000, 400 * 2 ** this.attempt++) + Math.random() * 250;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, delay);
  }

  private cancelPending(): void {
    for (const p of this.pendingUpdate.values()) clearTimeout(p.timer);
    this.pendingUpdate.clear();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && useSim.getState().link === 'open';
  }

  private sendRaw(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  send(msg: ClientMessage): boolean {
    return this.isOpen ? this.sendRaw(msg) : false;
  }

  /**
   * Send a control value. Drag updates are limited to ~33 Hz client side (latest wins);
   * begin / end / set go out immediately and flush any pending update first.
   */
  sendControl(control: ControlId, value: number, opts: { engine?: number; phase?: Phase } = {}): boolean {
    if (!this.isOpen) return false;
    const phase = opts.phase ?? 'set';
    const key = `${control}:${opts.engine ?? 1}`;
    const mk = (): ClientMessage => ({ type: 'control.set', control, value, engine: opts.engine && opts.engine > 1 ? opts.engine : undefined, phase, sequence: ++this.seq });
    if (phase !== 'update') {
      const p = this.pendingUpdate.get(key);
      if (p) { clearTimeout(p.timer); this.pendingUpdate.delete(key); }
      this.lastUpdateAt.set(key, 0);
      return this.sendRaw(mk());
    }
    const now = performance.now();
    const wait = UPDATE_MIN_MS - (now - (this.lastUpdateAt.get(key) ?? 0));
    const existing = this.pendingUpdate.get(key);
    if (wait <= 0 && !existing) {
      this.lastUpdateAt.set(key, now);
      return this.sendRaw(mk());
    }
    // coalesce: keep only the latest value
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingUpdate.delete(key);
      this.lastUpdateAt.set(key, performance.now());
      this.sendRaw(mk());
    }, Math.max(1, wait));
    this.pendingUpdate.set(key, { timer });
    return true;
  }
}

export const connection = new Connection();

import type { BridgeState, ErrorCode, SimCommand, SimLinkState, SubscriptionVar } from '@crim/shared';

export interface AdapterStatus {
  bridge: BridgeState;
  sim: SimLinkState;
  detail?: string;
  simApp?: string;
}

export interface AdapterError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

/** raw values by subscription id, in SimConnect units (e.g. percent, bool, hz) */
export type RawValues = Record<string, number | string>;

/**
 * The simulator integration boundary. The server only talks to this interface;
 * SimConnectAdapter (real) and MockAdapter (development only) are interchangeable.
 */
export interface SimAdapter {
  readonly kind: 'simconnect' | 'mock';
  /** true when data is simulated; surfaced to every connected UI */
  readonly mock: boolean;
  start(): void;
  stop(): Promise<void>;
  /** Replace the full set of subscribed variables. Re-applied by the adapter after reconnects. */
  setSubscriptions(vars: SubscriptionVar[]): void;
  /** Fire-and-forget command. Must never throw; failures are reported via onError. */
  send(cmd: SimCommand): void;
  /** Ask the simulator layer to log the Input Events of the loaded aircraft (optional, SimConnect only). */
  enumerateInputEvents?(): void;
  onStatus(cb: (s: AdapterStatus) => void): void;
  onData(cb: (values: RawValues) => void): void;
  onError(cb: (e: AdapterError) => void): void;
  getStatus(): AdapterStatus;
}

export class AdapterEvents {
  private statusCbs: ((s: AdapterStatus) => void)[] = [];
  private dataCbs: ((v: RawValues) => void)[] = [];
  private errorCbs: ((e: AdapterError) => void)[] = [];
  status: AdapterStatus = { bridge: 'stopped', sim: 'disconnected' };

  onStatus(cb: (s: AdapterStatus) => void): void { this.statusCbs.push(cb); }
  onData(cb: (v: RawValues) => void): void { this.dataCbs.push(cb); }
  onError(cb: (e: AdapterError) => void): void { this.errorCbs.push(cb); }

  emitStatus(patch: Partial<AdapterStatus>): void {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const cb of this.statusCbs) cb(next);
  }
  emitData(v: RawValues): void { for (const cb of this.dataCbs) cb(v); }
  emitError(e: AdapterError): void { for (const cb of this.errorCbs) cb(e); }
}

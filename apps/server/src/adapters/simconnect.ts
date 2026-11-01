import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SimCommand, SubscriptionVar } from '@crim/shared';
import type { Logger } from '../logger';
import { AdapterEvents, type AdapterError, type AdapterStatus, type RawValues, type SimAdapter } from './types';

/**
 * Real simulator adapter. The official managed SimConnect wrapper targets .NET Framework 4.6.1 (x64),
 * so the SDK is driven by a separate .NET Framework 4.8 process (apps/simconnect-bridge) that
 * owns all SimConnect calls on a single thread. This class supervises that process and speaks
 * a line-delimited JSON protocol with it over stdin/stdout.
 *
 * Bridge -> server: {t:"conn",state,detail,app} | {t:"data",d:{id:value}} | {t:"err",code,message,detail}
 *                   | {t:"log",level,msg} | {t:"ready",version}
 * Server -> bridge: {t:"subscribe",vars:[..]} | {t:"event",name,data:[..]} | {t:"setvar",var,value}
 *                   | {t:"inputEvent",name,value} | {t:"enumInputEvents"} | {t:"shutdown"}
 */
export class SimConnectAdapter implements SimAdapter {
  readonly kind = 'simconnect' as const;
  readonly mock = false;
  private ev = new AdapterEvents();
  private proc: ChildProcessWithoutNullStreams | null = null;
  private subs: SubscriptionVar[] = [];
  private stopped = true;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartDelay = 2000;

  constructor(private readonly bridgePath: string, private readonly log: Logger) {}

  onStatus(cb: (s: AdapterStatus) => void): void { this.ev.onStatus(cb); }
  onData(cb: (v: RawValues) => void): void { this.ev.onData(cb); }
  onError(cb: (e: AdapterError) => void): void { this.ev.onError(cb); }
  getStatus(): AdapterStatus { return this.ev.status; }

  start(): void {
    this.stopped = false;
    this.spawnBridge();
  }

  private spawnBridge(): void {
    if (this.stopped || this.proc) return;
    if (!existsSync(this.bridgePath)) {
      const detail = `SimConnect bridge not built (${this.bridgePath}). Install the MSFS 2024 SDK and run scripts\\build-bridge.ps1`;
      this.log.error(detail);
      this.ev.emitStatus({ bridge: 'failed', sim: 'disconnected', detail });
      this.scheduleRestart(10_000);
      return;
    }
    this.ev.emitStatus({ bridge: 'starting', sim: 'disconnected', detail: 'Starting SimConnect bridge' });
    const p = spawn(this.bridgePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    createInterface({ input: p.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: p.stderr }).on('line', (line) => this.log.warn(`bridge stderr: ${line}`));
    p.on('error', (e) => {
      this.log.error(`bridge failed to start: ${e.message}`);
      this.ev.emitStatus({ bridge: 'failed', sim: 'disconnected', detail: `Bridge failed to start: ${e.message}` });
    });
    p.on('exit', (code, sig) => {
      this.proc = null;
      this.log.warn(`bridge exited (code=${code}, signal=${sig})`);
      if (this.stopped) return;
      this.ev.emitStatus({ bridge: 'failed', sim: 'disconnected', detail: `Bridge exited (code ${code ?? sig})` });
      this.scheduleRestart(this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 15_000);
    });
    this.sendLine({ t: 'subscribe', vars: this.subs });
  }

  private scheduleRestart(ms: number): void {
    if (this.stopped || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnBridge();
    }, ms);
  }

  private onLine(line: string): void {
    let m: any;
    try { m = JSON.parse(line); } catch { this.log.debug(`bridge: ${line}`); return; }
    switch (m.t) {
      case 'ready':
        this.restartDelay = 2000;
        this.log.info(`bridge ready (${m.version ?? '?'}, SimConnect.dll: ${m.simconnect ?? '?'})`);
        this.ev.emitStatus({ bridge: 'running', detail: 'Waiting for Microsoft Flight Simulator' });
        break;
      case 'conn': {
        const sim = m.state === 'connected' ? 'connected' : m.state === 'connecting' ? 'connecting' : 'disconnected';
        this.log.info(`SimConnect: ${m.state}${m.detail ? ` - ${m.detail}` : ''}`);
        this.ev.emitStatus({ bridge: 'running', sim, detail: m.detail, simApp: m.app });
        break;
      }
      case 'data':
        if (m.d && typeof m.d === 'object') this.ev.emitData(m.d as RawValues);
        break;
      case 'err':
        this.log.warn(`SimConnect error: ${m.message}${m.detail ? ` (${m.detail})` : ''}`);
        this.ev.emitError({ code: 'sdk-error', message: String(m.message ?? 'SimConnect error'), detail: m.detail });
        break;
      case 'inputEvents':
        this.log.info(`Input events (${(m.list ?? []).length}): ${JSON.stringify(m.list)}`);
        break;
      case 'log':
        (this.log[m.level as 'info' | 'warn' | 'error' | 'debug'] ?? this.log.info).call(this.log, `bridge: ${m.msg}`);
        break;
      default:
        this.log.debug(`bridge: unknown message ${line.slice(0, 120)}`);
    }
  }

  private sendLine(obj: unknown): boolean {
    const p = this.proc;
    if (!p || !p.stdin.writable) return false;
    p.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  setSubscriptions(vars: SubscriptionVar[]): void {
    this.subs = vars;
    this.sendLine({ t: 'subscribe', vars });
  }

  send(cmd: SimCommand): void {
    let ok: boolean;
    switch (cmd.kind) {
      case 'event': ok = this.sendLine({ t: 'event', name: cmd.event, data: cmd.data }); break;
      case 'setvar': ok = this.sendLine({ t: 'setvar', var: cmd.var, value: cmd.value }); break;
      case 'inputEvent': ok = this.sendLine({ t: 'inputEvent', name: cmd.name, value: cmd.value }); break;
    }
    if (!ok) this.ev.emitError({ code: 'sim-offline', message: 'SimConnect bridge is not running' });
  }

  enumerateInputEvents(): void {
    this.sendLine({ t: 'enumInputEvents' });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const p = this.proc;
    if (!p) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => { p.kill(); }, 2000);
      p.once('exit', () => { clearTimeout(kill); resolve(); });
      this.sendLine({ t: 'shutdown' });
      try { p.stdin.end(); } catch { /* ignore */ }
    });
    this.ev.emitStatus({ bridge: 'stopped', sim: 'disconnected', detail: undefined, simApp: undefined });
  }
}

import { EventEmitter } from 'node:events';
import {
  CONTROLS, aircraftKey, buildSubscriptions, computeAvailability, computeCaps, convertRaw, flapsMaxIndex,
  identityFromState, isEngineAvailable, planCommand, profileEnabledControls, sanitizeControlValue, selectProfile,
  significantChange, stateKey,
  type AckMessage, type ControlSetMessage, type ErrorMessage, type Profile, type ProfileActiveMessage,
  type SharedSettings, type SimCommand, type SimPatchMessage, type SimStateMessage, type SimStatus, type StateMap,
  type SubscriptionVar,
} from '@crim/shared';
import type { SimAdapter } from '../adapters/types';
import type { Logger } from '../logger';
import { ControlArbiter, type Phase } from './arbiter';
import { CommandScheduler } from './scheduler';

export interface HubOptions {
  adapter: SimAdapter;
  profiles: () => Profile[];
  shared: () => SharedSettings;
  log: Logger;
  stateHz?: number;
  now?: () => number;
  /** settle time before the aircraft profile is re-evaluated after identity SimVars change */
  identitySettleMs?: number;
  /** log the aircraft's Input Events whenever the aircraft/profile changes */
  enumerateInputEvents?: boolean;
}

export interface HubEvents {
  patch: [SimPatchMessage];
  state: [SimStateMessage];
  status: [SimStatus];
  profile: [ProfileActiveMessage];
  error: [ErrorMessage];
}

export interface Session {
  /** stable device id */
  deviceId: string;
  /** unique per websocket connection; sequence numbers are only ordered within a session */
  sessionId: string;
}

/**
 * Authoritative state keeper between the simulator adapter and all devices.
 *  - the simulator is the single source of truth: clients never write state, they send commands,
 *    and every state change comes back from the simulator (or mock) before it is broadcast
 *  - patches are coalesced to at most `stateHz` per second
 *  - control commands are validated, arbitrated, planned and rate limited here
 */
export class SimHub extends EventEmitter<HubEvents> {
  state: StateMap = {};
  rev = 0;
  active: { profile: Profile | null; reason: ProfileActiveMessage['reason']; key: string | null } = { profile: null, reason: 'none', key: null };
  status: SimStatus;

  private pending: StateMap = {};
  private flushTimer: NodeJS.Timeout | null = null;
  private lastFlush = 0;
  private identityTimer: NodeJS.Timeout | null = null;
  private subsJson = '';
  private arbiter: ControlArbiter;
  private scheduler: CommandScheduler;
  private lastSeq = new Map<string, number>();
  private lastSent = new Map<string, number>();
  private readonly now: () => number;
  private readonly flushMs: number;
  private readonly log: Logger;

  constructor(private readonly o: HubOptions) {
    super();
    this.log = o.log;
    this.now = o.now ?? Date.now;
    this.flushMs = Math.round(1000 / (o.stateHz ?? 30));
    this.arbiter = new ControlArbiter(this.now);
    this.scheduler = new CommandScheduler((cmds) => cmds.forEach((c) => this.o.adapter.send(c)), 33, this.now);
    const a = o.adapter;
    this.status = { type: 'sim.status', adapter: a.kind, mock: a.mock, bridge: a.getStatus().bridge, sim: a.getStatus().sim };
  }

  start(): void {
    const a = this.o.adapter;
    a.onStatus((s) => this.onAdapterStatus(s));
    a.onData((v) => this.onAdapterData(v));
    a.onError((e) => this.emit('error', { type: 'error', code: e.code, message: e.message, detail: e.detail }));
    this.applySubscriptions();
    a.start();
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.identityTimer) clearTimeout(this.identityTimer);
    this.scheduler.dispose();
    await this.o.adapter.stop();
  }

  // ---------------------------------------------------------------------
  // simulator -> devices
  // ---------------------------------------------------------------------
  private onAdapterStatus(s: ReturnType<SimAdapter['getStatus']>): void {
    const was = this.status.sim;
    this.status = { type: 'sim.status', adapter: this.o.adapter.kind, mock: this.o.adapter.mock, bridge: s.bridge, sim: s.sim, detail: s.detail, simApp: s.simApp };
    if (was === 'connected' && s.sim !== 'connected') {
      // Never keep presenting stale values as live: forget them, clients show the offline state.
      this.state = {};
      this.pending = {};
      this.lastSent.clear();
      this.rev++;
      this.emit('state', this.stateMessage());
    }
    this.emit('status', this.status);
  }

  private onAdapterData(values: Record<string, number | string>): void {
    let identityChanged = false;
    for (const [id, raw] of Object.entries(values)) {
      const v = convertRaw(id, raw);
      if (v === null || this.state[id] === v) continue;
      this.state[id] = v;
      this.pending[id] = v;
      if (id.startsWith('id.')) identityChanged = true;
    }
    if (Object.keys(this.pending).length) this.scheduleFlush();
    if (identityChanged) this.scheduleReselect();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const wait = Math.max(0, this.lastFlush + this.flushMs - this.now());
    if (wait === 0) return this.flush();
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!Object.keys(this.pending).length) return;
    const data = this.pending;
    this.pending = {};
    this.lastFlush = this.now();
    this.emit('patch', { type: 'sim.patch', rev: ++this.rev, data });
  }

  stateMessage(): SimStateMessage {
    return { type: 'sim.state', rev: this.rev, full: true, data: { ...this.state } };
  }

  profileMessage(): ProfileActiveMessage {
    return {
      type: 'profile.active',
      profile: this.active.profile,
      reason: this.active.reason,
      aircraftKey: this.active.key,
      profiles: this.o.profiles().map((p) => ({ id: p.id, name: p.name })),
    };
  }

  // ---------------------------------------------------------------------
  // aircraft / profile
  // ---------------------------------------------------------------------
  private scheduleReselect(): void {
    if (this.identityTimer) clearTimeout(this.identityTimer);
    const ms = this.o.identitySettleMs ?? 120;
    if (ms <= 0) return this.reselect();
    this.identityTimer = setTimeout(() => { this.identityTimer = null; this.reselect(); }, ms);
  }

  /** Re-run profile selection (aircraft changed, or the user picked another profile). */
  reselect(): void {
    const id = identityFromState(this.state);
    const key = aircraftKey(id);
    if (!key) return;
    const override = this.o.shared().aircraftProfiles[key];
    const sel = selectProfile(id, this.o.profiles(), override);
    if (!sel) return;
    const changed = sel.profile.id !== this.active.profile?.id || sel.reason !== this.active.reason || key !== this.active.key;
    this.active = { profile: sel.profile, reason: sel.reason, key };
    if (changed) {
      this.log.info(`aircraft "${id.title}" -> profile ${sel.profile.id} (${sel.reason})`);
      this.lastSent.clear();
      this.applySubscriptions();
      if (this.o.enumerateInputEvents) this.o.adapter.enumerateInputEvents?.();
      this.emit('profile', this.profileMessage());
    }
  }

  private applySubscriptions(): void {
    const p = this.active.profile;
    const vars: SubscriptionVar[] = p ? buildSubscriptions(profileEnabledControls(p), p.engines) : buildSubscriptions([], 1);
    const json = JSON.stringify(vars);
    if (json === this.subsJson) return;
    this.subsJson = json;
    this.o.adapter.setSubscriptions(vars);
  }

  // ---------------------------------------------------------------------
  // devices -> simulator
  // ---------------------------------------------------------------------
  endSession(s: Session): void {
    this.arbiter.releaseDevice(s.deviceId);
    for (const k of [...this.lastSeq.keys()]) if (k.startsWith(`${s.sessionId}|`)) this.lastSeq.delete(k);
  }

  handleControlSet(s: Session, msg: ControlSetMessage): AckMessage {
    const ack = (status: AckMessage['status'], reason?: string): AckMessage => ({ type: 'ack', sequence: msg.sequence, control: msg.control, status, reason });
    const def = CONTROLS[msg.control];
    const engine = def.perEngine ? (msg.engine ?? 1) : 1;
    const sk = stateKey(msg.control, engine);
    const phase: Phase = msg.phase ?? 'set';

    const profile = this.active.profile;
    const caps = computeCaps(this.state);
    const av = computeAvailability(profile, caps, this.status.sim === 'connected');
    const a = av[msg.control];
    if (!a.enabled) return ack('rejected', a.reason);
    if (def.perEngine && !isEngineAvailable(profile, caps, engine)) return ack('rejected', `Engine ${engine} not available`);

    const seqKey = `${s.sessionId}|${sk}`;
    const prevSeq = this.lastSeq.get(seqKey);
    if (prevSeq !== undefined && msg.sequence <= prevSeq) return ack('stale');
    this.lastSeq.set(seqKey, msg.sequence);

    const owner = this.arbiter.request(sk, s.deviceId, phase);
    if (owner) return ack('busy', 'Controlled by another device');

    const value = sanitizeControlValue(msg.control, msg.value);
    const continuous = def.kind === 'axis' || def.kind === 'bipolar' || def.kind === 'setpoint';
    if (phase === 'begin') this.lastSent.delete(sk);

    // Redundancy: during a drag (including its final value) compare with what we last sent, otherwise with the
    // simulator. The simulator lags behind a fast drag, so judging the release value against its (still old)
    // reading could drop the command that tells it where the finger stopped - and the lever would then
    // creep to an earlier value instead of the released one.
    const stateVal = this.state[sk];
    const sent = this.lastSent.get(sk);
    const ref = (phase === 'update' || phase === 'end') && sent !== undefined ? sent : typeof stateVal === 'number' ? stateVal : undefined;
    let result: ReturnType<typeof ack>;
    if (def.kind !== 'action' && !significantChange(msg.control, ref, value)) {
      if (phase === 'end') this.scheduler.flush(sk);
      result = ack('redundant');
    } else {
      const plan = planCommand({
        control: msg.control,
        engine,
        value,
        state: this.state,
        flapsMax: flapsMaxIndex(profile, caps),
        mapping: profile?.controls[msg.control]?.mapping,
      });
      if (!plan.ok) {
        result = ack('rejected', plan.message);
      } else if (plan.redundant || plan.commands.length === 0) {
        if (phase === 'end') this.scheduler.flush(sk);
        result = ack('redundant');
      } else {
        this.lastSent.set(sk, value);
        this.scheduler.submit(sk, plan.commands, { continuous, immediate: phase === 'end' || phase === 'set' });
        result = ack('ok');
      }
    }
    if (phase === 'end') this.lastSent.delete(sk);
    return result;
  }

  /** for tests/diagnostics */
  ownerOf(control: Parameters<typeof stateKey>[0], engine = 1): string | null {
    return this.arbiter.ownerOf(stateKey(control, engine));
  }

  sendRaw(cmd: SimCommand): void {
    this.o.adapter.send(cmd);
  }
}

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from '@crim/shared';
import { useSim } from './sim';

const profile = BUILTIN_PROFILES.find((p) => p.id === 'generic-ga-fixed-pitch')!;
const status = (sim: 'connected' | 'disconnected') => ({ type: 'sim.status' as const, adapter: 'mock' as const, mock: true, bridge: 'running' as const, sim });
const apply = (m: Parameters<ReturnType<typeof useSim.getState>['apply']>[0]) => useSim.getState().apply(m);

beforeEach(() => {
  useSim.setState(useSim.getInitialState(), true);
});

describe('client simulator store', () => {
  it('adopts the snapshot, applies newer patches and ignores stale ones', () => {
    apply({ type: 'sim.state', rev: 5, full: true, data: { throttle: 0.5 } });
    apply({ type: 'sim.patch', rev: 6, data: { throttle: 0.6 } });
    expect(useSim.getState().values.throttle).toBe(0.6);
    apply({ type: 'sim.patch', rev: 4, data: { throttle: 0.1 } }); // reordered / older than the snapshot
    apply({ type: 'sim.patch', rev: 6, data: { throttle: 0.2 } });
    expect(useSim.getState().values.throttle).toBe(0.6);
  });

  it('a full snapshot replaces old values (reconnect adopts simulator state)', () => {
    apply({ type: 'sim.state', rev: 1, full: true, data: { throttle: 0.9, lightNav: 1 } });
    apply({ type: 'sim.state', rev: 9, full: true, data: { throttle: 0.2 } });
    expect(useSim.getState().values).toEqual({ throttle: 0.2 });
  });

  it('recomputes availability from profile, capabilities and simulator state', () => {
    apply(status('connected'));
    apply({ type: 'profile.active', profile, reason: 'match', aircraftKey: 'c172', profiles: [] });
    apply({ type: 'sim.state', rev: 1, full: true, data: { 'cap.gearRetractable': 0 } });
    const av = useSim.getState().availability;
    expect(av.throttle.enabled).toBe(true);
    expect(av.prop).toEqual({ enabled: false, reason: 'Fixed-pitch propeller' });
    expect(av.gear.enabled).toBe(false);
    apply(status('disconnected'));
    expect(useSim.getState().availability.throttle).toEqual({ enabled: false, reason: 'Simulator not connected' });
  });

  it('a capability change in a patch updates availability', () => {
    apply(status('connected'));
    apply({ type: 'profile.active', profile, reason: 'match', aircraftKey: 'c172', profiles: [] });
    apply({ type: 'sim.state', rev: 1, full: true, data: { 'cap.gearRetractable': 0 } });
    expect(useSim.getState().availability.gear.enabled).toBe(false);
    apply({ type: 'sim.patch', rev: 2, data: { 'cap.gearRetractable': 1 } });
    expect(useSim.getState().availability.gear.enabled).toBe(true);
  });

  it('losing the link forgets simulator data so stale values are never shown as live', () => {
    apply(status('connected'));
    apply({ type: 'sim.state', rev: 1, full: true, data: { throttle: 0.7 } });
    useSim.getState().setLink('closed');
    expect(useSim.getState().values).toEqual({});
    expect(useSim.getState().status).toBeNull();
  });

  it('an unauthorized error requires re-pairing', () => {
    apply({ type: 'error', code: 'unauthorized', message: 'invalid pairing token' });
    expect(useSim.getState().link).toBe('unauthorized');
  });
});

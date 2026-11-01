import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { CONTROLS, isEngineAvailable, stateKey, type ControlId, type ControlSetting } from '@crim/shared';
import { connection, type Phase } from '../services/connection';
import { onAck, useSim } from '../stores/sim';
import { armDrag, armRelease, decideHold, type Hold } from './hold';

/**
 * Local "hold" of a control the user is manipulating. While a hold exists the UI shows the local value
 * and ignores simulator feedback for that control, so the handle never fights the finger. After release
 * the hold persists while the simulator is still catching up (see hold.ts) and ends when it agrees or
 * stalls; after that the display follows the simulator again, so a rejected command still shows reality.
 */
const useHold = create<{ holds: Record<string, Hold>; put(k: string, h: Hold | null): void }>((set) => ({
  holds: {},
  put: (k, h) => set((s) => {
    const holds = { ...s.holds };
    if (h) holds[k] = h; else delete holds[k];
    return { holds };
  }),
}));

const tolerance = (control: ControlId): number => {
  const k = CONTROLS[control].kind;
  return k === 'axis' || k === 'bipolar' ? 0.012 : 0;
};

const NO_SETTINGS: ControlSetting = {};

export interface ControlBinding {
  /** value to display: local while interacting/settling, simulator otherwise */
  value: number | undefined;
  simValue: number | undefined;
  enabled: boolean;
  reason?: string;
  dragging: boolean;
  settings: ControlSetting;
  begin(v: number): void;
  update(v: number): void;
  end(v: number): void;
  set(v: number): void;
}

export function useControl(control: ControlId, engine = 1): ControlBinding {
  const key = stateKey(control, engine);
  const simValue = useSim((s) => s.values[key]) as number | undefined;
  const avail = useSim((s) => s.availability[control]);
  const engineOk = useSim((s) => !CONTROLS[control].perEngine || isEngineAvailable(s.profile, s.caps, engine));
  const profileId = useSim((s) => s.profile?.id);
  const settings = useSim((s) => (profileId ? s.shared.controlSettings[profileId]?.[control] : undefined)) ?? NO_SETTINGS;
  const hold = useHold((s) => s.holds[key]);
  const put = useHold.getState().put;

  // settle: drop the hold once the simulator agrees or stops making progress towards the released value
  useEffect(() => {
    if (!hold) return;
    const d = decideHold(hold, simValue, Date.now(), tolerance(control));
    if (d.action === 'drop') { put(key, null); return; }
    if (d.action === 'extend') { put(key, d.hold); return; }
    if (d.action === 'wait') {
      const t = setTimeout(() => put(key, null), d.ms);
      return () => clearTimeout(t);
    }
  }, [hold, simValue, control, key, put]);

  // the server refused (busy / unsupported / stale): stop pretending
  useEffect(
    () => onAck((a) => {
      if (a.control === control && (a.status === 'rejected' || a.status === 'busy')) put(key, null);
    }),
    [control, key, put],
  );

  // losing the connection while holding must not leave a phantom value
  const live = useSim((s) => s.link === 'open');
  useEffect(() => { if (!live) put(key, null); }, [live, key, put]);

  const enabled = avail.enabled && engineOk;
  const send = useCallback((v: number, phase: Phase) => {
    if (!connection.sendControl(control, v, { engine, phase })) put(key, null);
  }, [control, engine, key, put]);

  return useMemo<ControlBinding>(() => ({
    value: hold ? hold.value : simValue,
    simValue,
    enabled,
    reason: !engineOk ? `Engine ${engine} not available` : avail.reason,
    dragging: !!hold?.dragging,
    settings,
    begin: (v) => { put(key, armDrag(v, Date.now())); send(v, 'begin'); },
    update: (v) => { put(key, armDrag(v, Date.now())); send(v, 'update'); },
    end: (v) => { put(key, armRelease(v, simValue, Date.now())); send(v, 'end'); },
    set: (v) => { put(key, armRelease(v, simValue, Date.now())); send(v, 'set'); },
  }), [hold, simValue, enabled, engineOk, engine, avail.reason, settings, key, put, send]);
}

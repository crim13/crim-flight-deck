import { useState } from 'react';
import { CONTROLS, PHONE_PAGE_IDS, type ControlId, type DeviceMode } from '@crim/shared';
import { connection } from '../services/connection';
import { saveDevice, saveShared } from '../services/settings';
import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';
import { FUEL_UNITS } from '../telemetry';

const TUNABLE: ControlId[] = ['throttle', 'prop', 'mixture', 'trim', 'flaps', 'spoilers', 'apHeadingSel', 'apAltitudeSel', 'apVsSel'];
const PAGE_NAMES: Record<string, string> = { autopilot: 'AP', radios: 'RADIOS', systems: 'SYSTEMS', quick: 'QUICK' };

function Seg<T extends string>({ value, options, onPick }: { value: T; options: { v: T; label: string }[]; onPick(v: T): void }) {
  return (
    <div className="segs">
      {options.map((o) => (
        <button key={o.v} type="button" className={`ctl${o.v === value ? ' on' : ''}`} onPointerDown={(e) => { e.preventDefault(); onPick(o.v); }}>{o.label}</button>
      ))}
    </div>
  );
}

export function SettingsSheet() {
  const close = () => useUi.getState().setSettingsOpen(false);
  const sim = useSim();
  const ui = useUi();
  const [name, setName] = useState(sim.device.deviceName ?? '');
  const profile = sim.profile;
  const override = sim.aircraftKey ? sim.shared.aircraftProfiles[sim.aircraftKey] : undefined;

  const setCtl = (c: ControlId, patch: { invert?: boolean; sensitivity?: number; hidden?: boolean }) => {
    if (!profile) return;
    saveShared((s) => ({
      ...s,
      controlSettings: { ...s.controlSettings, [profile.id]: { ...s.controlSettings[profile.id], [c]: { ...s.controlSettings[profile.id]?.[c], ...patch } } },
    }));
  };

  const pickMode = (m: DeviceMode) => {
    ui.setModeSetting(m);
    saveDevice((d) => ({ ...d, mode: m }), 50);
  };

  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="sheet-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet scroll">
        <div className="sheet-head">
          <span className="lbl">SETTINGS</span>
          <button type="button" className="ctl x" onPointerDown={(e) => { e.preventDefault(); close(); }}>✕</button>
        </div>

        <h4>This device</h4>
        <div className="row"><span>Name</span>
          <input className="field" value={name} maxLength={40} placeholder="Tablet / Phone"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { connection.deviceName = name || undefined; saveDevice((d) => ({ ...d, deviceName: name || undefined }), 50); connection.send({ type: 'device.update', deviceName: name || undefined }); }} />
        </div>
        <div className="row"><span>Layout mode</span>
          <Seg value={ui.modeSetting} options={[{ v: 'auto', label: 'AUTO' }, { v: 'tablet', label: 'TABLET' }, { v: 'phone', label: 'PHONE' }]} onPick={pickMode} />
        </div>
        <div className="row"><span>Start page (phone)</span>
          <Seg value={sim.device.startPage ?? sim.shared.preferredStartPage}
            options={PHONE_PAGE_IDS.map((p) => ({ v: p, label: PAGE_NAMES[p]! }))}
            onPick={(p) => saveDevice((d) => ({ ...d, startPage: p }), 50)} />
        </div>
        <div className="row"><span>Top bar (flight data)</span>
          <Seg value={ui.topBar ? 'on' : 'off'} options={[{ v: 'on', label: 'ON' }, { v: 'off', label: 'OFF' }]} onPick={(v) => ui.setTopBar(v === 'on')} />
        </div>
        <div className="row"><span>Fuel unit</span>
          <Seg value={ui.fuelUnit} options={FUEL_UNITS.map((u) => ({ v: u, label: u.toUpperCase() }))} onPick={ui.setFuelUnit} />
        </div>
        <div className="row"><span>Attitude: flip pitch</span>
          <Seg value={ui.flipPitch ? 'on' : 'off'} options={[{ v: 'off', label: 'AUTO' }, { v: 'on', label: 'FLIPPED' }]} onPick={(v) => ui.setFlip('pitch', v === 'on')} />
        </div>
        <div className="row"><span>Attitude: flip bank</span>
          <Seg value={ui.flipBank ? 'on' : 'off'} options={[{ v: 'off', label: 'AUTO' }, { v: 'on', label: 'FLIPPED' }]} onPick={(v) => ui.setFlip('bank', v === 'on')} />
        </div>
        <p className="note">If the horizon tilts or pitches the wrong way in the simulator, flip that axis (the SimVar sign is not documented).</p>
        <div className="row"><span>Layout</span>
          <div className="segs">
            <button type="button" className="ctl" onPointerDown={(e) => { e.preventDefault(); close(); ui.setEdit(true); }}>EDIT LAYOUT</button>
            <button type="button" className="ctl" onPointerDown={(e) => { e.preventDefault(); fullscreen(); }}>FULLSCREEN</button>
          </div>
        </div>

        <h4>Aircraft</h4>
        <div className="row"><span>Detected</span><b>{sim.values['id.title'] ? String(sim.values['id.title']) : '—'}</b></div>
        <div className="row"><span>Profile</span><b>{profile?.name ?? '—'}{profile && ` (${sim.profileReason})`}</b></div>
        {sim.aircraftKey && (
          <div className="chips">
            <button type="button" className={`ctl${!override ? ' on' : ''}`} onPointerDown={(e) => { e.preventDefault(); connection.send({ type: 'profile.select', aircraftKey: sim.aircraftKey!, profileId: null }); }}>AUTO</button>
            {sim.profiles.map((p) => (
              <button key={p.id} type="button" className={`ctl${override === p.id ? ' on' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); connection.send({ type: 'profile.select', aircraftKey: sim.aircraftKey!, profileId: p.id }); }}>{p.name}</button>
            ))}
          </div>
        )}
        {profile?.verification && <p className="note">Mapping verification: {profile.verification.status === 'live' ? 'tested live in MSFS' : 'documented SDK names, not yet tested live'}</p>}

        {profile && (
          <>
            <h4>Control tuning ({profile.name})</h4>
            {TUNABLE.filter((c) => profile.controls[c]?.enabled).map((c) => {
              const s = sim.shared.controlSettings[profile.id]?.[c] ?? {};
              const sens = s.sensitivity ?? 1;
              return (
                <div className="row" key={c}>
                  <span>{CONTROLS[c].label}</span>
                  <div className="segs">
                    <button type="button" className={`ctl${s.invert ? ' on' : ''}`} onPointerDown={(e) => { e.preventDefault(); setCtl(c, { invert: !s.invert }); }}>INVERT</button>
                    <button type="button" className="ctl" onPointerDown={(e) => { e.preventDefault(); setCtl(c, { sensitivity: Math.max(0.25, +(sens - 0.25).toFixed(2)) }); }}>−</button>
                    <span className="val">{sens.toFixed(2)}×</span>
                    <button type="button" className="ctl" onPointerDown={(e) => { e.preventDefault(); setCtl(c, { sensitivity: Math.min(2, +(sens + 0.25).toFixed(2)) }); }}>+</button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        <h4>Connection</h4>
        <div className="row"><span>Link to PC</span><b>{sim.link}</b></div>
        <div className="row"><span>Simulator</span><b>{sim.status ? `${sim.status.mock ? 'MOCK ' : ''}${sim.status.sim}` : '—'}</b></div>
        {sim.status?.detail && <div className="row"><span>Detail</span><b>{sim.status.detail}</b></div>}
        <div className="row"><span>Bridge</span><b>{sim.status?.bridge ?? '—'} ({sim.status?.adapter ?? '—'})</b></div>
        <div className="row"><span>Server</span><b>{sim.serverVersion ?? '—'}</b></div>
        {sim.lanUrls.map((u) => <div className="row" key={u}><span>Address</span><b>{u}</b></div>)}
        <div className="row"><span>Devices</span><b>{sim.devices.map((d) => `${d.name} (${d.role})`).join(', ') || '—'}</b></div>
        <div className="row"><span>Pairing</span>
          <button type="button" className="ctl" onPointerDown={(e) => { e.preventDefault(); if (confirm('Forget the pairing token on this device?')) { close(); connection.reset(); } }}>FORGET</button>
        </div>
      </div>
    </div>
  );
}

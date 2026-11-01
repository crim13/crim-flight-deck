import { memo, useRef } from 'react';
import { CONTROLS, hzToMhzString, stepFrequency, type ControlId } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { DualKnob } from './Knob';
import { clamp } from './math';
import type { WidgetProps } from './types';

type RadioId = 'com1' | 'com2' | 'nav1' | 'nav2';
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** COM / NAV radio: active + standby frequency, swap, and a dual knob (outer = MHz, inner = kHz). */
export const RadioPanel = memo(function RadioPanel({ item }: WidgetProps) {
  const radio = String(item.options?.radio ?? 'com1') as RadioId;
  const kind = radio.startsWith('com') ? 'com' : 'nav';
  const active = useControl(`${radio}Active` as ControlId);
  const standby = useControl(`${radio}Standby` as ControlId);
  const swap = useControl(`swap${cap(radio)}` as ControlId);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const local = useRef(0);
  const knob = clamp(Math.min(h - 26, w * 0.22), 44, 130);
  const enabled = standby.enabled;

  return (
    <div ref={ref} className={`widget radio${enabled ? '' : ' disabled'}`}>
      <div className="radio-label lbl sm">{CONTROLS[`${radio}Active` as ControlId].label}</div>
      <div className="freq-box active">
        <span className="tag">ACT</span>
        <span className="lcd big">{active.value === undefined ? '---.---' : hzToMhzString(active.value)}</span>
      </div>
      <button
        type="button"
        className={`swap ctl${swap.enabled ? '' : ' disabled'}`}
        aria-label={`swap ${radio}`}
        onPointerDown={(e) => { e.preventDefault(); if (swap.enabled) swap.set(1); }}
      >
        ⇄
      </button>
      <div className="freq-box standby">
        <span className="tag">STBY</span>
        <span className="lcd big">{standby.value === undefined ? '---.---' : hzToMhzString(standby.value)}</span>
      </div>
      {w > 0 && (
        <DualKnob
          size={knob}
          disabled={!enabled}
          outerDeg={30}
          innerDeg={30}
          onGrab={() => { local.current = standby.value ?? CONTROLS[`${radio}Standby` as ControlId].min; standby.begin(local.current); }}
          onSteps={(zone, steps) => {
            local.current = stepFrequency(local.current, kind, steps, zone === 'outer');
            standby.update(local.current);
          }}
          onRelease={() => standby.end(local.current)}
        />
      )}
    </div>
  );
});

const MODES: { value: number; label: string }[] = [
  { value: 0, label: 'OFF' }, { value: 1, label: 'STBY' }, { value: 3, label: 'ON' }, { value: 4, label: 'ALT' },
];

/** Transponder: 4 octal digit drums (tap above/below), mode selector and IDENT. */
export const XpndrPanel = memo(function XpndrPanel(_: WidgetProps) {
  const code = useControl('xpndrCode');
  const mode = useControl('xpndrMode');
  const ident = useControl('xpndrIdent');
  const reason = useSim((s) => s.availability.xpndrCode.reason);
  const digits = String(Math.max(0, Math.min(7777, code.value ?? 0))).padStart(4, '0').split('').map(Number);
  const known = code.value !== undefined;

  const bump = (i: number, dir: 1 | -1) => {
    if (!code.enabled) return;
    const next = digits.slice();
    next[i] = (next[i]! + dir + 8) % 8;
    code.set(Number(next.join('')));
  };

  return (
    <div className={`widget xpndr${code.enabled ? '' : ' disabled'}`} title={code.enabled ? undefined : reason}>
      <div className="radio-label lbl sm">XPDR</div>
      <div className="drums">
        {digits.map((d, i) => (
          <div className="drum" key={i}>
            <button type="button" className="ctl arrow" aria-label="digit up" onPointerDown={(e) => { e.preventDefault(); bump(i, 1); }}>▲</button>
            <span className="lcd big">{known ? d : '-'}</span>
            <button type="button" className="ctl arrow" aria-label="digit down" onPointerDown={(e) => { e.preventDefault(); bump(i, -1); }}>▼</button>
          </div>
        ))}
      </div>
      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`ctl seg${mode.value === m.value ? ' on' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); if (mode.enabled) mode.set(m.value); }}
          >
            {m.label}
          </button>
        ))}
        <button type="button" className="ctl seg ident" onPointerDown={(e) => { e.preventDefault(); if (ident.enabled) ident.set(1); }}>IDENT</button>
      </div>
    </div>
  );
});

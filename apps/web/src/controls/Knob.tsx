import { memo, useId, useRef, useState } from 'react';
import { CONTROLS, type ControlId } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { StepAccumulator, angleDelta, applyStep, clamp } from './math';
import { svgId, type WidgetProps } from './types';

export type Zone = 'outer' | 'inner';

interface KnobProps {
  size: number;
  /** degrees of rotation per detent for the outer (coarse) ring and the inner (fine) cap */
  outerDeg?: number;
  innerDeg?: number;
  disabled?: boolean;
  onGrab?(zone: Zone): void;
  onSteps(zone: Zone, steps: number): void;
  onRelease?(): void;
}

/** Dual concentric rotary knob (like a real AP / radio knob): outer ring = coarse, inner cap = fine. */
export function DualKnob({ size, outerDeg = 10, innerDeg = 8, disabled, onGrab, onSteps, onRelease }: KnobProps) {
  const id = svgId(useId());
  const [rot, setRot] = useState({ outer: 0, inner: 0 });
  const st = useRef<{ zone: Zone; last: number; acc: StepAccumulator } | null>(null);
  const acc = useRef({ outer: new StepAccumulator(outerDeg), inner: new StepAccumulator(innerDeg) });
  const R = size / 2;

  const angleOf = (x: number, y: number, rect: DOMRect) => (Math.atan2(y - (rect.top + rect.height / 2), x - (rect.left + rect.width / 2)) * 180) / Math.PI;

  const gesture = usePointerGesture({
    onStart: ({ x, y, rect }) => {
      if (disabled) return false;
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      const zone: Zone = Math.hypot(dx, dy) < R * 0.5 ? 'inner' : 'outer';
      const a = acc.current[zone];
      a.reset();
      st.current = { zone, last: angleOf(x, y, rect), acc: a };
      onGrab?.(zone);
      return true;
    },
    onMove: ({ x, y, rect }) => {
      const s = st.current;
      if (!s) return;
      const ang = angleOf(x, y, rect);
      const d = angleDelta(s.last, ang);
      s.last = ang;
      setRot((r) => ({ ...r, [s.zone]: r[s.zone] + d }));
      const steps = s.acc.add(d);
      if (steps !== 0) onSteps(s.zone, steps);
    },
    onEnd: () => {
      st.current = null;
      onRelease?.();
    },
  });

  const teeth: JSX.Element[] = [];
  for (let i = 0; i < 36; i++) {
    const a = ((i * 10 + rot.outer) * Math.PI) / 180;
    teeth.push(<line key={i} x1={R + Math.cos(a) * R * 0.86} y1={R + Math.sin(a) * R * 0.86} x2={R + Math.cos(a) * R * 0.97} y2={R + Math.sin(a) * R * 0.97} stroke="#050505" strokeWidth={2.2} strokeLinecap="round" />);
  }
  const ia = ((rot.inner - 90) * Math.PI) / 180;
  const oa = ((rot.outer - 90) * Math.PI) / 180;

  return (
    <div className={`knob ctl${disabled ? ' disabled' : ''}`} style={{ width: size, height: size }} {...gesture}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id={`${id}-o`} cx=".4" cy=".3" r=".9"><stop offset="0" stopColor="#5a5f67" /><stop offset=".6" stopColor="#2b2e33" /><stop offset="1" stopColor="#101214" /></radialGradient>
          <radialGradient id={`${id}-i`} cx=".4" cy=".3" r=".9"><stop offset="0" stopColor="#c9ced5" /><stop offset=".55" stopColor="#80868f" /><stop offset="1" stopColor="#30343a" /></radialGradient>
        </defs>
        <circle cx={R} cy={R} r={R - 1} fill="#050607" stroke="#000" />
        <circle cx={R} cy={R} r={R * 0.95} fill={`url(#${id}-o)`} stroke="#000" />
        {teeth}
        <circle cx={R + Math.cos(oa) * R * 0.74} cy={R + Math.sin(oa) * R * 0.74} r={R * 0.05} fill="#ff8a1f" />
        <circle cx={R} cy={R} r={R * 0.5} fill={`url(#${id}-i)`} stroke="#0a0a0b" strokeWidth={1.5} />
        <circle cx={R} cy={R} r={R * 0.4} fill="none" stroke="rgba(0,0,0,0.25)" />
        <line x1={R} y1={R} x2={R + Math.cos(ia) * R * 0.44} y2={R + Math.sin(ia) * R * 0.44} stroke="#ff8a1f" strokeWidth={3} strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface EncoderCfg { fine: number; coarse: number; wrap: boolean }
const ENCODER: Partial<Record<ControlId, EncoderCfg>> = {
  apHeadingSel: { fine: 1, coarse: 10, wrap: true },
  apAltitudeSel: { fine: 100, coarse: 1000, wrap: false },
  apVsSel: { fine: 100, coarse: 500, wrap: false },
};

export function formatSetpoint(control: ControlId, v: number | undefined): string {
  if (v === undefined) return '---';
  switch (control) {
    case 'apHeadingSel': return String(Math.round(v)).padStart(3, '0');
    case 'apAltitudeSel': return String(Math.round(v)).padStart(5, ' ');
    case 'apVsSel': return `${v > 0 ? '+' : v < 0 ? '-' : ' '}${String(Math.abs(Math.round(v))).padStart(4, ' ')}`;
    default: return String(v);
  }
}
const UNITS: Partial<Record<ControlId, string>> = { apHeadingSel: 'DEG', apAltitudeSel: 'FT', apVsSel: 'FPM' };

/** Autopilot setpoint encoder: heading / altitude / vertical speed. */
export const Encoder = memo(function Encoder({ item }: WidgetProps) {
  const control = item.control as ControlId;
  const cfg = ENCODER[control] ?? { fine: CONTROLS[control].step ?? 1, coarse: (CONTROLS[control].step ?? 1) * 10, wrap: false };
  const def = CONTROLS[control];
  const b = useControl(control);
  const custom = useSim((s) => s.profile?.labels?.[control]);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const local = useRef(0);
  const dir = b.settings.invert ? -1 : 1;
  const sens = b.settings.sensitivity ?? 1;
  void sens;

  const size = Math.max(40, Math.min(w - 8, h - 74));

  return (
    <div ref={ref} className={`widget encoder${b.enabled ? '' : ' disabled'}`}>
      <div className="enc-head">
        <span className="lbl sm">{custom ?? def.label}</span>
        <span className="lcd">{formatSetpoint(control, b.value)}<small>{UNITS[control]}</small></span>
      </div>
      <div className="enc-body">
        {w > 0 && (
          <DualKnob
            size={size}
            disabled={!b.enabled}
            onGrab={() => { local.current = b.value ?? def.min; b.begin(local.current); }}
            onSteps={(zone, steps) => {
              const step = zone === 'outer' ? cfg.coarse : cfg.fine;
              local.current = applyStep(local.current, steps * dir, step, def.min, def.max, cfg.wrap);
              b.update(local.current);
            }}
            onRelease={() => b.end(local.current)}
          />
        )}
      </div>
    </div>
  );
});

export { clamp };

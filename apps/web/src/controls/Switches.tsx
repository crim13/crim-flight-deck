import { memo, useId, useState } from 'react';
import { CONTROLS, type ControlId } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { clamp, fitFont } from './math';
import { svgId, type WidgetProps } from './types';

const labelOf = (control: ControlId, custom?: string) => custom ?? CONTROLS[control].label;

/** Aviation toggle switch: metal lever in a bezel, LED shows the switch state reported by the simulator. */
export const Toggle = memo(function Toggle({ item }: WidgetProps) {
  const control = item.control as ControlId;
  const b = useControl(control, item.engine ?? 1);
  const custom = useSim((s) => s.profile?.labels?.[control]);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const known = b.value !== undefined;
  const on = (b.value ?? 0) >= 0.5;

  const gesture = usePointerGesture({
    onStart: () => b.enabled,
    onMove: () => {},
    onEnd: ({ y, rect, moved, cancelled }) => {
      if (cancelled) return;
      const dy = y - (rect.top + rect.height / 2);
      b.set(moved > 14 ? (dy < 0 ? 1 : 0) : on ? 0 : 1);
    },
  });

  const cx = w / 2;
  const r = clamp(Math.min(w * 0.3, h * 0.2), 14, 34);
  const cy = h * 0.52;
  // lever points UP when on, DOWN when off (slightly canted for depth); centred while the state is unknown
  const ang = !known ? 90 : on ? -8 : 172;
  const len = r * 1.9;
  const showReason = !b.enabled && b.reason && b.reason !== 'Simulator not connected';

  return (
    <div ref={ref} className={`widget ctl toggle${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <linearGradient id={`${id}-m`} x1="0" x2="1"><stop offset="0" stopColor="#40454c" /><stop offset=".5" stopColor="#d3d8de" /><stop offset="1" stopColor="#40454c" /></linearGradient>
            <radialGradient id={`${id}-b`} cx=".4" cy=".35" r=".9"><stop offset="0" stopColor="#7b8089" /><stop offset="1" stopColor="#202327" /></radialGradient>
          </defs>
          <text x={cx} y={Math.max(16, h * 0.15)} className="lbl sm" textAnchor="middle" style={{ fontSize: fitFont(labelOf(control, custom), w), letterSpacing: '0.08em' }}>{labelOf(control, custom)}</text>
          <circle cx={cx} cy={cy} r={r + 6} fill="#0a0b0c" stroke="#000" strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-b)`} stroke="#000" />
          <circle cx={cx} cy={cy} r={r * 0.45} fill="#050505" />
          <g opacity={b.enabled ? 1 : 0.45} style={{ transform: `rotate(${ang}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
            <rect x={cx - 5} y={cy - len} width={10} height={len} rx={5} fill={`url(#${id}-m)`} stroke="#0a0a0b" />
            <circle cx={cx} cy={cy - len} r={7} fill={`url(#${id}-m)`} stroke="#0a0a0b" />
          </g>
          <circle cx={cx} cy={h - Math.max(10, h * 0.1)} r={4.5} fill={on && known ? '#ffb347' : '#2a2d31'} stroke="#000" />
          {showReason && <text x={cx} y={h - 2} className="cap reason" textAnchor="middle">{b.reason}</text>}
        </svg>
      )}
    </div>
  );
});

/**
 * Annunciator push button. For switch controls the lamp shows the simulator state and a tap toggles it;
 * for action controls (swap, ident) it is momentary.
 */
export const PushButton = memo(function PushButton({ item }: WidgetProps) {
  const control = item.control as ControlId;
  const def = CONTROLS[control];
  const b = useControl(control, item.engine ?? 1);
  const custom = useSim((s) => s.profile?.labels?.[control]);
  const [pressed, setPressed] = useState(false);
  const on = (b.value ?? 0) >= 0.5 && def.kind !== 'action';
  const color = item.options?.color === 'green' || def.group === 'autopilot' ? 'green' : 'amber';

  const gesture = usePointerGesture({
    onStart: () => {
      if (!b.enabled) return false;
      setPressed(true);
      if (def.kind === 'action') b.set(1);
      return true;
    },
    onMove: () => {},
    onEnd: ({ cancelled }) => {
      setPressed(false);
      if (!cancelled && def.kind !== 'action') b.set(on ? 0 : 1);
    },
  });

  return (
    <div className={`widget ctl push${b.enabled ? '' : ' disabled'}${pressed ? ' pressed' : ''}${on ? ` on ${color}` : ''}`} {...gesture}>
      <div className="cap-face">
        <span className="lamp" />
        <span className="txt">{labelOf(control, custom)}</span>
      </div>
    </div>
  );
});

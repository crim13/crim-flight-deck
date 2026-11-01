import { memo, useId } from 'react';
import { gearIndication } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { clamp, fitFont } from './math';
import { svgId, type WidgetProps } from './types';

/**
 * Landing gear lever. The lever shows the COMMANDED handle position; the lamp shows the ACTUAL gear
 * (green = down & locked, red = in transit, dark = up). Disabled for fixed gear.
 */
export const GearLever = memo(function GearLever(_: WidgetProps) {
  const b = useControl('gear');
  const actual = useSim((s) => s.values.gearActual) as number | undefined;
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const down = (b.value ?? 1) >= 0.5;
  const ind = gearIndication(actual);
  const fixed = !b.enabled && b.reason === 'Not equipped on this aircraft';

  const gesture = usePointerGesture({
    onStart: () => b.enabled,
    onMove: () => {},
    onEnd: ({ y, rect, moved, cancelled }) => {
      if (cancelled) return;
      // tap = toggle; drag = go to the end the finger finished at
      const want = moved > 14 ? (y - rect.top > rect.height / 2 ? 1 : 0) : down ? 0 : 1;
      b.set(want);
    },
  });

  const cx = w * 0.6;
  const top = clamp(h * 0.2, 56, 90);
  const bot = h - clamp(h * 0.2, 56, 90);
  const yH = down ? bot : top;
  const lamp = ind === 'down' ? '#35d46a' : ind === 'transit' ? '#ff3b30' : '#2a2d31';

  return (
    <div ref={ref} className={`widget ctl gear${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <radialGradient id={`${id}-k`} cx=".4" cy=".35" r=".8"><stop offset="0" stopColor="#d5d9de" /><stop offset=".5" stopColor="#7a8089" /><stop offset="1" stopColor="#2a2d31" /></radialGradient>
            <radialGradient id={`${id}-t`} cx=".5" cy=".5" r=".6"><stop offset=".7" stopColor="#0a0a0a" /><stop offset="1" stopColor="#262626" /></radialGradient>
          </defs>
          <text x={w / 2} y={24} className="lbl" textAnchor="middle">GEAR</text>
          <rect x={cx - 9} y={top - 20} width={18} height={bot - top + 40} rx={9} fill="#08090a" stroke="#000" strokeWidth={1.5} />
          <text x={cx - 20} y={top + 4} className="cap" textAnchor="end">UP</text>
          <text x={cx - 20} y={bot + 4} className="cap" textAnchor="end">DN</text>
          <g opacity={b.enabled ? 1 : 0.45}>
            <rect x={cx - 6} y={Math.min(yH, top) - 4} width={12} height={Math.abs(yH - top) + 8} rx={3} fill="#6a7079" />
            <circle cx={cx} cy={yH} r={Math.min(30, w * 0.17)} fill={`url(#${id}-t)`} stroke="#000" strokeWidth={1.5} />
            <circle cx={cx} cy={yH} r={Math.min(30, w * 0.17) * 0.62} fill={`url(#${id}-k)`} stroke="#111" />
            <circle cx={cx} cy={yH} r={3} fill="#ff8a1f" />
          </g>
          {!fixed && <circle cx={Math.max(14, cx - 36)} cy={h / 2} r={8} fill={lamp} stroke="#000" strokeWidth={1.5} />}
          {fixed && <text x={w / 2} y={h / 2} className="cap reason" textAnchor="middle">FIXED</text>}
        </svg>
      )}
    </div>
  );
});

/** Parking brake: push/pull T-handle. Pulled out = brake set (red band visible, lamp lit). */
export const ParkBrake = memo(function ParkBrake(_: WidgetProps) {
  const b = useControl('parkingBrake');
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const set = (b.value ?? 0) >= 0.5;

  const gesture = usePointerGesture({
    onStart: () => b.enabled,
    onMove: () => {},
    onEnd: ({ y, rect, moved, cancelled }) => {
      if (cancelled) return;
      const dy = y - rect.top;
      b.set(moved > 16 ? (dy > rect.height * 0.5 ? 1 : 0) : set ? 0 : 1);
    },
  });

  const cx = w * 0.5;
  const plateY = clamp(h * 0.24, 46, 80);
  const shaft = set ? clamp(h * 0.38, 40, 90) : 8;
  const tY = plateY + 14 + shaft;

  return (
    <div ref={ref} className={`widget ctl brake${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <linearGradient id={`${id}-m`} x1="0" x2="1"><stop offset="0" stopColor="#30343a" /><stop offset=".5" stopColor="#a7adb5" /><stop offset="1" stopColor="#30343a" /></linearGradient>
            <linearGradient id={`${id}-r`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ff7b6b" /><stop offset=".5" stopColor="#d23a2e" /><stop offset="1" stopColor="#6d1109" /></linearGradient>
          </defs>
          <text x={w / 2} y={24} className="lbl" textAnchor="middle" style={{ fontSize: fitFont('PARK BRAKE', w, 15), letterSpacing: '0.1em' }}>PARK BRAKE</text>
          <rect x={cx - 34} y={plateY - 8} width={68} height={22} rx={5} fill="#23262a" stroke="#000" strokeWidth={1.5} />
          <circle cx={cx} cy={plateY + 3} r={9} fill="#050505" />
          <rect x={cx - 5} y={plateY + 3} width={10} height={shaft + 14} fill={`url(#${id}-m)`} />
          {set && [0, 1, 2, 3, 4].map((i) => <rect key={i} x={cx - 5} y={plateY + 14 + i * 5} width={10} height={2.5} fill={i % 2 ? '#f2f2f2' : '#d23a2e'} />)}
          <g opacity={b.enabled ? 1 : 0.45}>
            <rect x={cx - 36} y={tY - 2} width={72} height={26} rx={13} fill={`url(#${id}-r)`} stroke="#2a0805" strokeWidth={1.5} />
            <rect x={cx - 26} y={tY + 2} width={52} height={5} rx={2.5} fill="rgba(255,255,255,0.2)" />
          </g>
          <circle cx={cx} cy={h - 22} r={7} fill={set ? '#ff3b30' : '#2a2d31'} stroke="#000" strokeWidth={1.5} />
        </svg>
      )}
    </div>
  );
});

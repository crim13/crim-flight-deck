import { memo, useId, useRef } from 'react';
import { useControl } from '../hooks/useControl';
import { useEased } from '../hooks/useEased';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { TrimDrag, clamp, signedTrim } from './math';
import { svgId, type WidgetProps } from './types';

/**
 * Elevator trim: a partially exposed textured wheel. Finger movement rotates it relatively
 * (never an absolute position), with neutral marker and nose up / nose down markings.
 */
export const TrimWheel = memo(function TrimWheel(_: WidgetProps) {
  const b = useControl('trim');
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const drag = useRef<TrimDrag | null>(null);
  const invert = !!b.settings.invert;
  const sens = b.settings.sensitivity ?? 1;
  const sign = invert ? -1 : 1;

  const gesture = usePointerGesture({
    onStart: ({ y }) => {
      if (!b.enabled) return false;
      const cur = b.value ?? 0;
      drag.current = new TrimDrag(cur * sign, y);
      b.begin(cur);
      return true;
    },
    onMove: ({ x, y, startX }) => {
      const d = drag.current;
      if (!d) return;
      b.update(d.move(y, x, startX, sens) * sign);
    },
    onEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (d) b.end(d.value * sign);
    },
  });

  const v = b.value ?? 0;
  // the wheel glides when the simulator (not the finger) changes the trim, so a late correction is not a jump
  const vShown = useEased(b.value, b.dragging) ?? 0;
  // header (name, big value, NOSE UP) on top, NOSE DN below: values stay visible above the hand
  const top = 100;
  const bottom = h - 44;
  const cy = (top + bottom) / 2;
  const R = Math.max(50, (bottom - top) / 2 - 10);
  const wheelW = Math.max(30, w - 46);
  // ridge phase follows the trim value itself, so finger, simulator and corrections all turn the wheel consistently
  const phase = (vShown * sign * 540) % 360;
  const ridges: JSX.Element[] = [];
  const step = 11;
  for (let i = -40; i <= 40; i++) {
    const th = ((i * step + phase) % 360 + 540) % 360 - 180; // -180..180
    if (Math.abs(th) > 82) continue;
    const rad = (th * Math.PI) / 180;
    const y = cy - R * Math.sin(rad);
    const c = Math.cos(rad);
    ridges.push(<line key={i} x1={4} x2={wheelW} y1={y} y2={y} stroke={`rgba(255,255,255,${0.1 + 0.32 * c})`} strokeWidth={Math.max(1, 3.6 * c)} />);
    ridges.push(<line key={`s${i}`} x1={4} x2={wheelW} y1={y + 2.5 * c + 1} y2={y + 2.5 * c + 1} stroke="rgba(0,0,0,0.75)" strokeWidth={Math.max(1, 2.4 * c)} />);
  }
  const sx = wheelW + 14; // scale x
  const pointerY = cy - clamp(vShown, -1, 1) * R * 0.9;
  const showSim = b.simValue !== undefined && b.value !== undefined && Math.abs(b.simValue - b.value) > 0.025;
  const simY = cy - clamp(b.simValue ?? 0, -1, 1) * R * 0.9;
  const marks: JSX.Element[] = [];
  for (let i = -10; i <= 10; i++) {
    const y = cy - (i / 10) * R * 0.9;
    marks.push(<line key={i} x1={sx} x2={sx + (i === 0 ? 14 : i % 5 === 0 ? 10 : 5)} y1={y} y2={y} stroke={i === 0 ? '#ff8a1f' : '#7b8089'} strokeWidth={i === 0 ? 3 : 1.4} />);
  }

  return (
    <div ref={ref} className={`widget ctl trim${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <linearGradient id={`${id}-cyl`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#050505" /><stop offset=".25" stopColor="#2b2e33" /><stop offset=".5" stopColor="#4b4f56" />
              <stop offset=".75" stopColor="#2b2e33" /><stop offset="1" stopColor="#050505" />
            </linearGradient>
            <clipPath id={`${id}-clip`}><rect x={4} y={cy - R} width={wheelW - 4} height={R * 2} rx={6} /></clipPath>
          </defs>
          <text x={w / 2} y={22} className="lbl" textAnchor="middle">TRIM</text>
          <text x={w / 2} y={60} className="readout big" style={{ fontSize: clamp(w * 0.19, 15, 28) }} textAnchor="middle">{b.value === undefined ? '--' : signedTrim(v)}</text>
          <text x={w / 2} y={top - 16} className="cap" textAnchor="middle">▲ NOSE UP</text>
          <text x={w / 2} y={h - 18} className="cap" textAnchor="middle">NOSE DN ▼</text>
          <rect x={0} y={cy - R - 10} width={wheelW + 4} height={R * 2 + 20} rx={8} fill="#0a0b0c" stroke="#000" />
          <rect x={4} y={cy - R} width={wheelW - 4} height={R * 2} rx={6} fill={`url(#${id}-cyl)`} />
          <g clipPath={`url(#${id}-clip)`}>{ridges}</g>
          {/* bezel plates: the wheel is only partially exposed */}
          <rect x={0} y={cy - R - 10} width={12} height={R * 2 + 20} rx={6} fill="#23262a" stroke="#000" />
          <circle cx={6} cy={cy - R + 6} r={2.4} fill="#8a9099" /><circle cx={6} cy={cy + R - 6} r={2.4} fill="#8a9099" />
          {marks}
          {showSim && <path className="simmark" d={`M ${sx + 22} ${simY - 7} l -11 7 l 11 7 z`} />}
          <path d={`M ${sx - 3} ${pointerY} l -11 -7 v 14 z`} fill="#ff8a1f" stroke="#000" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
});

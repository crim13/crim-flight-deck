import { memo, useId, useRef } from 'react';
import { CONTROLS, type ControlId } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { useEased } from '../hooks/useEased';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { LeverDrag, clamp, pct } from './math';
import { svgId, type WidgetProps } from './types';

export type GripKind = 'black' | 'blue' | 'red' | 'gray';

/** Vertical layout of a lever widget: header (name + big value) on top, travel below. Shared with LeverPair. */
export function leverGeometry(h: number) {
  const padTop = clamp(h * 0.18, 108, 132);
  const padBot = clamp(h * 0.1, 52, 76);
  return { padTop, padBot, travel: Math.max(40, h - padTop - padBot) };
}

const ENDS: Record<string, [string, string]> = {
  throttle: ['FULL', 'IDLE'],
  prop: ['HIGH', 'LOW'],
  mixture: ['RICH', 'LEAN'],
  spoilers: ['EXT', 'RET'],
};

/** Distinct handle per lever: black ribbed T-grip, blue round knob, red knurled paddle. */
function Grip({ kind, cx, y, hw, id }: { kind: GripKind; cx: number; y: number; hw: number; id: string }) {
  const arm = (
    <g>
      <rect x={cx - 9} y={y - 26} width={18} height={52} rx={3} fill={`url(#${id}-metal)`} stroke="#0b0c0d" />
    </g>
  );
  if (kind === 'blue') {
    const rx = hw * 0.5;
    return (
      <g>
        {arm}
        <ellipse cx={cx} cy={y} rx={rx} ry={rx * 0.92} fill={`url(#${id}-blue)`} stroke="#07142b" strokeWidth={1.5} />
        {[0.82, 0.62, 0.4].map((k) => (
          <ellipse key={k} cx={cx} cy={y} rx={rx * k} ry={rx * 0.92 * k} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} />
        ))}
        <ellipse cx={cx - rx * 0.28} cy={y - rx * 0.35} rx={rx * 0.38} ry={rx * 0.2} fill="rgba(255,255,255,0.18)" />
        <rect x={cx - 1.5} y={y - rx * 0.92} width={3} height={rx * 0.5} fill="#e9f1ff" />
      </g>
    );
  }
  if (kind === 'red') {
    const w = hw * 0.82;
    const knurl = [];
    for (let i = -Math.floor(w / 12); i <= Math.floor(w / 12); i++) {
      knurl.push(<line key={i} x1={cx + i * 6} y1={y - 22} x2={cx + i * 6} y2={y + 22} stroke="rgba(0,0,0,0.28)" strokeWidth={1.2} />);
    }
    return (
      <g>
        {arm}
        <rect x={cx - w / 2} y={y - 32} width={w} height={64} rx={18} fill={`url(#${id}-red)`} stroke="#2a0805" strokeWidth={1.5} />
        {knurl}
        <rect x={cx - w / 2 + 6} y={y - 28} width={w - 12} height={8} rx={4} fill="rgba(255,255,255,0.16)" />
      </g>
    );
  }
  const w = hw;
  const ridges = [];
  for (let i = -3; i <= 3; i++) {
    ridges.push(<line key={i} x1={cx - w / 2 + 6} x2={cx + w / 2 - 6} y1={y + i * 9} y2={y + i * 9} stroke="rgba(255,255,255,0.10)" strokeWidth={2} />);
    ridges.push(<line key={`d${i}`} x1={cx - w / 2 + 6} x2={cx + w / 2 - 6} y1={y + i * 9 + 3} y2={y + i * 9 + 3} stroke="rgba(0,0,0,0.65)" strokeWidth={2} />);
  }
  return (
    <g>
      {arm}
      <rect x={cx - w / 2} y={y - 40} width={w} height={80} rx={10} fill={kind === 'gray' ? `url(#${id}-gray)` : `url(#${id}-black)`} stroke="#000" strokeWidth={1.5} />
      {ridges}
      <rect x={cx - w / 2 + 2} y={y - 38} width={4} height={76} rx={2} fill="rgba(255,255,255,0.12)" />
      <rect x={cx - w / 2} y={y - 1.5} width={w} height={3} fill="#ff8a1f" opacity={0.9} />
    </g>
  );
}

export const Lever = memo(function Lever({ item }: WidgetProps) {
  const control = item.control as ControlId;
  const engine = item.engine ?? 1;
  const b = useControl(control, engine);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const grip = (String(item.options?.grip ?? 'black') as GripKind);
  const customLabel = useSim((s) => s.profile?.labels?.[control]);
  const multi = useSim((s) => (s.profile?.engines ?? 1) > 1);
  const drag = useRef<LeverDrag | null>(null);
  const startVal = useRef(0);

  const invert = !!b.settings.invert;
  const sens = b.settings.sensitivity ?? 1;
  const { padTop, padBot, travel } = leverGeometry(h);
  const toPos = (v: number) => (invert ? 1 - v : v);
  const fromPos = (p: number) => (invert ? 1 - p : p);

  const gesture = usePointerGesture({
    onStart: ({ y }) => {
      if (!b.enabled) return false;
      const cur = b.value ?? 0;
      drag.current = new LeverDrag(toPos(cur), y, { perPx: 1 / travel });
      startVal.current = cur;
      b.begin(cur); // grab: the handle stays exactly where it is (no jump)
      return true;
    },
    onMove: ({ x, y, startX }) => {
      const d = drag.current;
      if (!d) return;
      b.update(fromPos(d.move(y, x, startX, sens)));
    },
    onEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (d) b.end(fromPos(d.value));
    },
  });

  const v = b.value ?? 0;
  // the handle glides when the simulator (not the finger) moves it, so a late correction never looks like a jump
  const vShown = useEased(b.value, b.dragging) ?? 0;
  const yH = padTop + (1 - toPos(vShown)) * travel;
  const cx = w / 2;
  const hw = clamp(w * 0.66, 56, 124);
  // telemetry marker: where the simulator really is, shown only while it differs from the handle
  const ySim = b.simValue === undefined ? null : padTop + (1 - toPos(b.simValue)) * travel;
  const showSim = ySim !== null && b.value !== undefined && Math.abs(b.simValue! - b.value) > 0.025;
  const readFont = clamp(w * 0.2, 16, 30);
  const [topCap, botCap] = ENDS[control] ?? ['MAX', 'MIN'];
  const name = customLabel ?? CONTROLS[control].label;
  const label = multi && CONTROLS[control].perEngine ? `${name} ${engine}` : name;
  const showReason = !b.enabled && b.reason && b.reason !== 'Simulator not connected';

  const ticks: JSX.Element[] = [];
  for (let i = 0; i <= 20; i++) {
    const y = padTop + travel * (1 - i / 20);
    const major = i % 5 === 0;
    const len = major ? 16 : 8;
    const stroke = major ? '#9aa0a8' : '#5d636b';
    ticks.push(<line key={`l${i}`} x1={cx - 20 - len} x2={cx - 20} y1={y} y2={y} stroke={stroke} strokeWidth={major ? 2 : 1} />);
    ticks.push(<line key={`r${i}`} x1={cx + 20} x2={cx + 20 + len} y1={y} y2={y} stroke={stroke} strokeWidth={major ? 2 : 1} />);
  }

  return (
    <div ref={ref} className={`widget ctl lever${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <linearGradient id={`${id}-metal`} x1="0" x2="1"><stop offset="0" stopColor="#2a2d31" /><stop offset=".5" stopColor="#8b9199" /><stop offset="1" stopColor="#2a2d31" /></linearGradient>
            <linearGradient id={`${id}-black`} x1="0" x2="1"><stop offset="0" stopColor="#111" /><stop offset=".35" stopColor="#3b3b3f" /><stop offset=".7" stopColor="#151517" /><stop offset="1" stopColor="#050505" /></linearGradient>
            <linearGradient id={`${id}-gray`} x1="0" x2="1"><stop offset="0" stopColor="#555a61" /><stop offset=".4" stopColor="#b6bbc2" /><stop offset="1" stopColor="#4a4e55" /></linearGradient>
            <radialGradient id={`${id}-blue`} cx=".38" cy=".3" r=".85"><stop offset="0" stopColor="#7fb2ff" /><stop offset=".45" stopColor="#2d74d8" /><stop offset="1" stopColor="#0f2f6a" /></radialGradient>
            <linearGradient id={`${id}-red`} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ff7b6b" /><stop offset=".45" stopColor="#d23a2e" /><stop offset="1" stopColor="#6d1109" /></linearGradient>
            <linearGradient id={`${id}-slot`} x1="0" x2="1"><stop offset="0" stopColor="#000" /><stop offset=".5" stopColor="#15171a" /><stop offset="1" stopColor="#2b2e33" /></linearGradient>
          </defs>
          <text x={cx} y={22} className="lbl" textAnchor="middle">{label}</text>
          <text x={cx} y={60} className="readout big" style={{ fontSize: readFont }} textAnchor="middle">{b.value === undefined ? '--' : `${pct(v)}%`}</text>
          {ticks}
          <text x={10} y={padTop + 4} className="cap">{topCap}</text>
          <text x={10} y={padTop + travel + 4} className="cap">{botCap}</text>
          <rect x={cx - 8} y={padTop - 14} width={16} height={travel + 28} rx={8} fill={`url(#${id}-slot)`} stroke="#000" strokeWidth={1.5} />
          <rect x={cx - 1.5} y={padTop - 6} width={3} height={travel + 12} rx={1.5} fill="#050607" />
          {showSim && (
            <g className="simmark" opacity={0.9}>
              <path d={`M ${cx - hw / 2 - 4} ${ySim! - 7} l 11 7 l -11 7 z`} />
              <path d={`M ${cx + hw / 2 + 4} ${ySim! - 7} l -11 7 l 11 7 z`} />
            </g>
          )}
          <g opacity={b.enabled ? 1 : 0.45}>
            <Grip kind={grip} cx={cx} y={yH} hw={hw} id={id} />
          </g>
          {showReason && <text x={cx} y={h / 2} className="cap reason" textAnchor="middle">{b.reason}</text>}
        </svg>
      )}
    </div>
  );
});

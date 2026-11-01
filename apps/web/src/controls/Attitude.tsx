import { memo, useId } from 'react';
import { useEased } from '../hooks/useEased';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';
import { attitudeView, formatAttitude } from './math';
import { svgId, type WidgetProps } from './types';

const BANK_TICKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

/**
 * Attitude indicator ("artificial horizon"): the sky / ground fill the whole tile and roll / pitch with the
 * aircraft; pitch ladder, bank scale with roll pointer, fixed aircraft symbol and numeric pitch / bank on top.
 * Read only.
 */
export const Attitude = memo(function Attitude(_: WidgetProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const pitchRaw = useSim((s) => s.values['tel.pitch']) as number | undefined;
  const bankRaw = useSim((s) => s.values['tel.bank']) as number | undefined;
  const flipPitch = useUi((s) => s.flipPitch);
  const flipBank = useUi((s) => s.flipBank);
  const view = attitudeView(typeof pitchRaw === 'number' ? pitchRaw : undefined, typeof bankRaw === 'number' ? bankRaw : undefined, flipPitch, flipBank);
  const live = view.pitchUp !== undefined && view.bankRight !== undefined;
  const pitch = useEased(view.pitchUp, false, 80) ?? 0;
  const bank = useEased(view.bankRight, false, 80) ?? 0;
  const text = formatAttitude(view.pitchUp, view.bankRight);

  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h);
  const ppd = h / 52; // pixels per degree of pitch: about +-26 degrees are visible
  const big = Math.max(w, h) * 3;
  const fs = Math.max(9, Math.min(15, s * 0.06));
  const arcR = Math.max(10, Math.min(cy - 18, s * 0.46));

  const ladder: JSX.Element[] = [];
  for (let p = -40; p <= 40; p += 5) {
    if (p === 0) continue;
    const y = cy - p * ppd;
    const major = p % 10 === 0;
    const half = s * (major ? 0.14 : 0.07);
    ladder.push(<line key={p} x1={cx - half} x2={cx + half} y1={y} y2={y} stroke="#fff" strokeWidth={major ? 1.8 : 1.2} />);
    if (major) {
      ladder.push(<text key={`l${p}`} x={cx - half - 5} y={y + fs * 0.35} textAnchor="end" className="adi-n" style={{ fontSize: fs }}>{Math.abs(p)}</text>);
      ladder.push(<text key={`r${p}`} x={cx + half + 5} y={y + fs * 0.35} className="adi-n" style={{ fontSize: fs }}>{Math.abs(p)}</text>);
    }
  }

  const wing = s * 0.2;
  return (
    <div ref={ref} className="widget attitude" aria-label="attitude indicator">
      {w > 0 && h > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg" opacity={live ? 1 : 0.45}>
          <defs>
            <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1b5fb4" /><stop offset="1" stopColor="#6db6f2" /></linearGradient>
            <linearGradient id={`${id}-gnd`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9a6a36" /><stop offset="1" stopColor="#4d301a" /></linearGradient>
          </defs>
          <g transform={`rotate(${-bank} ${cx} ${cy}) translate(0 ${pitch * ppd})`}>
            <rect x={cx - big} y={cy - big} width={big * 2} height={big} fill={`url(#${id}-sky)`} />
            <rect x={cx - big} y={cy} width={big * 2} height={big} fill={`url(#${id}-gnd)`} />
            <line x1={cx - big} x2={cx + big} y1={cy} y2={cy} stroke="#fff" strokeWidth={2} />
            {ladder}
          </g>
          {/* bank scale: fixed ticks, roll pointer rotates with the horizon */}
          {BANK_TICKS.map((t) => (
            <line key={t} x1={cx} x2={cx} y1={cy - arcR} y2={cy - arcR - (t % 30 === 0 ? 13 : 8)} stroke="#e6eaf0" strokeWidth={t === 0 ? 2.6 : 1.6}
              transform={`rotate(${t} ${cx} ${cy})`} />
          ))}
          <path d={`M ${cx} ${cy - arcR + 1} l -7 12 h 14 z`} fill="#ffb347" stroke="#000" strokeWidth={0.8} transform={`rotate(${-bank} ${cx} ${cy})`} />
          <path d={`M ${cx} ${cy - arcR - 15} l -6 -10 h 12 z`} fill="#fff" stroke="#000" strokeWidth={0.6} />
          {/* aircraft symbol */}
          <path d={`M ${cx - wing * 1.7} ${cy} h ${wing} v ${wing * 0.28}`} fill="none" stroke="#ff8a1f" strokeWidth={5} strokeLinejoin="round" />
          <path d={`M ${cx + wing * 1.7} ${cy} h ${-wing} v ${wing * 0.28}`} fill="none" stroke="#ff8a1f" strokeWidth={5} strokeLinejoin="round" />
          <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="#ff8a1f" stroke="#000" strokeWidth={0.8} />
          {/* numeric readouts */}
          <g className="adi-box">
            <rect x={8} y={h - fs * 2.7 - 8} width={fs * 7.4} height={fs * 2.7} rx={5} />
            <rect x={w - 8 - fs * 7.4} y={h - fs * 2.7 - 8} width={fs * 7.4} height={fs * 2.7} rx={5} />
          </g>
          <text x={8 + fs * 0.6} y={h - fs * 1.7 - 8} className="adi-cap" style={{ fontSize: fs * 0.7 }}>PITCH</text>
          <text x={8 + fs * 0.6} y={h - fs * 0.5 - 8} className="adi-val" style={{ fontSize: fs * 1.1 }}>{text.pitch}</text>
          <text x={w - 8 - fs * 0.6} y={h - fs * 1.7 - 8} textAnchor="end" className="adi-cap" style={{ fontSize: fs * 0.7 }}>BANK</text>
          <text x={w - 8 - fs * 0.6} y={h - fs * 0.5 - 8} textAnchor="end" className="adi-val" style={{ fontSize: fs * 1.1 }}>{text.bank}</text>
        </svg>
      )}
    </div>
  );
});

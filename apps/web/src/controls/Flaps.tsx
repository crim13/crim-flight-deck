import { memo, useId, useRef, useState } from 'react';
import { flapDetents } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { useSim } from '../stores/sim';
import { clamp, detentFromPointer, detentY } from './math';
import { svgId, type WidgetProps } from './types';

/**
 * Flap selector with a stepped gate. Detents come from the profile / simulator (never assumed to be
 * 0/10/20/30). Tap a detent or drag the handle; it follows the finger and snaps on release.
 * The handle shows the simulator's actual flap handle index.
 */
export const Flaps = memo(function Flaps(_: WidgetProps) {
  const b = useControl('flaps');
  const profile = useSim((s) => s.profile);
  const caps = useSim((s) => s.caps);
  const detents = flapDetents(profile, caps);
  const n = detents.length;
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const id = svgId(useId());
  const [dragY, setDragY] = useState<number | null>(null);
  const lastSent = useRef(-1);

  const pad = clamp(h * 0.14, 62, 100);
  const trackTop = pad;
  const trackH = Math.max(60, h - pad * 2 - 20);
  const idxToY = (i: number) => trackTop + detentY(i, n, trackH + 0, 0);
  const cx = Math.max(24, w * 0.3);
  const longest = Math.max(2, ...detents.map((d) => Math.max(d.label.length, (d.detail ?? '').length)));
  const labelFont = Math.max(8, Math.min(14, (w - cx - 40) / (longest * 0.72)));

  const pointerIndex = (y: number, rect: DOMRect) => detentFromPointer(y, rect.top + trackTop, trackH, 0, n);

  const gesture = usePointerGesture({
    onStart: ({ y, rect }) => {
      if (!b.enabled || n < 2) return false;
      const i = pointerIndex(y, rect);
      lastSent.current = i;
      b.begin(detents[i]!.index);
      setDragY(clamp(y - rect.top, trackTop, trackTop + trackH));
      return true;
    },
    onMove: ({ y, rect }) => {
      setDragY(clamp(y - rect.top, trackTop, trackTop + trackH));
      const i = pointerIndex(y, rect);
      if (i !== lastSent.current) {
        lastSent.current = i;
        b.update(detents[i]!.index);
      }
    },
    onEnd: ({ y, rect }) => {
      const i = pointerIndex(y, rect);
      setDragY(null);
      b.end(detents[i]!.index);
    },
  });

  const current = n > 0 && b.value !== undefined ? Math.max(0, detents.findIndex((d) => d.index === b.value)) : 0;
  const unknown = n > 0 && b.value !== undefined && !detents.some((d) => d.index === b.value);
  const yH = dragY ?? idxToY(current);

  return (
    <div ref={ref} className={`widget ctl flaps${b.enabled ? '' : ' disabled'}`} {...gesture}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="wsvg">
          <defs>
            <linearGradient id={`${id}-h`} x1="0" x2="1"><stop offset="0" stopColor="#4a4e55" /><stop offset=".45" stopColor="#c3c8cf" /><stop offset="1" stopColor="#4a4e55" /></linearGradient>
          </defs>
          <text x={w / 2} y={24} className="lbl" textAnchor="middle">FLAPS</text>
          {n >= 2 && (
            <>
              <rect x={cx - 9} y={trackTop - 12} width={18} height={trackH + 24} rx={9} fill="#08090a" stroke="#000" strokeWidth={1.5} />
              {detents.map((d, i) => {
                const y = idxToY(i);
                return (
                  <g key={d.index}>
                    <rect x={cx - 17} y={y - 4} width={34} height={8} rx={3} fill="#08090a" stroke="#000" />
                    <line x1={cx + 22} x2={cx + 32} y1={y} y2={y} stroke="#9aa0a8" strokeWidth={2} />
                    <text x={cx + 36} y={y + 5} className={`det${i === current && !unknown ? ' on' : ''}`} style={{ fontSize: labelFont }}>{d.label}</text>
                    {d.detail && <text x={cx + 36} y={y + 18} className="cap">{d.detail}</text>}
                  </g>
                );
              })}
              <g opacity={b.enabled ? 1 : 0.45}>
                <rect x={cx - 24} y={yH - 17} width={48} height={34} rx={7} fill={`url(#${id}-h)`} stroke="#0a0a0b" strokeWidth={1.5} />
                {[-8, -3, 2, 7].map((o) => <line key={o} x1={cx - 18} x2={cx + 18} y1={yH + o} y2={yH + o} stroke="rgba(0,0,0,0.45)" strokeWidth={1.5} />)}
                <rect x={cx - 24} y={yH - 1.5} width={48} height={3} fill="#ff8a1f" />
              </g>
            </>
          )}
          {n < 2 && <text x={w / 2} y={h / 2} className="cap reason" textAnchor="middle">{b.enabled ? 'WAITING' : 'N/A'}</text>}
        </svg>
      )}
    </div>
  );
});

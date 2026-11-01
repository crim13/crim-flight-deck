import { memo, useMemo, useRef, useState } from 'react';
import type { ControlId } from '@crim/shared';
import { useControl } from '../hooks/useControl';
import { useEased } from '../hooks/useEased';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';
import { Lever, leverGeometry } from './Lever';
import { LeverDrag, clamp, linkVisible } from './math';
import type { WidgetProps } from './types';

/**
 * Two engine levers side by side (1+2, 3+4). Each lever works on its own; when their values are nearly equal a
 * link handle appears between them. Grabbing it aligns both levers (to their mean) and moves them together.
 */
export const LeverPair = memo(function LeverPair({ item }: WidgetProps) {
  const control = item.control as ControlId;
  const e1 = item.engine ?? 1;
  const e2 = e1 + 1;
  const a = useControl(control, e1);
  const b = useControl(control, e2);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [linking, setLinking] = useState(false);
  const visible = useRef(false);
  const drag = useRef<LeverDrag | null>(null);

  const left = useMemo(() => ({ ...item, id: `${item.id}-a`, type: 'lever', engine: e1 }), [item, e1]);
  const right = useMemo(() => ({ ...item, id: `${item.id}-b`, type: 'lever', engine: e2 }), [item, e2]);

  const invert = !!a.settings.invert;
  const sens = a.settings.sensitivity ?? 1;
  const { padTop, travel } = leverGeometry(h);
  const toPos = (v: number) => (invert ? 1 - v : v);
  const fromPos = (p: number) => (invert ? 1 - p : p);
  const both = a.enabled && b.enabled;

  const gesture = usePointerGesture({
    onStart: ({ y }) => {
      if (!both) return false;
      const mean = ((a.value ?? 0) + (b.value ?? 0)) / 2;
      drag.current = new LeverDrag(toPos(mean), y, { perPx: 1 / travel });
      // grabbing aligns the two levers; they are within LINK_FAR of each other, so this is a small correction
      a.begin(mean);
      b.begin(mean);
      setLinking(true);
      return true;
    },
    onMove: ({ x, y, startX }) => {
      const d = drag.current;
      if (!d) return;
      const v = fromPos(d.move(y, x, startX, sens));
      a.update(v);
      b.update(v);
    },
    onEnd: () => {
      const d = drag.current;
      drag.current = null;
      setLinking(false);
      if (d) {
        const v = fromPos(d.value);
        a.end(v);
        b.end(v);
      }
    },
  });

  const show = both && linkVisible(a.value, b.value, visible.current, linking);
  visible.current = show;

  const va = useEased(a.value, a.dragging) ?? 0;
  const vb = useEased(b.value, b.dragging) ?? 0;
  const yBar = padTop + (1 - toPos((va + vb) / 2)) * travel;
  // inner gap between the two handles: lever width minus handle width (see Lever) plus the gutter
  const leverW = Math.max(0, w / 2 - 2);
  const gripW = clamp(leverW * 0.66, 56, 124);
  const barW = Math.max(40, leverW - gripW + 4 + 14);

  return (
    <div ref={ref} className="leverpair">
      <Lever item={left} />
      <Lever item={right} />
      {show && w > 0 && (
        <div
          className={`linkbar ctl${linking ? ' on' : ''}`}
          style={{ left: w / 2 - barW / 2, top: yBar - 19, width: barW }}
          aria-label={`link engines ${e1} and ${e2}`}
          {...gesture}
        >
          <i /><i /><i />
        </div>
      )}
    </div>
  );
});

import { memo, useRef } from 'react';
import type { LayoutItem } from '@crim/shared';
import { getControlType } from '../controls/registry';
import { usePointerGesture } from '../hooks/usePointerGesture';
import { useSize } from '../hooks/useSize';

interface Grid { cols: number; rows: number }

interface Props {
  grid: Grid;
  items: LayoutItem[];
  edit: boolean;
  onChange(items: LayoutItem[]): void;
}

/** Positions widgets on a grid. In edit mode every widget gets move / resize / hide handles; otherwise the layout is locked. */
export function LayoutCanvas({ grid, items, edit, onChange }: Props) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const cellW = w / grid.cols;
  const cellH = h / grid.rows;

  const update = (id: string, patch: Partial<LayoutItem>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  return (
    <div ref={ref} className={`canvas${edit ? ' editing' : ''}`}>
      {items.map((it) => (it.hidden && !edit ? null : (
        <Cell key={it.id} item={it} grid={grid} cellW={cellW} cellH={cellH} edit={edit} update={update} />
      )))}
    </div>
  );
}

interface CellProps {
  item: LayoutItem;
  grid: Grid;
  cellW: number;
  cellH: number;
  edit: boolean;
  update(id: string, patch: Partial<LayoutItem>): void;
}

const Cell = memo(function Cell({ item, grid, cellW, cellH, edit, update }: CellProps) {
  const def = getControlType(item.type);
  const Comp = def?.component;
  const start = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const move = usePointerGesture({
    onStart: () => { start.current = { x: item.x, y: item.y, w: item.w, h: item.h }; return true; },
    onMove: ({ x, y, startX, startY }) => {
      const s = start.current;
      const nx = Math.max(0, Math.min(grid.cols - s.w, s.x + Math.round((x - startX) / cellW)));
      const ny = Math.max(0, Math.min(grid.rows - s.h, s.y + Math.round((y - startY) / cellH)));
      if (nx !== item.x || ny !== item.y) update(item.id, { x: nx, y: ny });
    },
    onEnd: () => {},
  });

  const resize = usePointerGesture({
    onStart: () => { start.current = { x: item.x, y: item.y, w: item.w, h: item.h }; return true; },
    onMove: ({ x, y, startX, startY }) => {
      const s = start.current;
      const nw = Math.max(1, Math.min(grid.cols - s.x, s.w + Math.round((x - startX) / cellW)));
      const nh = Math.max(1, Math.min(grid.rows - s.y, s.h + Math.round((y - startY) / cellH)));
      if (nw !== item.w || nh !== item.h) update(item.id, { w: nw, h: nh });
    },
    onEnd: () => {},
  });

  const style = {
    left: `${(item.x / grid.cols) * 100}%`,
    top: `${(item.y / grid.rows) * 100}%`,
    width: `${(item.w / grid.cols) * 100}%`,
    height: `${(item.h / grid.rows) * 100}%`,
  };

  return (
    <div className={`cell t-${item.type}${item.hidden ? ' is-hidden' : ''}`} style={style}>
      {Comp ? <Comp item={item} /> : <div className="widget unknown">?{item.type}</div>}
      {edit && (
        <div className="edit-overlay">
          <div className="edit-move ctl" {...move}>
            <span className="edit-name">{item.control ?? item.type}{item.engine && item.engine > 1 ? ` ${item.engine}` : ''}</span>
          </div>
          <button type="button" className="edit-hide ctl" aria-label={item.hidden ? 'show' : 'hide'}
            onPointerDown={(e) => { e.preventDefault(); update(item.id, { hidden: !item.hidden }); }}>
            {item.hidden ? '＋' : '✕'}
          </button>
          <div className="edit-resize ctl" {...resize} />
        </div>
      )}
    </div>
  );
});

export const MemoCanvas = memo(LayoutCanvas);

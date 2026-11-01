import { useCallback, useRef } from 'react';

export interface GestureHandlers {
  /** return false to refuse the gesture (e.g. disabled control) */
  onStart(e: { x: number; y: number; rect: DOMRect; target: EventTarget }): boolean | void;
  onMove(e: { x: number; y: number; startX: number; startY: number; rect: DOMRect }): void;
  /** `cancelled` is true for pointercancel / lost capture - treat as release at the last value */
  onEnd(e: { x: number; y: number; moved: number; cancelled: boolean; rect: DOMRect; durationMs: number }): void;
}

/**
 * Single-pointer gesture with pointer capture. Each widget owns its own active pointer id, so several
 * controls can be operated by different fingers at the same time; extra fingers on the same widget are ignored.
 * Always pair with CSS `touch-action: none`.
 */
export function usePointerGesture(h: GestureHandlers) {
  const active = useRef<{ id: number; sx: number; sy: number; lx: number; ly: number; t0: number; moved: number; el: HTMLElement } | null>(null);
  const handlers = useRef(h);
  handlers.current = h;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (handlers.current.onStart({ x: e.clientX, y: e.clientY, rect, target: e.target }) === false) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    active.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: 0, el };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    a.moved += Math.abs(e.clientX - a.lx) + Math.abs(e.clientY - a.ly);
    a.lx = e.clientX;
    a.ly = e.clientY;
    handlers.current.onMove({ x: e.clientX, y: e.clientY, startX: a.sx, startY: a.sy, rect: a.el.getBoundingClientRect() });
  }, []);

  const finish = useCallback((e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    try { a.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    handlers.current.onEnd({ x: e.clientX, y: e.clientY, moved: a.moved, cancelled, rect: a.el.getBoundingClientRect(), durationMs: performance.now() - a.t0 });
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
  };
}

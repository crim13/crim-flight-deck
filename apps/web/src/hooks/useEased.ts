import { useEffect, useRef, useState } from 'react';

/**
 * Smooths movements that do not come from the finger. `snap` (finger down) follows the target exactly;
 * otherwise the shown value glides towards it (exponential, time constant `tauMs`), so when the simulator
 * value takes over after a hold the handle slides instead of jumping.
 */
export function useEased(target: number | undefined, snap: boolean, tauMs = 110): number | undefined {
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  const goal = useRef(target);
  const raf = useRef(0);
  goal.current = target;

  useEffect(() => {
    if (target === undefined || snap || cur.current === undefined) {
      cur.current = target;
      setShown(target);
      return;
    }
    let last = 0;
    const step = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      const c = cur.current as number;
      const g = goal.current as number;
      let n = c + (g - c) * (1 - Math.exp(-dt / tauMs));
      if (Math.abs(g - n) < 0.0008) n = g;
      cur.current = n;
      setShown(n);
      if (n !== g) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, snap, tauMs]);

  return snap ? target : shown;
}

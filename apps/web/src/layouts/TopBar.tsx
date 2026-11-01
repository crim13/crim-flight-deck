import { memo, useMemo } from 'react';
import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';
import { FUEL_UNITS, formatTelemetry } from '../telemetry';
import { StatusCluster } from './StatusOverlay';

/**
 * Read-only flight data above every panel: speeds, altitude, vertical speed, heading, fuel.
 * Values come straight from the simulator (never held locally); without it they show "--".
 * Tap FUEL to cycle gallons / pounds / kilograms.
 */
export const TopBar = memo(function TopBar() {
  const values = useSim((s) => s.values);
  const engines = useSim((s) => s.profile?.engines ?? s.caps.engineCount ?? 1);
  const unit = useUi((s) => s.fuelUnit);
  const setUnit = useUi((s) => s.setFuelUnit);
  const cells = useMemo(() => formatTelemetry(values, engines, unit), [values, engines, unit]);

  return (
    <header className="topbar">
      <div className="tele">
        {cells.map((c) => {
          const cycle = c.key === 'fuel' || c.key === 'ff' || c.key === 'end';
          const props = cycle
            ? { role: 'button' as const, onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); setUnit(FUEL_UNITS[(FUEL_UNITS.indexOf(unit) + 1) % FUEL_UNITS.length]!); } }
            : {};
          return (
            <div key={c.key} className={`tcell c-${c.key}${cycle ? ' tap ctl' : ''}${c.tone ? ` ${c.tone}` : ''}${c.value === '--' ? ' na' : ''}`} {...props}>
              <span className="tl">{c.label}</span>
              <span className="tv">{c.value}</span>
              <span className="tu">{c.unit}</span>
            </div>
          );
        })}
      </div>
      <StatusCluster />
    </header>
  );
});

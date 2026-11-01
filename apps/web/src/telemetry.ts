import { engineKey, type StateMap, type StateValue } from '@crim/shared';

export type FuelUnit = 'gal' | 'lb' | 'kg';
export const FUEL_UNITS: FuelUnit[] = ['gal', 'lb', 'kg'];

const KG_PER_LB = 0.45359237;
const FALLBACK_LB_PER_GAL = 6; // avgas; the real density is derived from the simulator's own gallons / pounds

const num = (v: StateValue | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const group = (n: number): string => Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface TelemetryCell {
  key: 'ias' | 'gs' | 'alt' | 'vs' | 'hdg' | 'fuel' | 'ff' | 'end';
  label: string;
  value: string;
  unit: string;
  /** colours the value: climbing / descending */
  tone?: 'up' | 'down';
}

/** Total fuel flow of the first `engines` engines in gallons per hour (undefined until any engine reports). */
export function fuelFlowGph(values: StateMap, engines: number): number | undefined {
  let sum = 0;
  let any = false;
  for (let e = 1; e <= Math.max(1, Math.min(4, engines)); e++) {
    const v = num(values[engineKey('tel.ff', e)]);
    if (v !== undefined) { sum += v; any = true; }
  }
  return any ? sum : undefined;
}

export function formatHeading(deg: number | undefined): string {
  return deg === undefined ? '---' : String(Math.round(((deg % 360) + 360) % 360) % 360 || 360).padStart(3, '0');
}

export function formatVs(fpm: number | undefined): string {
  if (fpm === undefined) return '--';
  const r = Math.round(fpm / 10) * 10;
  return r === 0 ? '0' : `${r > 0 ? '+' : '-'}${group(r)}`;
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '--';
  const total = Math.min(99 * 60 + 59, Math.round(hours * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Everything the top bar shows, formatted. Missing data is "--" (never a stale or invented number). */
export function formatTelemetry(values: StateMap, engines: number, unit: FuelUnit): TelemetryCell[] {
  const ias = num(values['tel.ias']);
  const gs = num(values['tel.gs']);
  const alt = num(values['tel.alt']);
  const vs = num(values['tel.vs']);
  const hdg = num(values['tel.hdg']);
  const gal = num(values['tel.fuelGal']);
  const lb = num(values['tel.fuelLb']);
  const ffGph = fuelFlowGph(values, engines);

  const lbPerGal = gal && lb && gal > 0.5 ? lb / gal : FALLBACK_LB_PER_GAL;
  const fuel = unit === 'gal' ? (gal === undefined ? undefined : gal.toFixed(1))
    : lb === undefined ? undefined : group(unit === 'lb' ? lb : lb * KG_PER_LB);
  const ffUnitValue = ffGph === undefined ? undefined : unit === 'gal' ? ffGph : ffGph * lbPerGal * (unit === 'kg' ? KG_PER_LB : 1);
  const ff = ffUnitValue === undefined ? undefined : ffUnitValue < 100 ? ffUnitValue.toFixed(1) : group(ffUnitValue);
  const endurance = gal !== undefined && ffGph !== undefined && ffGph > 0.3 ? formatDuration(gal / ffGph) : undefined;

  return [
    { key: 'ias', label: 'IAS', value: ias === undefined ? '--' : String(ias), unit: 'KT' },
    { key: 'gs', label: 'GS', value: gs === undefined ? '--' : String(gs), unit: 'KT' },
    { key: 'alt', label: 'ALT', value: alt === undefined ? '--' : `${alt < 0 ? '-' : ''}${group(alt)}`, unit: 'FT' },
    { key: 'vs', label: 'VS', value: formatVs(vs), unit: 'FPM', tone: vs === undefined ? undefined : vs >= 100 ? 'up' : vs <= -100 ? 'down' : undefined },
    { key: 'hdg', label: 'HDG', value: formatHeading(hdg), unit: '°M' },
    { key: 'fuel', label: 'FUEL', value: fuel ?? '--', unit: unit.toUpperCase() },
    { key: 'ff', label: 'FLOW', value: ff ?? '--', unit: unit === 'gal' ? 'GPH' : unit === 'lb' ? 'PPH' : 'KPH' },
    { key: 'end', label: 'ENDUR', value: endurance ?? '--', unit: 'H:M' },
  ];
}

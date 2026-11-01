import { describe, expect, it } from 'vitest';
import { formatDuration, formatHeading, formatTelemetry, formatVs, fuelFlowGph } from './telemetry';

const cell = (cells: ReturnType<typeof formatTelemetry>, key: string) => cells.find((c) => c.key === key)!;

describe('top bar telemetry', () => {
  it('shows "--" for everything when the simulator sends nothing', () => {
    for (const c of formatTelemetry({}, 1, 'gal')) expect(c.value === '--' || c.value === '---').toBe(true);
  });

  it('formats the flight data', () => {
    const cells = formatTelemetry({ 'tel.ias': 112, 'tel.gs': 118, 'tel.alt': 12500, 'tel.vs': -740, 'tel.hdg': 0, 'tel.fuelGal': 40.26, 'tel.fuelLb': 241 }, 1, 'gal');
    expect(cell(cells, 'ias').value).toBe('112');
    expect(cell(cells, 'alt').value).toBe('12,500');
    expect(cell(cells, 'vs')).toMatchObject({ value: '-740', tone: 'down' });
    expect(cell(cells, 'hdg').value).toBe('360');
    expect(cell(cells, 'fuel').value).toBe('40.3');
  });

  it('formats heading, vertical speed and duration', () => {
    expect(formatHeading(5)).toBe('005');
    expect(formatHeading(-90)).toBe('270');
    expect(formatVs(0)).toBe('0');
    expect(formatVs(1496)).toBe('+1,500');
    expect(formatDuration(2.5)).toBe('2:30');
  });

  it('sums the fuel flow of the aircraft engines only and converts units with the simulator density', () => {
    const v = { 'tel.ff': 10, 'tel.ff2': 12, 'tel.ff3': 99, 'tel.fuelGal': 100, 'tel.fuelLb': 670 };
    expect(fuelFlowGph(v, 2)).toBe(22);
    expect(cell(formatTelemetry(v, 2, 'gal'), 'ff').value).toBe('22.0');
    expect(cell(formatTelemetry(v, 2, 'lb'), 'ff')).toMatchObject({ value: '147', unit: 'PPH' });
    expect(cell(formatTelemetry(v, 2, 'kg'), 'fuel').value).toBe('304');
    expect(cell(formatTelemetry(v, 2, 'gal'), 'end').value).toBe('4:33');
  });
});

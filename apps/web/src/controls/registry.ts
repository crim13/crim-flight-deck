import type { ComponentType } from 'react';
import type { ControlId } from '@crim/shared';
import { Attitude } from './Attitude';
import { Flaps } from './Flaps';
import { GearLever, ParkBrake } from './GearBrake';
import { Encoder } from './Knob';
import { Lever } from './Lever';
import { LeverPair } from './LeverPair';
import { RadioPanel, XpndrPanel } from './Radios';
import { PushButton, Toggle } from './Switches';
import { TrimWheel } from './TrimWheel';
import type { WidgetProps } from './types';

export interface ControlTypeDef {
  component: ComponentType<WidgetProps>;
  label: string;
  /** default size (grid units) when added from the editor, per role */
  size: { tablet: [number, number]; phone: [number, number] };
  /** whether the widget is bound to a ControlId chosen by the user when added */
  accepts?: (c: ControlId) => boolean;
}

const registry = new Map<string, ControlTypeDef>();

/** Register a widget type. New control types plug in here without touching layout/persistence code. */
export function registerControl(type: string, def: ControlTypeDef): void {
  registry.set(type, def);
}

export const getControlType = (type: string): ControlTypeDef | undefined => registry.get(type);
export const controlTypes = (): [string, ControlTypeDef][] => [...registry.entries()];

registerControl('lever', { component: Lever, label: 'Lever', size: { tablet: [6, 16], phone: [3, 12] }, accepts: (c) => ['throttle', 'prop', 'mixture', 'spoilers'].includes(c) });
registerControl('leverPair', { component: LeverPair, label: 'Linked lever pair', size: { tablet: [6, 16], phone: [6, 12] }, accepts: (c) => ['throttle', 'prop', 'mixture'].includes(c) });
registerControl('trim', { component: TrimWheel, label: 'Trim wheel', size: { tablet: [3, 16], phone: [3, 12] }, accepts: (c) => c === 'trim' });
registerControl('flaps', { component: Flaps, label: 'Flaps', size: { tablet: [4, 16], phone: [4, 12] }, accepts: (c) => c === 'flaps' });
registerControl('gear', { component: GearLever, label: 'Gear lever', size: { tablet: [5, 8], phone: [4, 6] }, accepts: (c) => c === 'gear' });
registerControl('brake', { component: ParkBrake, label: 'Parking brake', size: { tablet: [5, 8], phone: [4, 6] }, accepts: (c) => c === 'parkingBrake' });
registerControl('toggle', { component: Toggle, label: 'Toggle switch', size: { tablet: [3, 4], phone: [4, 5] }, accepts: (c) => c !== 'trim' });
registerControl('push', { component: PushButton, label: 'Push button', size: { tablet: [3, 3], phone: [4, 3] }, accepts: (c) => c !== 'trim' });
registerControl('encoder', { component: Encoder, label: 'Setpoint knob', size: { tablet: [4, 8], phone: [6, 7] }, accepts: (c) => ['apHeadingSel', 'apAltitudeSel', 'apVsSel'].includes(c) });
registerControl('attitude', { component: Attitude, label: 'Attitude indicator', size: { tablet: [8, 6], phone: [12, 8] } });
registerControl('radio', { component: RadioPanel, label: 'Radio', size: { tablet: [12, 5], phone: [12, 5] } });
registerControl('xpndr', { component: XpndrPanel, label: 'Transponder', size: { tablet: [12, 4], phone: [12, 4] } });

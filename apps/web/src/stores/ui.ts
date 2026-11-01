import { create } from 'zustand';
import type { DeviceMode, PhonePageId } from '@crim/shared';
import { detectMode, load, save, storedMode } from '../services/device';
import { FUEL_UNITS, type FuelUnit } from '../telemetry';

const storedFuelUnit = (): FuelUnit => {
  const u = load('crim.fuelUnit');
  return FUEL_UNITS.find((f) => f === u) ?? 'gal';
};

interface UiState {
  /** telemetry strip above the panel (per device, kept in the browser) */
  topBar: boolean;
  fuelUnit: FuelUnit;
  /** attitude indicator sign flips (the simulator's sign convention is not documented) */
  flipPitch: boolean;
  flipBank: boolean;
  setFlip(axis: 'pitch' | 'bank', b: boolean): void;
  setTopBar(b: boolean): void;
  setFuelUnit(u: FuelUnit): void;
  modeSetting: DeviceMode;
  viewport: { w: number; h: number };
  editMode: boolean;
  settingsOpen: boolean;
  addOpen: boolean;
  phonePage: PhonePageId | null;
  /** tablet: the throttle quadrant or one of the extra pages */
  tabletPage: 'quadrant' | PhonePageId;
  setTabletPage(p: 'quadrant' | PhonePageId): void;
  setModeSetting(m: DeviceMode): void;
  setViewport(w: number, h: number): void;
  setEdit(b: boolean): void;
  setSettingsOpen(b: boolean): void;
  setAddOpen(b: boolean): void;
  setPhonePage(p: PhonePageId): void;
}

export const useUi = create<UiState>((set) => ({
  topBar: load('crim.topBar') !== 'off',
  fuelUnit: storedFuelUnit(),
  flipPitch: load('crim.flipPitch') === 'on',
  flipBank: load('crim.flipBank') === 'on',
  setFlip: (axis, b) => {
    save(axis === 'pitch' ? 'crim.flipPitch' : 'crim.flipBank', b ? 'on' : 'off');
    set(axis === 'pitch' ? { flipPitch: b } : { flipBank: b });
  },
  setTopBar: (topBar) => { save('crim.topBar', topBar ? 'on' : 'off'); set({ topBar }); },
  setFuelUnit: (fuelUnit) => { save('crim.fuelUnit', fuelUnit); set({ fuelUnit }); },
  modeSetting: storedMode(),
  viewport: { w: typeof window === 'undefined' ? 1280 : window.innerWidth, h: typeof window === 'undefined' ? 800 : window.innerHeight },
  editMode: false,
  settingsOpen: false,
  addOpen: false,
  phonePage: null,
  tabletPage: 'quadrant',
  setTabletPage: (tabletPage) => set({ tabletPage, addOpen: false }),
  setModeSetting: (m) => { save('crim.mode', m); set({ modeSetting: m }); },
  setViewport: (w, h) => set({ viewport: { w, h } }),
  setEdit: (editMode) => set({ editMode, addOpen: false }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAddOpen: (addOpen) => set({ addOpen }),
  setPhonePage: (phonePage) => set({ phonePage }),
}));

export const resolveMode = (setting: DeviceMode, vp: { w: number; h: number }): 'tablet' | 'phone' =>
  setting === 'auto' ? detectMode(vp.w, vp.h) : setting;

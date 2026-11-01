import { z } from 'zod';
import { CONTROL_IDS, type ControlId } from './controls';
import type { Profile } from './profile';

// Widget types are open strings validated by the web app's control registry, so new
// control types can be registered later without touching the persistence schema.
export const LayoutItemSchema = z.object({
  id: z.string().min(1).max(48),
  type: z.string().min(1).max(32),
  control: z.enum(CONTROL_IDS).nullable(),
  engine: z.number().int().min(1).max(4).optional(),
  x: z.number().min(0).max(200),
  y: z.number().min(0).max(200),
  w: z.number().min(1).max(200),
  h: z.number().min(1).max(200),
  hidden: z.boolean().optional(),
  options: z.record(z.string(), z.union([z.string().max(64), z.number(), z.boolean()])).optional(),
});
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const GridSchema = z.object({ cols: z.number().int().min(4).max(96), rows: z.number().int().min(4).max(96) });

/**
 * Bumped when the generated default changes in a way saved multi-engine layouts should not keep
 * (rev 2: engine pairs share a `leverPair` widget with a link handle; rev 3: 20 grid rows with the attitude
 * indicator above gear / parking brake). Layouts without `rev` are rev 1.
 */
export const TABLET_LAYOUT_REV = 3;

export const TabletLayoutSchema = z.object({
  version: z.literal(1),
  rev: z.number().int().min(1).max(99).optional(),
  grid: GridSchema,
  items: z.array(LayoutItemSchema).max(80),
});
export type TabletLayout = z.infer<typeof TabletLayoutSchema>;

export const PHONE_PAGE_IDS = ['autopilot', 'radios', 'systems', 'quick'] as const;
export type PhonePageId = (typeof PHONE_PAGE_IDS)[number];

export const PhonePageSchema = z.object({
  id: z.enum(PHONE_PAGE_IDS),
  grid: GridSchema,
  items: z.array(LayoutItemSchema).max(80),
});
export type PhonePage = z.infer<typeof PhonePageSchema>;

export const PhoneLayoutSchema = z.object({
  version: z.literal(1),
  pages: z.array(PhonePageSchema).max(8),
});
export type PhoneLayout = z.infer<typeof PhoneLayoutSchema>;

// ---------------------------------------------------------------------------
// Default layouts (generated from the active profile so unsupported levers are not shown)
// ---------------------------------------------------------------------------

export const TABLET_GRID = { cols: 32, rows: 20 } as const;

export function defaultTabletLayout(profile: Profile | null, engineCap = 4): TabletLayout {
  const items: LayoutItem[] = [];
  const has = (c: ControlId) => !!profile?.controls[c]?.enabled;
  const R = TABLET_GRID.rows;
  items.push({ id: 'trim', type: 'trim', control: 'trim', x: 0, y: 0, w: 3, h: R });

  // Multi-engine: levers of one kind are paired (1+2, 3+4) in a `leverPair` with a link handle between them,
  // so the order is T1 T2 | P1 P2 | M1 M2. A lone last engine stays a plain lever.
  const slots: { control: ControlId; engine: number; grip: string; pair: boolean }[] = [];
  const engines = Math.max(1, Math.min(profile?.engines ?? 1, engineCap));
  for (const [control, grip] of [['throttle', 'black'], ['prop', 'blue'], ['mixture', 'red']] as const) {
    if (!has(control) && profile) continue;
    for (let e = 1; e <= engines; e += 2) slots.push({ control, engine: e, grip, pair: e + 1 <= engines });
  }
  const levers = slots.reduce((n, s) => n + (s.pair ? 2 : 1), 0);
  const area = 19; // columns 3..21
  const per = Math.max(2, Math.floor(area / Math.max(1, levers)));
  let col = 3;
  for (const s of slots) {
    const w = s.pair ? per * 2 : per;
    items.push({
      id: s.pair ? `${s.control}${s.engine}-${s.engine + 1}` : `${s.control}${s.engine}`,
      type: s.pair ? 'leverPair' : 'lever',
      control: s.control,
      engine: s.engine,
      x: col,
      y: 0,
      w,
      h: R,
      options: { grip: s.grip },
    });
    col += w;
  }

  const rx = 3 + Math.max(levers, 1) * per; // right zone start
  const rw = TABLET_GRID.cols - rx;
  if (has('flaps') || !profile) items.push({ id: 'flaps', type: 'flaps', control: 'flaps', x: rx, y: 0, w: 4, h: R });
  const cx = rx + 4;
  const cw = TABLET_GRID.cols - cx;
  const half = Math.max(2, Math.floor(cw / 2));
  // right column, top to bottom: attitude indicator (a square tile) / gear + parking brake / switches
  items.push({ id: 'attitude', type: 'attitude', control: null, x: cx, y: 0, w: cw, h: 6 });
  if (has('gear') || !profile) items.push({ id: 'gear', type: 'gear', control: 'gear', x: cx, y: 6, w: half, h: 6 });
  items.push({ id: 'parkingBrake', type: 'brake', control: 'parkingBrake', x: cx + half, y: 6, w: cw - half, h: 6 });

  const switches: ControlId[] = ['lightNav', 'lightBeacon', 'lightStrobe', 'lightLanding', 'lightTaxi'];
  switches.push(has('spoilers') ? 'spoilers' : 'pitotHeat');
  const cols = 3;
  const sw = Math.max(2, Math.floor(cw / cols));
  switches.forEach((c, i) => {
    items.push({
      id: `sw-${c}`,
      type: 'toggle',
      control: c,
      x: cx + (i % cols) * sw,
      y: 12 + Math.floor(i / cols) * 4,
      w: sw,
      h: 4,
    });
  });
  void rw;
  return { version: 1, rev: TABLET_LAYOUT_REV, grid: { ...TABLET_GRID }, items };
}

/** A saved tablet layout is kept unless it predates the current generated default (see TABLET_LAYOUT_REV). */
export function isTabletLayoutCurrent(saved: TabletLayout): boolean {
  return (saved.rev ?? 1) >= TABLET_LAYOUT_REV;
}

/** Landscape pages next to the throttle quadrant on the tablet: autopilot, radios, systems, quick actions. */
export const TABLET_PAGE_GRID = { cols: 32, rows: 20 } as const;

export function defaultTabletPages(): PhoneLayout {
  const g = { ...TABLET_PAGE_GRID };
  const page = (id: PhonePageId, items: LayoutItem[]): PhonePage => ({ id, grid: { ...g }, items });
  const enc = (id: string, control: ControlId, x: number, y: number, w: number, h: number): LayoutItem =>
    ({ id, type: 'encoder', control, x, y, w, h });
  const btn = (control: ControlId, x: number, y: number, w: number, h: number, type = 'push'): LayoutItem =>
    ({ id: `b-${control}`, type, control, x, y, w, h });

  // Four roughly square tiles in a row (HDG / ALT / VS knobs and the attitude indicator), each knob with its
  // mode button right below it; AP master and approach in a wide row at the bottom.
  const autopilot = page('autopilot', [
    enc('e-hdg', 'apHeadingSel', 0, 0, 8, 9),
    enc('e-alt', 'apAltitudeSel', 8, 0, 8, 9),
    enc('e-vs', 'apVsSel', 16, 0, 8, 9),
    { id: 'attitude', type: 'attitude', control: null, x: 24, y: 0, w: 8, h: 9 },
    btn('apHeading', 0, 9, 8, 5), btn('apAltitude', 8, 9, 8, 5), btn('apVs', 16, 9, 8, 5), btn('apNav', 24, 9, 8, 5),
    btn('apMaster', 0, 14, 16, 6), btn('apApproach', 16, 14, 16, 6),
  ]);
  const radios = page('radios', [
    { id: 'r-com1', type: 'radio', control: 'com1Standby', x: 0, y: 0, w: 16, h: 6, options: { radio: 'com1' } },
    { id: 'r-com2', type: 'radio', control: 'com2Standby', x: 0, y: 6, w: 16, h: 6, options: { radio: 'com2' } },
    { id: 'r-nav1', type: 'radio', control: 'nav1Standby', x: 16, y: 0, w: 16, h: 6, options: { radio: 'nav1' } },
    { id: 'r-nav2', type: 'radio', control: 'nav2Standby', x: 16, y: 6, w: 16, h: 6, options: { radio: 'nav2' } },
    { id: 'r-xpdr', type: 'xpndr', control: 'xpndrCode', x: 6, y: 12, w: 20, h: 8 },
  ]);
  const sysCtl: ControlId[] = [
    'batteryMaster', 'avionicsMaster', 'fuelPump', 'pitotHeat',
    'lightNav', 'lightBeacon', 'lightStrobe', 'lightLanding', 'lightTaxi', 'parkingBrake',
  ];
  const systems = page('systems', sysCtl.map((c, i) => ({
    id: `s-${c}`, type: 'toggle', control: c, x: (i % 5) * 6, y: Math.floor(i / 5) * 10, w: 6, h: 10,
  })));
  const quickCtl: ControlId[] = ['lightLanding', 'lightStrobe', 'parkingBrake', 'gear', 'apMaster', 'swapCom1'];
  const quick = page('quick', quickCtl.map((c, i) => btn(c, (i % 3) * 10, Math.floor(i / 3) * 10, 10, 10)));
  return { version: 1, pages: [autopilot, radios, systems, quick] };
}

export const PHONE_GRID = { cols: 12, rows: 24 } as const;

export function defaultPhoneLayout(profile: Profile | null): PhoneLayout {
  const g = { ...PHONE_GRID };
  const page = (id: PhonePageId, items: LayoutItem[]): PhonePage => ({ id, grid: { ...g }, items });
  const enc = (id: string, control: ControlId, x: number, y: number, w: number, h: number, options?: LayoutItem['options']): LayoutItem =>
    ({ id, type: 'encoder', control, x, y, w, h, options });
  const btn = (control: ControlId, x: number, y: number, w: number, h: number, type = 'push'): LayoutItem =>
    ({ id: `b-${control}`, type, control, x, y, w, h });

  const autopilot = page('autopilot', [
    btn('apMaster', 0, 0, 12, 3),
    enc('e-hdg', 'apHeadingSel', 0, 3, 6, 7),
    enc('e-alt', 'apAltitudeSel', 6, 3, 6, 7),
    enc('e-vs', 'apVsSel', 0, 10, 6, 7),
    btn('apHeading', 6, 10, 3, 3), btn('apNav', 9, 10, 3, 3),
    btn('apApproach', 6, 13, 3, 4), btn('apAltitude', 9, 13, 3, 2), btn('apVs', 9, 15, 3, 2),
  ]);
  const radios: PhonePage = {
    id: 'radios',
    grid: { cols: 12, rows: 30 },
    items: [
      { id: 'r-com1', type: 'radio', control: 'com1Standby', x: 0, y: 0, w: 12, h: 5, options: { radio: 'com1' } },
      { id: 'r-com2', type: 'radio', control: 'com2Standby', x: 0, y: 5, w: 12, h: 5, options: { radio: 'com2' } },
      { id: 'r-nav1', type: 'radio', control: 'nav1Standby', x: 0, y: 10, w: 12, h: 5, options: { radio: 'nav1' } },
      { id: 'r-nav2', type: 'radio', control: 'nav2Standby', x: 0, y: 15, w: 12, h: 5, options: { radio: 'nav2' } },
      { id: 'r-xpdr', type: 'xpndr', control: 'xpndrCode', x: 0, y: 20, w: 12, h: 8 },
    ],
  };
  const sysCtl: ControlId[] = [
    'batteryMaster', 'avionicsMaster', 'fuelPump', 'pitotHeat',
    'lightNav', 'lightBeacon', 'lightStrobe', 'lightLanding', 'lightTaxi', 'parkingBrake',
  ];
  const systems = page('systems', sysCtl.map((c, i) => ({
    id: `s-${c}`, type: 'toggle', control: c, x: (i % 3) * 4, y: Math.floor(i / 3) * 5, w: 4, h: 5,
  })));
  const quickCtl: ControlId[] = ['lightLanding', 'lightStrobe', 'parkingBrake', 'gear', 'apMaster', 'swapCom1'];
  const quick = page('quick', quickCtl.map((c, i) => btn(c, (i % 2) * 6, Math.floor(i / 2) * 4, 6, 4)));
  void profile;
  return { version: 1, pages: [autopilot, radios, systems, quick] };
}

/** Clamp every item inside the grid and ensure positive size (used after edits / when loading). */
export function normalizeItems(items: LayoutItem[], grid: { cols: number; rows: number }): LayoutItem[] {
  return items.map((it) => {
    const w = Math.min(Math.max(1, Math.round(it.w)), grid.cols);
    const h = Math.min(Math.max(1, Math.round(it.h)), grid.rows);
    const x = Math.min(Math.max(0, Math.round(it.x)), grid.cols - w);
    const y = Math.min(Math.max(0, Math.round(it.y)), grid.rows - h);
    return { ...it, x, y, w, h };
  });
}

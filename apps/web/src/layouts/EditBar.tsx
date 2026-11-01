import { CONTROLS, CONTROL_IDS, type ControlId, type LayoutItem } from '@crim/shared';
import { controlTypes } from '../controls/registry';
import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';

/** default widget type for a control when it is added from the editor */
export function defaultTypeFor(control: ControlId): { type: string; options?: LayoutItem['options'] } {
  const d = CONTROLS[control];
  switch (control) {
    case 'throttle': return { type: 'lever', options: { grip: 'black' } };
    case 'prop': return { type: 'lever', options: { grip: 'blue' } };
    case 'mixture': return { type: 'lever', options: { grip: 'red' } };
    case 'spoilers': return { type: 'lever', options: { grip: 'gray' } };
    case 'trim': return { type: 'trim' };
    case 'flaps': return { type: 'flaps' };
    case 'gear': return { type: 'gear' };
    case 'parkingBrake': return { type: 'brake' };
    case 'xpndrCode': return { type: 'xpndr' };
    case 'com1Standby': return { type: 'radio', options: { radio: 'com1' } };
    case 'com2Standby': return { type: 'radio', options: { radio: 'com2' } };
    case 'nav1Standby': return { type: 'radio', options: { radio: 'nav1' } };
    case 'nav2Standby': return { type: 'radio', options: { radio: 'nav2' } };
    case 'apHeadingSel': case 'apAltitudeSel': case 'apVsSel': return { type: 'encoder' };
  }
  if (d.kind === 'switch') return { type: d.group === 'autopilot' ? 'push' : 'toggle' };
  return { type: 'push' };
}

const ADDABLE = CONTROL_IDS.filter((c) => !['com1Active', 'com2Active', 'nav1Active', 'nav2Active', 'xpndrMode'].includes(c));

interface Props {
  role: 'tablet' | 'phone';
  items: LayoutItem[];
  onChange(items: LayoutItem[]): void;
  onReset(): void;
  onDone(): void;
}

/** Edit mode toolbar: add / restore / reset / done. Only shown while editing. */
export function EditBar({ role, items, onChange, onReset, onDone }: Props) {
  const addOpen = useUi((s) => s.addOpen);
  const setAddOpen = useUi((s) => s.setAddOpen);
  const engines = useSim((s) => s.profile?.engines ?? 1);

  const add = (control: ControlId, engine: number) => {
    const { type, options } = defaultTypeFor(control);
    const size = controlTypes().find(([t]) => t === type)?.[1].size[role] ?? [3, 3];
    let n = 1;
    let id = `${type}-${control}-${engine}`;
    while (items.some((i) => i.id === id)) id = `${type}-${control}-${engine}-${++n}`;
    onChange([...items, { id, type, control, engine: engine > 1 ? engine : undefined, x: 0, y: 0, w: size[0], h: size[1], options }]);
    setAddOpen(false);
  };
  // two engines on one lever type can be added as a linked pair (engines 1+2, 3+4)
  const addPair = (control: ControlId, engine: number) => {
    const { options } = defaultTypeFor(control);
    const size = controlTypes().find(([t]) => t === 'leverPair')?.[1].size[role] ?? [6, 16];
    let n = 1;
    let id = `pair-${control}-${engine}`;
    while (items.some((i) => i.id === id)) id = `pair-${control}-${engine}-${++n}`;
    onChange([...items, { id, type: 'leverPair', control, engine: engine > 1 ? engine : undefined, x: 0, y: 0, w: size[0], h: size[1], options }]);
    setAddOpen(false);
  };

  // widgets that are not bound to a control (read-only instruments)
  const addInstrument = (type: string) => {
    const size = controlTypes().find(([t]) => t === type)?.[1].size[role] ?? [6, 6];
    let n = 1;
    let id = type;
    while (items.some((i) => i.id === id)) id = `${type}-${++n}`;
    onChange([...items, { id, type, control: null, x: 0, y: 0, w: size[0], h: size[1] }]);
    setAddOpen(false);
  };

  return (
    <div className="editbar ctl">
      <span className="eb-title">EDIT LAYOUT - drag, resize, hide</span>
      <button type="button" onPointerDown={(e) => { e.preventDefault(); setAddOpen(!addOpen); }}>ADD</button>
      <button type="button" onPointerDown={(e) => { e.preventDefault(); if (confirm('Reset this layout to the default?')) onReset(); }}>RESET</button>
      <button type="button" className="primary" onPointerDown={(e) => { e.preventDefault(); onDone(); }}>DONE</button>
      {addOpen && (
        <div className="addlist scroll">
          <button type="button" onPointerDown={(e) => { e.preventDefault(); addInstrument('attitude'); }}>Attitude indicator</button>
          {ADDABLE.flatMap((c) => {
            const def = CONTROLS[c];
            const n = def.perEngine ? engines : 1;
            const singles = Array.from({ length: n }, (_, i) => (
              <button key={`${c}${i}`} type="button" onPointerDown={(e) => { e.preventDefault(); add(c, i + 1); }}>
                {def.label}{n > 1 ? ` ${i + 1}` : ''}
              </button>
            ));
            const pairs = ['throttle', 'prop', 'mixture'].includes(c)
              ? Array.from({ length: Math.floor(n / 2) }, (_, i) => (
                <button key={`${c}pair${i}`} type="button" onPointerDown={(e) => { e.preventDefault(); addPair(c, i * 2 + 1); }}>
                  {def.label} {i * 2 + 1}+{i * 2 + 2} linked
                </button>
              ))
              : [];
            return [...singles, ...pairs];
          })}
        </div>
      )}
    </div>
  );
}

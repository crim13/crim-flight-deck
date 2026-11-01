import { PHONE_PAGE_IDS, type PhonePageId } from '@crim/shared';
import { usePhoneLayout } from '../hooks/useLayouts';
import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';
import { EditBar } from './EditBar';
import { LayoutCanvas } from './LayoutCanvas';

const NAMES: Record<PhonePageId, string> = { autopilot: 'AP', radios: 'RADIO', systems: 'SYS', quick: 'QUICK' };

/** Phone: portrait autopilot / radio / systems / quick-action pages with a row of push buttons as page selector. */
export function PhonePanel() {
  const { layout, canEdit, setItems, reset } = usePhoneLayout();
  const startPage = useSim((s) => s.device.startPage ?? s.shared.preferredStartPage);
  const pageSel = useUi((s) => s.phonePage);
  const setPage = useUi((s) => s.setPhonePage);
  const edit = useUi((s) => s.editMode) && canEdit;
  const setEdit = useUi((s) => s.setEdit);
  const current = pageSel ?? startPage;
  const page = layout.pages.find((p) => p.id === current) ?? layout.pages[0];

  return (
    <div className="panel phone">
      <div className="phone-page">
        {page && <LayoutCanvas grid={page.grid} items={page.items} edit={edit} onChange={(items) => setItems(page.id, items)} />}
      </div>
      {edit && page && <EditBar role="phone" items={page.items} onChange={(items) => setItems(page.id, items)} onReset={reset} onDone={() => setEdit(false)} />}
      <nav className="pagebar">
        {PHONE_PAGE_IDS.map((p) => (
          <button key={p} type="button" className={`ctl${p === current ? ' on' : ''}`} onPointerDown={(e) => { e.preventDefault(); setPage(p); }}>{NAMES[p]}</button>
        ))}
      </nav>
    </div>
  );
}

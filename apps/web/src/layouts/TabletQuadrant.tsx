import { PHONE_PAGE_IDS, type PhonePageId } from '@crim/shared';
import { useTabletLayout, useTabletPages } from '../hooks/useLayouts';
import { useUi } from '../stores/ui';
import { EditBar } from './EditBar';
import { LayoutCanvas } from './LayoutCanvas';

const NAMES: Record<'quadrant' | PhonePageId, string> = { quadrant: 'THR', autopilot: 'AP', radios: 'RADIO', systems: 'SYS', quick: 'QUICK' };
const PAGES: ('quadrant' | PhonePageId)[] = ['quadrant', ...PHONE_PAGE_IDS];

/**
 * Tablet: the virtual throttle quadrant plus the same pages as the phone (AP, radios, systems, quick),
 * laid out for landscape. A slim rail on the left switches pages, so the panels keep their full height.
 */
export function TabletQuadrant() {
  const quadrant = useTabletLayout();
  const pages = useTabletPages();
  const current = useUi((s) => s.tabletPage);
  const setPage = useUi((s) => s.setTabletPage);
  const edit = useUi((s) => s.editMode) && quadrant.canEdit;
  const setEdit = useUi((s) => s.setEdit);
  const page = current === 'quadrant' ? undefined : pages.layout.pages.find((p) => p.id === current);

  return (
    <div className="panel tablet">
      <nav className="pagerail">
        {PAGES.map((p) => (
          <button key={p} type="button" className={`ctl${p === current ? ' on' : ''}`} onPointerDown={(e) => { e.preventDefault(); setPage(p); }}>{NAMES[p]}</button>
        ))}
      </nav>
      <div className="tablet-page">
        {page
          ? <LayoutCanvas grid={page.grid} items={page.items} edit={edit} onChange={(items) => pages.setItems(page.id, items)} />
          : <LayoutCanvas grid={quadrant.layout.grid} items={quadrant.layout.items} edit={edit} onChange={quadrant.setItems} />}
      </div>
      {edit && (page
        ? <EditBar role="tablet" items={page.items} onChange={(items) => pages.setItems(page.id, items)} onReset={() => pages.reset(page.id)} onDone={() => setEdit(false)} />
        : <EditBar role="tablet" items={quadrant.layout.items} onChange={quadrant.setItems} onReset={quadrant.reset} onDone={() => setEdit(false)} />)}
    </div>
  );
}

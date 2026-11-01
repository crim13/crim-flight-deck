import { useMemo } from 'react';
import {
  TABLET_LAYOUT_REV, defaultPhoneLayout, defaultTabletLayout, defaultTabletPages, isTabletLayoutCurrent, normalizeItems,
  type LayoutItem, type PhoneLayout, type PhonePageId, type TabletLayout,
} from '@crim/shared';
import { saveDevice } from '../services/settings';
import { useSim } from '../stores/sim';

export function useTabletLayout() {
  const profile = useSim((s) => s.profile);
  const saved = useSim((s) => (s.profile ? s.device.tabletLayouts[s.profile.id] : undefined));
  const engineCount = useSim((s) => s.caps.engineCount);
  const usable = !!saved && isTabletLayoutCurrent(saved);
  const hasSaved = usable;
  const layout = useMemo<TabletLayout>(
    () => (usable && saved ? saved : defaultTabletLayout(profile, engineCount && engineCount > 0 ? engineCount : 4)),
    [usable, saved, profile, engineCount],
  );
  return {
    layout,
    hasSaved,
    canEdit: !!profile,
    setItems(items: LayoutItem[]) {
      if (!profile) return;
      saveDevice((d) => ({
        ...d,
        tabletLayouts: { ...d.tabletLayouts, [profile.id]: { version: 1, rev: TABLET_LAYOUT_REV, grid: layout.grid, items: normalizeItems(items, layout.grid) } },
      }));
    },
    reset() {
      if (!profile) return;
      saveDevice((d) => {
        const t = { ...d.tabletLayouts };
        delete t[profile.id];
        return { ...d, tabletLayouts: t };
      }, 50);
    },
  };
}

/** Tablet pages besides the throttle quadrant (AP, radios, systems, quick), per profile. */
export function useTabletPages() {
  const profile = useSim((s) => s.profile);
  const saved = useSim((s) => (s.profile ? s.device.tabletPages[s.profile.id] : undefined));
  const layout = useMemo<PhoneLayout>(() => saved ?? defaultTabletPages(), [saved]);
  return {
    layout,
    canEdit: !!profile,
    setItems(page: PhonePageId, items: LayoutItem[]) {
      if (!profile) return;
      const pages = layout.pages.map((p) => (p.id === page ? { ...p, items: normalizeItems(items, p.grid) } : p));
      saveDevice((d) => ({ ...d, tabletPages: { ...d.tabletPages, [profile.id]: { version: 1, pages } } }));
    },
    reset(page: PhonePageId) {
      if (!profile) return;
      const fresh = defaultTabletPages().pages.find((p) => p.id === page);
      const pages = layout.pages.map((p) => (p.id === page && fresh ? fresh : p));
      saveDevice((d) => ({ ...d, tabletPages: { ...d.tabletPages, [profile.id]: { version: 1, pages } } }), 50);
    },
  };
}

export function usePhoneLayout() {
  const profile = useSim((s) => s.profile);
  const saved = useSim((s) => (s.profile ? s.device.phoneLayouts[s.profile.id] : undefined));
  const layout = useMemo<PhoneLayout>(() => saved ?? defaultPhoneLayout(profile), [saved, profile]);
  return {
    layout,
    canEdit: !!profile,
    setItems(page: PhonePageId, items: LayoutItem[]) {
      if (!profile) return;
      const pages = layout.pages.map((p) => (p.id === page ? { ...p, items: normalizeItems(items, p.grid) } : p));
      saveDevice((d) => ({ ...d, phoneLayouts: { ...d.phoneLayouts, [profile.id]: { version: 1, pages } } }));
    },
    reset() {
      if (!profile) return;
      saveDevice((d) => {
        const t = { ...d.phoneLayouts };
        delete t[profile.id];
        return { ...d, phoneLayouts: t };
      }, 50);
    },
  };
}

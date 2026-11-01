import type { LayoutItem } from '@crim/shared';

export interface WidgetProps {
  item: LayoutItem;
}

/** Strip characters that are not valid inside an SVG id / url(#...) reference. */
export const svgId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

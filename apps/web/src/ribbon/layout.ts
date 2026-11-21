// The ribbon's responsive layout (M7-01, UI_SPEC.md §3, DEC-017): which breakpoint a viewport
// width is, how big each item shows there, and which panels give up room, in their order, when
// the ribbon is still short of it. Pure: the Ribbon component measures whether the panels fit
// and asks for one more compression step at a time until they do or none is left, after which
// the unprotected panels scroll sideways (the protected ones never do).
import type { ItemSize, RibbonItem, RibbonPanel, RibbonTab } from './ribbon.config';

export type Breakpoint = 'full' | 'wide' | 'laptop' | 'compact';

export const BREAKPOINTS: readonly Breakpoint[] = ['full', 'wide', 'laptop', 'compact'];

/** Item rows in a panel: the three-row labelled ribbon when full, two when wide, one below. */
export const ROWS: Readonly<Record<Breakpoint, number>> = {
  full: 3,
  wide: 2,
  laptop: 1,
  compact: 1,
};

/** The breakpoint of a viewport `width` in CSS pixels; below 1280 still compact. */
export function breakpointOf(width: number): Breakpoint {
  if (width >= 1920) return 'full';
  if (width >= 1600) return 'wide';
  if (width >= 1366) return 'laptop';
  return 'compact';
}

export function sizeAt(item: RibbonItem, bp: Breakpoint): ItemSize {
  return item.sizes[bp === 'compact' ? 'laptop' : bp];
}

/** A tab's panels that give up room, in the order they do. */
export function compressionOrder(tab: RibbonTab): RibbonPanel[] {
  return tab.panels
    .filter((p) => p.compress !== undefined)
    .sort((a, b) => a.compress!.order - b.compress!.order);
}

export interface PanelLayout {
  readonly panel: RibbonPanel;
  /** Its items are all protected: it is never compressed and never scrolls. */
  readonly protected: boolean;
  /**
   * `compressed`: shows the items its rule keeps and an overflow button listing the rest;
   * `collapsed`: one button listing the whole panel.
   */
  readonly state: 'expanded' | 'compressed' | 'collapsed';
  readonly shown: readonly { readonly item: RibbonItem; readonly size: ItemSize }[];
  readonly overflow: readonly RibbonItem[];
}

export interface TabLayout {
  readonly panels: readonly PanelLayout[];
  /** Every panel that can give up room has: more steps change nothing. */
  readonly exhausted: boolean;
}

/** `tab` at breakpoint `bp` with its first `steps` compressible panels compressed. */
export function layoutTab(tab: RibbonTab, bp: Breakpoint, steps: number): TabLayout {
  const order = compressionOrder(tab);
  const compressed = new Set(order.slice(0, Math.max(steps, 0)));
  return {
    exhausted: steps >= order.length,
    panels: tab.panels.map((panel) => {
      const isProtected = panel.items.length > 0 && panel.items.every((i) => i.protected);
      if (!compressed.has(panel)) {
        return {
          panel,
          protected: isProtected,
          state: 'expanded',
          shown: panel.items.map((item) => ({ item, size: sizeAt(item, bp) })),
          overflow: [],
        };
      }
      const keep = new Set(panel.compress!.keep);
      const kept = panel.items.filter((i) => keep.has(i.id));
      // The items kept show as icons: the panel is giving up room.
      return {
        panel,
        protected: false,
        state: kept.length ? 'compressed' : 'collapsed',
        shown: kept.map((item) => ({ item, size: 'icon' as const })),
        overflow: panel.items.filter((i) => !keep.has(i.id)),
      };
    }),
  };
}

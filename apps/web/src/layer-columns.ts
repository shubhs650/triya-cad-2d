// The Layer Properties Manager's columns (M5-05 part 3), as AutoCAD's: the user shows or hides
// them (right-click a column header, or Customize Layer Columns) and orders them, Name always
// shown; a click on a header sorts the layers by that column, a second click reverses it. AutoCAD
// keeps these in the user's profile, so Triya keeps them with the preferences.
// M5-05 part 5: each column has a width (AutoCAD's list sizes its columns, not their contents),
// set by dragging a header's edge or by the header menu's Maximize and Optimize items; a header
// dragged sideways moves its column; Freeze Column keeps the columns up to it from scrolling.
import type { Lineweight } from '@triya/engine';
import { compareNames, type LayerRow } from './layers';

export type LayerColumnKey =
  | 'status'
  | 'name'
  | 'on'
  | 'frozen'
  | 'locked'
  | 'vpFreeze'
  | 'plot'
  | 'color'
  | 'linetype'
  | 'lineweight'
  | 'transparency'
  | 'description'
  | 'vpColor'
  | 'vpLinetype'
  | 'vpLineweight'
  | 'vpTransparency';

export interface LayerColumn {
  readonly key: LayerColumnKey;
  readonly title: string;
  /** Shown only while a layout is (AutoCAD's VP columns). */
  readonly layoutOnly?: true;
  /** Its width (px) until the user sizes it: room for its widest usual content. */
  readonly width: number;
  /**
   * Its contents always fit its default width (a toggle, an icon, a lineweight, a percentage),
   * so its cells need not cut them until the column is narrowed (M5-13).
   */
  readonly fits?: true;
}

/** A column is never narrower than this (its header's edge stays draggable) nor wider than that. */
export const MIN_COLUMN_WIDTH = 24;
export const MAX_COLUMN_WIDTH = 1200;

/** AutoCAD's columns in its default order. */
export const LAYER_COLUMNS: readonly LayerColumn[] = [
  { key: 'status', title: 'Status', width: 56, fits: true },
  { key: 'name', title: 'Name', width: 180 },
  { key: 'on', title: 'On', width: 88, fits: true },
  { key: 'frozen', title: 'Freeze', width: 88, fits: true },
  { key: 'locked', title: 'Lock', width: 88, fits: true },
  { key: 'vpFreeze', title: 'VP Freeze', layoutOnly: true, width: 88, fits: true },
  { key: 'plot', title: 'Plot', width: 88, fits: true },
  { key: 'color', title: 'Color', width: 110 },
  { key: 'linetype', title: 'Linetype', width: 130 },
  { key: 'lineweight', title: 'Lineweight', width: 110, fits: true },
  { key: 'transparency', title: 'Transparency', width: 110, fits: true },
  { key: 'description', title: 'Description', width: 200 },
  // M6-02 part 8: the viewport made current's overrides (AutoCAD's VP Plot Style is left out,
  // as Triya does not plot by named plot style).
  { key: 'vpColor', title: 'VP Color', layoutOnly: true, width: 110 },
  { key: 'vpLinetype', title: 'VP Linetype', layoutOnly: true, width: 130 },
  { key: 'vpLineweight', title: 'VP Lineweight', layoutOnly: true, width: 110, fits: true },
  { key: 'vpTransparency', title: 'VP Transparency', layoutOnly: true, width: 120, fits: true },
];

const COLUMN = new Map(LAYER_COLUMNS.map((c) => [c.key, c]));
const KEYS = LAYER_COLUMNS.map((c) => c.key);

/** AutoCAD never hides the Name column. */
export const hideableLayerColumn = (key: LayerColumnKey): boolean => key !== 'name';

export interface LayerSort {
  readonly key: LayerColumnKey;
  readonly descending: boolean;
}

export interface LayerColumnSettings {
  /** Every column, in the order shown. */
  readonly order: readonly LayerColumnKey[];
  readonly hidden: readonly LayerColumnKey[];
  readonly sort: LayerSort;
  /** The widths (px) the user gave columns; the others have their default width. */
  readonly widths: Readonly<Partial<Record<LayerColumnKey, number>>>;
  /** Freeze Column: this column and the ones before it do not scroll sideways. */
  readonly frozen?: LayerColumnKey;
  /** The filter tree beside the list collapsed (M5-07 part 5), kept with the columns. */
  readonly treeCollapsed?: true;
}

export const DEFAULT_LAYER_COLUMNS: LayerColumnSettings = {
  order: KEYS,
  hidden: [],
  sort: { key: 'name', descending: false },
  widths: {},
};

const clampWidth = (w: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(w)));

const isKey = (v: unknown): v is LayerColumnKey =>
  typeof v === 'string' && COLUMN.has(v as LayerColumnKey);

/**
 * Stored settings as settings: unknown columns dropped, each column once, and a column the
 * stored order lacks (one a later version adds) put after the column it follows by default.
 */
export function normalizeLayerColumns(raw: unknown): LayerColumnSettings {
  const d = DEFAULT_LAYER_COLUMNS;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const order: LayerColumnKey[] = [];
  for (const k of Array.isArray(r['order']) ? r['order'] : [])
    if (isKey(k) && !order.includes(k)) order.push(k);
  if (order.length === 0) order.push(...d.order);
  KEYS.forEach((k, i) => {
    if (order.includes(k)) return;
    const before = KEYS.slice(0, i)
      .reverse()
      .find((b) => order.includes(b));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, k);
  });
  const hidden = (Array.isArray(r['hidden']) ? r['hidden'] : []).filter(
    (k, i, all): k is LayerColumnKey => isKey(k) && hideableLayerColumn(k) && all.indexOf(k) === i,
  );
  const s = typeof r['sort'] === 'object' && r['sort'] !== null ? r['sort'] : {};
  const key = (s as Record<string, unknown>)['key'];
  const sort = isKey(key)
    ? { key, descending: (s as Record<string, unknown>)['descending'] === true }
    : d.sort;
  const widths: Partial<Record<LayerColumnKey, number>> = {};
  const w = r['widths'];
  if (typeof w === 'object' && w !== null && !Array.isArray(w))
    for (const [k, v] of Object.entries(w))
      if (isKey(k) && typeof v === 'number' && Number.isFinite(v)) widths[k] = clampWidth(v);
  const frozen = isKey(r['frozen']) ? r['frozen'] : undefined;
  return {
    order,
    hidden,
    sort,
    widths,
    ...(frozen && { frozen }),
    ...(r['treeCollapsed'] === true && { treeCollapsed: true as const }),
  };
}

/** Column `key`'s width (px): the user's, or its default. */
export const layerColumnWidth = (s: LayerColumnSettings, key: LayerColumnKey): number =>
  s.widths[key] ?? COLUMN.get(key)!.width;

/** The settings with `widths` given to those columns, each kept within bounds. */
export function withLayerColumnWidths(
  s: LayerColumnSettings,
  widths: Readonly<Partial<Record<LayerColumnKey, number>>>,
): LayerColumnSettings {
  const next = { ...s.widths };
  for (const [k, v] of Object.entries(widths) as [LayerColumnKey, number][])
    next[k] = clampWidth(v);
  return { ...s, widths: next };
}

/** The rows' grid tracks: each column shown at its width, in order (M5-13). */
export const layerColumnTracks = (
  s: LayerColumnSettings,
  visible: readonly LayerColumn[],
): string => visible.map((c) => `${layerColumnWidth(s, c.key)}px`).join(' ');

/**
 * The columns shown whose cells cut their contents at the column's edge: those whose text can be
 * any length, and the others once narrowed below their default width. A cell that cuts is a clip
 * of its own to lay out and paint, so the cells that never need it go without (M5-13: about a
 * third of the time taken to show the rows again after a search).
 */
export const cutLayerColumns = (
  s: LayerColumnSettings,
  visible: readonly LayerColumn[],
): LayerColumnKey[] =>
  visible.filter((c) => !c.fits || layerColumnWidth(s, c.key) < c.width).map((c) => c.key);

/**
 * Maximize: the list's width left over once every column fits its contents (`fitted`), shared
 * equally among the columns `grow` (a pixel the division leaves goes to the last). AutoCAD's help
 * describes Maximize and Optimize in nearly the same words ("to maximize the display of the column
 * content"); Triya's Optimize fits a column to its contents and Maximize also fills the list's
 * width, so that the two differ in a way a drafter can see.
 */
export function maximizedWidths<K extends string>(
  fitted: Readonly<Record<K, number>>,
  grow: readonly K[],
  available: number,
): Record<K, number> {
  const next = { ...fitted } as Record<K, number>;
  const used = (Object.values(fitted) as number[]).reduce((a, b) => a + b, 0);
  const free = Math.floor(available - used);
  if (free <= 0 || grow.length === 0) return next;
  const each = Math.floor(free / grow.length);
  grow.forEach((k, i) => {
    next[k] = fitted[k] + each + (i === grow.length - 1 ? free - each * grow.length : 0);
  });
  return next;
}

/**
 * Freeze Column: the visible columns up to and including the frozen one, each with its offset
 * from the list's left edge (the widths of the frozen columns before it). None when no column is
 * frozen or the frozen column is not shown.
 */
export function frozenLayerColumns(
  s: LayerColumnSettings,
  visible: readonly LayerColumn[],
): Map<LayerColumnKey, number> {
  const frozen = new Map<LayerColumnKey, number>();
  const last = visible.findIndex((c) => c.key === s.frozen);
  let left = 0;
  for (const c of visible.slice(0, last + 1)) {
    frozen.set(c.key, left);
    left += layerColumnWidth(s, c.key);
  }
  return frozen;
}

/** The columns the manager shows, in order. */
export function visibleLayerColumns(s: LayerColumnSettings, inLayout: boolean): LayerColumn[] {
  return s.order
    .map((k) => COLUMN.get(k)!)
    .filter((c) => !s.hidden.includes(c.key) && (inLayout || !c.layoutOnly));
}

/** Customize Layer Columns' Move Up (-1) and Move Down (1). */
export function moveLayerColumn(
  order: readonly LayerColumnKey[],
  key: LayerColumnKey,
  by: -1 | 1,
): LayerColumnKey[] {
  const next = [...order];
  const i = next.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** A header dragged onto another: its column goes before that one (`undefined`: last). */
export function moveLayerColumnBefore(
  order: readonly LayerColumnKey[],
  key: LayerColumnKey,
  before: LayerColumnKey | undefined,
): LayerColumnKey[] {
  if (key === before) return [...order];
  const next = order.filter((k) => k !== key);
  const at = before === undefined ? -1 : next.indexOf(before);
  next.splice(at < 0 ? next.length : at, 0, key);
  return next;
}

/** A click on a column's header: the same column reverses, another sorts by it ascending. */
export const sortAfterClick = (sort: LayerSort, key: LayerColumnKey): LayerSort =>
  sort.key === key ? { key, descending: !sort.descending } : { key, descending: false };

/** A lineweight's order: Default first (it is DXF -3), then by width. */
const lineweightOrder = (w: Lineweight): number =>
  typeof w === 'number' ? w : w === 'Default' ? -3 : w === 'ByBlock' ? -2 : -1;

/** A colour's order: ACI by number, then true colours (and colour-book colours) by label. */
const colorOrder = (r: Pick<LayerRow, 'value'>): number => {
  const c = r.value.color;
  return c.kind === 'aci' ? c.index : 256;
};

const text = (a: string, b: string) => compareNames(a, b);
const flag = (a: boolean, b: boolean) => Number(b) - Number(a);

/**
 * How two rows compare on a column, ascending. AutoCAD's help does not say which way a toggle
 * column sorts; ascending here puts the state the column is named for first (On, Frozen, Locked,
 * Plot), and Status the current layer first, as a drafter sorting by Freeze looks for frozen ones.
 */
const COMPARE: Record<LayerColumnKey, (a: LayerRow, b: LayerRow) => number> = {
  status: (a, b) => flag(a.current, b.current),
  name: () => 0,
  on: (a, b) => flag(a.on, b.on),
  frozen: (a, b) => flag(a.frozen, b.frozen),
  locked: (a, b) => flag(a.locked, b.locked),
  vpFreeze: (a, b) => (a.vpFrozen?.frozen ?? 0) - (b.vpFrozen?.frozen ?? 0),
  plot: (a, b) => flag(a.plot, b.plot),
  color: (a, b) => colorOrder(a) - colorOrder(b) || text(a.color.label, b.color.label),
  linetype: (a, b) => text(a.linetype, b.linetype),
  lineweight: (a, b) => lineweightOrder(a.value.lineweight) - lineweightOrder(b.value.lineweight),
  transparency: (a, b) => Number(a.transparency) - Number(b.transparency),
  // In paper space (no VP cells) every row ties, and the rows keep their order by name.
  vpColor: (a, b) =>
    a.vp && b.vp
      ? colorOrder(a.vp) - colorOrder(b.vp) || text(a.vp.color.label, b.vp.color.label)
      : 0,
  vpLinetype: (a, b) => (a.vp && b.vp ? text(a.vp.linetype, b.vp.linetype) : 0),
  vpLineweight: (a, b) =>
    a.vp && b.vp
      ? lineweightOrder(a.vp.value.lineweight) - lineweightOrder(b.vp.value.lineweight)
      : 0,
  vpTransparency: (a, b) =>
    a.vp && b.vp ? Number(a.vp.transparency) - Number(b.vp.transparency) : 0,
  description: (a, b) => text(a.description, b.description),
};

/** The rows sorted by `sort`, ties by name; a descending sort is the ascending one reversed. */
export function sortLayerRows(rows: readonly LayerRow[], sort: LayerSort): LayerRow[] {
  const compare = COMPARE[sort.key];
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => sign * (compare(a, b) || text(a.name, b.name)));
}

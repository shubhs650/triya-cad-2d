// The Layer Properties Manager's columns (M5-05 part 3), as AutoCAD's: the user shows or hides
// them (right-click a column header, or Customize Layer Columns) and orders them, Name always
// shown; a click on a header sorts the layers by that column, a second click reverses it. AutoCAD
// keeps these in the user's profile, so Triya keeps them with the preferences.
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
  | 'description';

export interface LayerColumn {
  readonly key: LayerColumnKey;
  readonly title: string;
  /** Shown only while a layout is (AutoCAD's VP columns). */
  readonly layoutOnly?: true;
}

/** AutoCAD's columns in its default order. */
export const LAYER_COLUMNS: readonly LayerColumn[] = [
  { key: 'status', title: 'Status' },
  { key: 'name', title: 'Name' },
  { key: 'on', title: 'On' },
  { key: 'frozen', title: 'Freeze' },
  { key: 'locked', title: 'Lock' },
  { key: 'vpFreeze', title: 'VP Freeze', layoutOnly: true },
  { key: 'plot', title: 'Plot' },
  { key: 'color', title: 'Color' },
  { key: 'linetype', title: 'Linetype' },
  { key: 'lineweight', title: 'Lineweight' },
  { key: 'transparency', title: 'Transparency' },
  { key: 'description', title: 'Description' },
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
}

export const DEFAULT_LAYER_COLUMNS: LayerColumnSettings = {
  order: KEYS,
  hidden: [],
  sort: { key: 'name', descending: false },
};

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
  return { order, hidden, sort };
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

/** A click on a column's header: the same column reverses, another sorts by it ascending. */
export const sortAfterClick = (sort: LayerSort, key: LayerColumnKey): LayerSort =>
  sort.key === key ? { key, descending: !sort.descending } : { key, descending: false };

/** A lineweight's order: Default first (it is DXF -3), then by width. */
const lineweightOrder = (w: Lineweight): number =>
  typeof w === 'number' ? w : w === 'Default' ? -3 : w === 'ByBlock' ? -2 : -1;

/** A colour's order: ACI by number, then true colours (and colour-book colours) by label. */
const colorOrder = (r: LayerRow): number => {
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
  description: (a, b) => text(a.description, b.description),
};

/** The rows sorted by `sort`, ties by name; a descending sort is the ascending one reversed. */
export function sortLayerRows(rows: readonly LayerRow[], sort: LayerSort): LayerRow[] {
  const compare = COMPARE[sort.key];
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => sign * (compare(a, b) || text(a.name, b.name)));
}

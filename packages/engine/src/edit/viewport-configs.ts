// Model space's viewport configurations (M6-02 part 10): the tiles of the current one are the
// `*Active` VPORT records, a named one's records share its name, each with its corners on the
// screen (DXF 10/11, 0–1 from the lower left) and its view (AutoCAD DXF reference, VPORT;
// AutoCAD 2024 Help, "-VPORTS - Model Space Viewports"). -VPORTS saves, restores, deletes and
// rearranges them; MVIEW Restore lays one out as layout viewports.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import { ACTIVE_VPORT, isActiveVport, modelTiles } from '../layout/model-tiles';
import type { ChangeSetBuilder as ChangeBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { VportRecord } from '../model/types';
import type { ViewExtent } from './named-view';

/**
 * One tile of a configuration to write: the record whose settings it carries (snap, grid, UCS,
 * view direction), its corners (0–1 of the drawing area, origin at the lower left) and the view
 * it shows in world coordinates, when that is not the record's own.
 */
export interface ConfigTile {
  readonly source: VportRecord;
  readonly corners: Box;
  readonly view?: ViewExtent;
}

/** A named configuration: its name as its first record has it, and its records in table order. */
export interface ViewportConfiguration {
  readonly name: string;
  readonly records: readonly VportRecord[];
}

/** The drawing's named viewport configurations (every VPORT name but `*Active`), by name. */
export function viewportConfigurations(vports: Iterable<VportRecord>): ViewportConfiguration[] {
  const byName = new Map<string, VportRecord[]>();
  for (const v of vports) {
    if (isActiveVport(v)) continue;
    const key = v.name.toUpperCase();
    const list = byName.get(key);
    if (list) list.push(v);
    else byName.set(key, [v]);
  }
  return [...byName.values()]
    .map((records) => ({ name: records[0]!.name, records }))
    .sort((a, b) => (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1));
}

/** The configuration named `name` (case ignored), if the drawing has it. */
export function viewportConfiguration(
  model: DocumentModel,
  name: string,
): ViewportConfiguration | undefined {
  const key = name.toUpperCase();
  return viewportConfigurations(model.tables.vports.values()).find(
    (c) => c.name.toUpperCase() === key,
  );
}

const plan = (v: VportRecord): boolean => {
  const d = v.direction;
  const len = Math.hypot(d.x, d.y, d.z);
  return d.z > 0 && Math.abs(d.x) <= 1e-9 * len && Math.abs(d.y) <= 1e-9 * len && v.twist === 0;
};

/**
 * The tiles of the configuration named `name` as written: corners from its records and each
 * view the record's own, the current (first) tile first. A single tile fills the screen, as
 * `modelTiles` shows it whatever corners it states.
 */
export function configurationTiles(
  vports: Iterable<VportRecord>,
  name: string = ACTIVE_VPORT,
  views?: readonly (ViewExtent | null | undefined)[],
): ConfigTile[] {
  const out: ConfigTile[] = [];
  modelTiles(vports, name).forEach((t, i) => {
    if (!t.vport) return;
    const { left, top, width, height } = t.rect;
    const corners = { minX: left, minY: 1 - top - height, maxX: left + width, maxY: 1 - top };
    const view = views?.[i];
    out.push({ source: t.vport, corners, ...(view && { view }) });
  });
  return out;
}

/** The view a record shows in world coordinates (its centre is in display coordinates). */
export function recordView(v: VportRecord): ViewExtent {
  return {
    center: { x: v.center.x + v.target.x, y: v.center.y + v.target.y },
    height: v.height,
    width: v.height * v.aspectRatio,
  };
}

const finiteView = (v: ViewExtent): boolean =>
  v.height > 0 && v.width > 0 && [v.center.x, v.center.y, v.height, v.width].every(Number.isFinite);

/** A record of `name` for `tile`: its source's settings, its corners and, in plan, its view. */
function tileRecord(name: string, tile: ConfigTile): Omit<VportRecord, 'handle'> {
  const { handle: _h, ...source } = tile.source;
  const { minX, minY, maxX, maxY } = tile.corners;
  const v = tile.view;
  const view =
    v && plan(tile.source) && finiteView(v)
      ? {
          center: { x: v.center.x - source.target.x, y: v.center.y - source.target.y },
          height: v.height,
          aspectRatio: v.width / v.height,
        }
      : {};
  return {
    ...source,
    name,
    lowerLeft: { x: minX, y: minY },
    upperRight: { x: maxX, y: maxY },
    ...view,
  };
}

/**
 * Writes `tiles` as the configuration `name` (the current one for `*Active`), the first being
 * its current viewport: the records it has are updated in table order, keeping their handles (so
 * the first `*Active`, which the DXF reference makes the current viewport, stays first), and the
 * rest added or removed.
 */
export function writeConfiguration(
  b: ChangeBuilder,
  model: DocumentModel,
  name: string,
  tiles: readonly ConfigTile[],
): void {
  const key = name.toUpperCase();
  const existing = [...model.tables.vports.values()].filter((v) => v.name.toUpperCase() === key);
  tiles.forEach((t, i) => {
    const record = tileRecord(name, t);
    const old = existing[i];
    if (old) b.updateTableRecord('vports', old.handle, record);
    else b.addTableRecord('vports', record);
  });
  for (const old of existing.slice(tiles.length)) b.removeTableRecord('vports', old.handle);
}

/** Removes the configuration named `name`; never the current one. */
export function deleteConfiguration(b: ChangeBuilder, model: DocumentModel, name: string): void {
  const key = name.toUpperCase();
  if (key === ACTIVE_VPORT.toUpperCase()) return;
  for (const v of [...model.tables.vports.values()])
    if (v.name.toUpperCase() === key) b.removeTableRecord('vports', v.handle);
}

/** `corners` (0–1 from the lower left) as a box within `area`. */
export function cornersIn(corners: Box, area: Box): Box {
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;
  return {
    minX: area.minX + corners.minX * w,
    minY: area.minY + corners.minY * h,
    maxX: area.minX + corners.maxX * w,
    maxY: area.minY + corners.maxY * h,
  };
}

/**
 * `view`, shown in a tile of `from` corners, in one of `to` corners: the same centre and height
 * (AutoCAD's 2D setup starts each new viewport with the current view, VIEWSIZE kept), and the
 * width the new tile's shape on the same screen gives.
 */
export function viewInTile(view: ViewExtent, from: Box, to: Box): ViewExtent {
  const ratio = (b: Box) => (b.maxX - b.minX) / (b.maxY - b.minY);
  return { ...view, width: (view.width * ratio(to)) / ratio(from) };
}

/** Corners as AutoCAD's `?` lists them: four decimal places, lower left then upper right. */
export function cornersText(c: Box): string {
  const p = (v: Vec2) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
  return `${p({ x: c.minX, y: c.minY })} ${p({ x: c.maxX, y: c.maxY })}`;
}

const matches = (name: string, patterns: string): boolean =>
  patterns
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .some((p) => {
      const re = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${re}$`, 'i').test(name);
    });

/** The named configurations whose names match `patterns` (`*`, `?`; comma separated). */
export function configurationsMatching(
  vports: Iterable<VportRecord>,
  patterns: string,
): ViewportConfiguration[] {
  return viewportConfigurations(vports).filter((c) => matches(c.name, patterns));
}

/**
 * The lines `?` lists, as AutoCAD's -VPORTS lists them ("Displays the identification numbers
 * and screen positions of the active viewports"): the current configuration's tiles, the current
 * one first, each by its number (CVPORT's: 2 on for model space's tiles, in the order they are
 * placed) and corners; then each named configuration matching `patterns`, its tiles' corners.
 */
export function configurationLines(
  vports: Iterable<VportRecord>,
  patterns: string,
  current = 0,
): string[] {
  const all = [...vports];
  const tiles = configurationTiles(all);
  const out: string[] = [];
  if (tiles.length > 0) {
    out.push('Current configuration:');
    const order = [current, ...tiles.keys()].filter((i, k, a) => a.indexOf(i) === k && tiles[i]);
    for (const i of order) {
      out.push(`  id# ${i + 2}`);
      out.push(`  corners: ${cornersText(tiles[i]!.corners)}`);
    }
  }
  for (const c of configurationsMatching(all, patterns)) {
    out.push(`Configuration ${c.name}:`);
    for (const t of configurationTiles(all, c.name)) out.push(`  ${cornersText(t.corners)}`);
  }
  return out;
}

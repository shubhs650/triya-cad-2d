// The Layers palette's rows (M1-23): the main thread's mirror of a drawing's LAYER table,
// rebuilt from the layers as opened plus every change its engine applied since (the engine
// worker holds the document itself, M1-67).
// The Layer Properties Manager's property cells (M5-05 part 2) read each row's colour,
// linetype, lineweight and transparency as values to edit, the loaded linetypes Select Linetype
// lists and the colour books Select Color offers.
import {
  colorValue,
  transparencyValue,
  type ChangeSet,
  type Color,
  type ColorBook,
  type ColorBookColor,
  type DocumentInit,
  type Handle,
  type LayerRecord,
  type LinetypeElement,
  type LinetypeRecord,
  type Lineweight,
  type KeyedChanges,
  type TableRecords,
  type Transparency,
} from '@triya/engine';
import { aciRgb, rgbHex } from '@triya/render';

export interface LayerRow {
  readonly handle: Handle;
  readonly name: string;
  /** The current layer ($CLAYER), which new objects go on. */
  readonly current: boolean;
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly plot: boolean;
  /** How the palette shows the colour: AutoCAD's name or number, and a swatch colour. */
  readonly color: { readonly label: string; readonly css: string };
  readonly linetype: string;
  readonly lineweight: string;
  /** What AutoCAD's Layer Properties Manager shows as Description (M1-104); '' for none. */
  readonly description: string;
  /** The Transparency column: AutoCAD's percentage, 0 (opaque) to 90. */
  readonly transparency: string;
  /** What the Color, Linetype, Lineweight and Transparency cells edit. */
  readonly value: {
    readonly color: Color;
    readonly linetype: Handle;
    readonly lineweight: Lineweight;
    readonly transparency: Transparency;
  };
  /** In a layout: of its viewports (not its own paper-space view), how many freeze the layer. */
  readonly vpFrozen?: { readonly frozen: number; readonly of: number };
}

/** AutoCAD names ACI 1–7 in the colour column; others show their number. */
const ACI_NAMES = ['', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];

function colorCell(c: Color): LayerRow['color'] {
  // A colour-book colour shows its name (DIC 7), a true colour its RGB, as AutoCAD's manager does.
  if (c.kind === 'rgb')
    return { label: c.colorName || `${c.r},${c.g},${c.b}`, css: rgbHex([c.r, c.g, c.b]) };
  if (c.kind === 'aci' && c.index >= 1 && c.index <= 255)
    return { label: ACI_NAMES[c.index] ?? String(c.index), css: rgbHex(aciRgb(c.index)) };
  // A layer's colour is never ByLayer or ByBlock; show what a damaged file holds plainly.
  return { label: c.kind, css: 'transparent' };
}

const lineweightCell = (w: LayerRecord['lineweight']): string =>
  typeof w === 'number' ? `${(w / 100).toFixed(2)} mm` : w;

/** Table `table` as opened with `changes` applied in order. */
function currentTable<K extends 'layers' | 'linetypes'>(
  opened: readonly TableRecords[K][] | undefined,
  changes: readonly ChangeSet[],
  table: K,
): TableRecords[K][] {
  const records = new Map<Handle, TableRecords[K]>();
  for (const r of opened ?? []) records.set(r.handle, r);
  for (const cs of changes) {
    const c = cs.tables?.[table] as KeyedChanges<TableRecords[K]> | undefined;
    for (const r of c?.removed ?? []) records.delete(r.handle);
    for (const a of c?.added ?? []) records.set(a.handle, a);
    for (const u of c?.updated ?? []) records.set(u.after.handle, u.after);
  }
  return [...records.values()];
}

/** The LAYER table as opened with `changes` applied in order. */
const currentLayers = (init: DocumentInit, changes: readonly ChangeSet[]): LayerRecord[] =>
  currentTable(init.tables?.layers, changes, 'layers');

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * The linetypes Select Linetype lists as loaded, by name: the LTYPE table as changed, without
 * its ByLayer and ByBlock records, which a layer cannot take.
 */
export function layerLinetypes(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): LinetypeRecord[] {
  return currentTable(init.tables?.linetypes, changes, 'linetypes')
    .filter((l) => !/^by(layer|block)$/i.test(l.name))
    .sort(byName);
}

/**
 * The colour books Select Color's Color Books tab offers from the manager: those the layers'
 * colours come from, each with the colours of it the layers use. (The Properties palette's
 * `colorBooks` reads every object's colour in the engine worker; the manager's mirror holds the
 * LAYER table only, which is where a layer's colour can come from.)
 */
export function layerColorBooks(init: DocumentInit, changes: readonly ChangeSet[]): ColorBook[] {
  const books = new Map<string, { name: string; colors: Map<string, ColorBookColor> }>();
  for (const { color: c } of currentLayers(init, changes)) {
    if (c.kind !== 'rgb' || c.bookName === undefined || !c.colorName) continue;
    const key = c.bookName.toUpperCase();
    const book = books.get(key) ?? { name: c.bookName, colors: new Map() };
    books.set(key, book);
    book.colors.set(c.colorName.toUpperCase(), {
      name: c.colorName,
      value: colorValue(c),
      rgb: [c.r, c.g, c.b],
    });
  }
  return [...books.values()]
    .map((b) => ({ name: b.name, colors: [...b.colors.values()].sort(byName) }))
    .sort(byName);
}

/** The Layer Transparency dialog's field: a whole percentage 0–90, or why it is refused. */
export function parseLayerTransparency(text: string): number | string {
  const t = text.trim();
  const n = Number(t);
  return /^\d+$/.test(t) && n <= 90 ? n : 'Transparency value must be between 0 and 90.';
}

/** How many times Select Linetype's Appearance column repeats a linetype's pattern. */
const APPEARANCE_REPEATS = 4;

/**
 * A linetype's Appearance as an SVG dash array `width` pixels long for its pattern four times:
 * dashes and gaps in proportion, a dot 1 px. Undefined for a continuous line (no elements).
 * Shapes and text in a complex linetype show as the gap they sit in.
 */
export function linetypeDashes(
  elements: readonly LinetypeElement[],
  width: number,
): number[] | undefined {
  const period = elements.reduce((sum, e) => sum + Math.abs(e.length), 0);
  if (elements.length === 0 || period <= 0) return undefined;
  const scale = width / APPEARANCE_REPEATS / period;
  return elements.map((e) => (e.length === 0 ? 1 : Math.abs(e.length) * scale));
}

/** The palette rows by name, as AutoCAD sorts them; `block` is the layout shown, if any. */
export function layerRows(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  block?: Handle,
): LayerRow[] {
  // The current layer as the changes left it: the Properties palette sets it (M2-35).
  let current = new Map(init.header ?? []).get('$CLAYER');
  for (const cs of changes)
    for (const h of cs.header ?? []) if (h.name === '$CLAYER') current = h.after;
  const currentName = typeof current === 'string' ? current.toUpperCase() : undefined;
  const linetypes = new Map(
    currentTable(init.tables?.linetypes, changes, 'linetypes').map((l) => [l.handle, l.name]),
  );
  const viewports =
    block === undefined
      ? undefined
      : (init.entities ?? []).flatMap((e) =>
          e.owner === block && e.geom.kind === 'VIEWPORT' && e.geom.id !== 1
            ? [e.geom.frozenLayers]
            : [],
        );
  return currentLayers(init, changes)
    .sort(byName)
    .map((l) => ({
      handle: l.handle,
      name: l.name,
      current: l.name.toUpperCase() === currentName,
      on: l.on,
      frozen: l.frozen,
      locked: l.locked,
      plot: l.plot,
      color: colorCell(l.color),
      linetype: linetypes.get(l.linetype) ?? l.linetype,
      lineweight: lineweightCell(l.lineweight),
      description: l.description ?? '',
      transparency: String(transparencyValue(l.transparency)),
      value: {
        color: l.color,
        linetype: l.linetype,
        lineweight: l.lineweight,
        transparency: l.transparency,
      },
      ...(viewports && {
        vpFrozen: {
          frozen: viewports.filter((f) => f.includes(l.handle)).length,
          of: viewports.length,
        },
      }),
    }));
}

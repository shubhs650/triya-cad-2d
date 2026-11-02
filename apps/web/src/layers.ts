// The Layers palette's rows (M1-23): the main thread's mirror of a drawing's LAYER table,
// rebuilt from the layers as opened plus every change its engine applied since (the engine
// worker holds the document itself, M1-67).
import type { ChangeSet, Color, DocumentInit, Handle, LayerRecord } from '@triya/engine';
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
  /** In a layout: of its viewports (not its own paper-space view), how many freeze the layer. */
  readonly vpFrozen?: { readonly frozen: number; readonly of: number };
}

/** AutoCAD names ACI 1–7 in the colour column; others show their number. */
const ACI_NAMES = ['', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];

function colorCell(c: Color): LayerRow['color'] {
  if (c.kind === 'rgb') return { label: `${c.r},${c.g},${c.b}`, css: rgbHex([c.r, c.g, c.b]) };
  if (c.kind === 'aci' && c.index >= 1 && c.index <= 255)
    return { label: ACI_NAMES[c.index] ?? String(c.index), css: rgbHex(aciRgb(c.index)) };
  // A layer's colour is never ByLayer or ByBlock; show what a damaged file holds plainly.
  return { label: c.kind, css: 'transparent' };
}

const lineweightCell = (w: LayerRecord['lineweight']): string =>
  typeof w === 'number' ? `${(w / 100).toFixed(2)} mm` : w;

/** The LAYER table as opened with `changes` applied in order. */
function currentLayers(init: DocumentInit, changes: readonly ChangeSet[]): LayerRecord[] {
  const layers = new Map<Handle, LayerRecord>();
  for (const l of init.tables?.layers ?? []) layers.set(l.handle, l);
  for (const cs of changes) {
    const c = cs.tables?.layers;
    for (const r of c?.removed ?? []) layers.delete(r.handle);
    for (const a of c?.added ?? []) layers.set(a.handle, a);
    for (const u of c?.updated ?? []) layers.set(u.after.handle, u.after);
  }
  return [...layers.values()];
}

/** The palette rows by name, as AutoCAD sorts them; `block` is the layout shown, if any. */
export function layerRows(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  block?: Handle,
): LayerRow[] {
  const current = new Map(init.header ?? []).get('$CLAYER');
  const currentName = typeof current === 'string' ? current.toUpperCase() : undefined;
  const linetypes = new Map((init.tables?.linetypes ?? []).map((l) => [l.handle, l.name]));
  const viewports =
    block === undefined
      ? undefined
      : (init.entities ?? []).flatMap((e) =>
          e.owner === block && e.geom.kind === 'VIEWPORT' && e.geom.id !== 1
            ? [e.geom.frozenLayers]
            : [],
        );
  return currentLayers(init, changes)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
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
      ...(viewports && {
        vpFrozen: {
          frozen: viewports.filter((f) => f.includes(l.handle)).length,
          of: viewports.length,
        },
      }),
    }));
}

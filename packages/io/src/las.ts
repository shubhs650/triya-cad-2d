// Layer state files (`.las`, M5-07): the Layer States Manager's Import and Export. A `.las` file
// is DXF-like text, group code and value on alternate lines: `0 LAYERSTATEDICTIONARY`, then for
// each state `0 LAYERSTATE` and the groups an `ACAD_LAYERSTATES` XRECORD holds (map/layer-states.ts),
// with the layer state's name in 1, each layer by name (8) and its linetype by name (6) and plot
// style in 2; `0 EOF` ends it. AutoCAD exports one state per file; a file holding more imports
// them all.
import type { LayerState, LayerStateInit, LayerStateTables } from '@triya/engine';
import { layerEntryValues, layerStateFields, type Group } from './map/layer-states';

/** Why a file is not a layer state file. */
export class LasError extends Error {
  override readonly name = 'LasError';
}

const DICTIONARY = 'LAYERSTATEDICTIONARY';
const STATE = 'LAYERSTATE';
const EOF = 'EOF';

/** The code/value pairs of `text`. */
function groups(text: string): Group[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) throw new LasError(`Line ${i + 1} is not a group code.`);
    out.push({ code, value: lines[i + 1]! });
  }
  return out;
}

/** The layer states a `.las` file holds, in its order. */
export function parseLas(text: string): LayerStateInit[] {
  const all = groups(text);
  if (all[0]?.code !== 0 || String(all[0].value).trim() !== DICTIONARY)
    throw new LasError('Not a layer state file.');
  const out: LayerStateInit[] = [];
  let i = 1;
  while (i < all.length) {
    const g = all[i]!;
    const kind = String(g.value).trim();
    if (g.code !== 0) throw new LasError(`Unexpected group ${g.code}.`);
    if (kind === EOF) break;
    if (kind !== STATE) throw new LasError(`Unexpected ${kind}.`);
    let end = i + 1;
    while (end < all.length && all[end]!.code !== 0) end++;
    const body = all.slice(i + 1, end).map((x) => ({
      code: x.code,
      // Names and descriptions keep their spaces; numbers are trimmed by the reader.
      value: x.value,
    }));
    const name = String(body.find((x) => x.code === 1)?.value ?? '');
    if (name === '') throw new LasError('A layer state has no name.');
    // Group 1 names the state before the first layer; after it, 1 is not used (2 is the style).
    const first = body.findIndex((x) => x.code === 8);
    const head = (first < 0 ? body : body.slice(0, first)).filter((x) => x.code !== 1);
    const layers = first < 0 ? [] : body.slice(first);
    const names = { layer: () => undefined, linetype: () => undefined };
    out.push(layerStateFields(name, [...head, ...layers], names));
    i = end;
  }
  if (out.length === 0) throw new LasError('The file holds no layer state.');
  return out;
}

/**
 * A `.las` file of `state`, with the layers' and linetypes' names as the drawing has them now:
 * its engine's, or the app's mirror of its tables (the Layer States Manager's Export, part 2).
 */
export function writeLas(
  model: { readonly tables: Pick<LayerStateTables['tables'], 'layers' | 'linetypes'> },
  state: LayerState,
): string {
  const g: [number, string | number][] = [
    [0, DICTIONARY],
    [0, STATE],
    [1, state.name],
    [91, state.mask],
    [301, state.description],
    [290, state.paperSpace ? 1 : 0],
    [302, state.currentLayer],
  ];
  for (const e of state.layers) {
    const layer = e.layer === undefined ? undefined : model.tables.layers.get(e.layer);
    const linetype = e.linetype === undefined ? undefined : model.tables.linetypes.get(e.linetype);
    const v = layerEntryValues(e);
    g.push(
      [8, layer?.name ?? e.name],
      [90, v.flags],
      [62, v.aci],
      [370, v.lineweight],
      [6, linetype?.name ?? e.linetypeName],
      [2, e.plotStyle],
      [440, v.transparency],
    );
    if (v.trueColor !== undefined) g.push([92, v.trueColor]);
    if (v.book !== undefined) g.push([300, v.book]);
  }
  g.push([0, EOF]);
  return g.map(([code, v]) => `${String(code).padStart(3)}\r\n${v}\r\n`).join('');
}

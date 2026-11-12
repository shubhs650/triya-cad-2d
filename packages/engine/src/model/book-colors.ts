import type { DocumentModel } from './document';
import type { Color } from './types';

/**
 * The colour-book colours the drawing uses (on layers, objects and attributes), by
 * `BOOK$COLOR` in capitals, as AutoCAD names a DBCOLOR.
 */
export function bookColors(model: DocumentModel): Map<string, Color> {
  const out = new Map<string, Color>();
  const add = (c: Color) => {
    if (c.kind === 'rgb' && c.bookName !== undefined && c.colorName) {
      const key = `${c.bookName}$${c.colorName}`.toUpperCase();
      if (!out.has(key)) out.set(key, c);
    }
  };
  for (const l of model.tables.layers.values()) add(l.color);
  for (const e of model.entities()) {
    add(e.color);
    if (e.geom.kind === 'INSERT') for (const a of e.geom.attributes) add(a.color);
  }
  return out;
}

/**
 * `c` as an object new to a drawing holding `held` (its `bookColors`) takes it: a colour-book
 * colour keeps its name only where the drawing holds that `BOOK$COLOR` with the same true colour,
 * spelt as the drawing spells it, since the save names it by the drawing's own DBCOLOR and Triya
 * ships no colour books to add one from (M2-27); otherwise the colour's RGB value (M2-48).
 */
export function heldBookColor(held: ReadonlyMap<string, Color>, c: Color): Color {
  if (c.kind !== 'rgb' || (c.bookName === undefined && c.colorName === undefined)) return c;
  const plain: Color = { kind: 'rgb', r: c.r, g: c.g, b: c.b };
  if (c.bookName === undefined || !c.colorName) return plain;
  const own = held.get(`${c.bookName}$${c.colorName}`.toUpperCase());
  return own?.kind === 'rgb' && own.r === c.r && own.g === c.g && own.b === c.b ? own : plain;
}

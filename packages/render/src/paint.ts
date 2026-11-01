// Entity colour, lineweight and linetype → `Paint`, resolved at cache time (ARCHITECTURE.md
// §7.2) with the M1-13 rules in `style/`: the computed ACI palette, ByLayer and ByBlock, the
// LWDEFAULT lineweight, and the linetype pattern at LTSCALE × the object's linetype scale.
//
// Entities are resolved as they sit in the block shown. Inside an INSERT they inherit through
// `blockContext`, which block rendering (M1-14) hands down; viewport and annotation linetype
// scaling (PSLTSCALE, MSLTSCALE) come with layouts (M1-18), since acad-ts reads neither
// `$MSLTSCALE` nor `$CANNOSCALEVALUE` from the file.

import type { DocumentModel, Entity, HeaderValue, LinetypeRecord } from '@triya/engine';
import { patternOf, linetypeScale, type LinePattern } from './style/pattern';
import { resolveColor, resolveLinetype, resolveLineweight } from './style/resolve';
import type { Paint } from './tessellate';

export interface PaintOptions {
  /**
   * LWDEFAULT, hundredths of a millimetre: what Default shows as. AutoCAD keeps it in the
   * registry, not the drawing, and starts it at 25 (0.25 mm).
   */
  readonly lwDefault?: number;
}

/** AutoCAD's initial LWDEFAULT. */
const LWDEFAULT = 25;

/** LTYPE records are frozen and replaced on change, so a record keys its pattern. */
const patterns = new WeakMap<LinetypeRecord, LinePattern>();

function patternFor(record: LinetypeRecord): LinePattern {
  let p = patterns.get(record);
  if (!p) {
    p = patternOf(record);
    patterns.set(record, p);
  }
  return p;
}

/** A positive number, or 1 for a scale AutoCAD would refuse (missing, zero or negative). */
const positive = (v: HeaderValue | number | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;

/** A paint function for the renderer's `paint` option. */
export function createPaint(
  o: PaintOptions = {},
): (e: Entity, model: DocumentModel) => Paint | undefined {
  const lwDefault = o.lwDefault ?? LWDEFAULT;
  return (e, model) => {
    const layers = model.tables.layers;
    const layer = layers.get(e.layer);
    if (!e.visible || (layer && (!layer.on || layer.frozen))) return undefined;
    const src = { layers, lwDefault };
    const record = model.tables.linetypes.get(resolveLinetype(e, src) ?? '');
    const linetype =
      record && record.elements.length > 0
        ? {
            pattern: patternFor(record),
            scale: linetypeScale({
              ltscale: positive(model.header.get('$LTSCALE')),
              objectScale: positive(e.ltScale),
            }),
          }
        : undefined;
    return {
      color: resolveColor(e, src),
      lineweight: resolveLineweight(e, src) / 100,
      ...(linetype ? { linetype } : {}),
    };
  };
}

/**
 * The entity's paint, or undefined when it is not drawn: invisible, or on a layer that is
 * off or frozen.
 */
export const defaultPaint = createPaint();

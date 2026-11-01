// Entity colour, lineweight and linetype → `Paint`, resolved at cache time (ARCHITECTURE.md
// §7.2) with the M1-13 rules in `style/`: the computed ACI palette, ByLayer and ByBlock, the
// LWDEFAULT lineweight, and the linetype pattern at LTSCALE × the object's linetype scale.
//
// Inside an INSERT, entities inherit through the `blockContext` the reference hands down
// (`insertContext`, M1-14); viewport and annotation linetype
// scaling (PSLTSCALE, MSLTSCALE) come with layouts (M1-18), since acad-ts reads neither
// `$MSLTSCALE` nor `$CANNOSCALEVALUE` from the file.

import type { DocumentModel, Entity, HeaderValue, LinetypeRecord } from '@triya/engine';
import { patternOf, linetypeScale, type LinePattern } from './style/pattern';
import {
  blockContext,
  effectiveLayer,
  resolveColor,
  resolveLinetype,
  resolveLineweight,
  type BlockContext,
} from './style/resolve';
import type { InsertContextFunction } from './blocks';
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

/**
 * The renderer's `paint` option: an entity's paint, inside the context of the INSERT that holds
 * it when there is one, or undefined when it is not drawn. `insertContext` is what an INSERT
 * hands down (M1-14).
 */
export interface PaintFunction {
  (e: Entity, model: DocumentModel, block?: BlockContext): Paint | undefined;
  readonly insertContext?: InsertContextFunction;
}

/** A paint function for the renderer's `paint` option. */
export function createPaint(o: PaintOptions = {}): PaintFunction & {
  readonly insertContext: InsertContextFunction;
} {
  const lwDefault = o.lwDefault ?? LWDEFAULT;
  const paint = (e: Entity, model: DocumentModel, block?: BlockContext): Paint | undefined => {
    const layers = model.tables.layers;
    const src = { layers, lwDefault };
    // Inside a block an object on layer 0 shows on the INSERT's layer, including its on/off
    // state; others follow their own layer.
    const layer = effectiveLayer(e, src, block);
    if (!e.visible || (layer && (!layer.on || layer.frozen))) return undefined;
    const record = model.tables.linetypes.get(resolveLinetype(e, src, block) ?? '');
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
      color: resolveColor(e, src, block),
      lineweight: resolveLineweight(e, src, block) / 100,
      ...(linetype ? { linetype } : {}),
    };
  };
  // AutoCAD: an invisible reference or one whose layer is frozen draws nothing; one whose layer
  // is only off still draws the objects inside it that are on layers of their own.
  const insertContext: InsertContextFunction = (insert, model, outer) => {
    const src = { layers: model.tables.layers, lwDefault };
    const layer = effectiveLayer(insert, src, outer);
    if (!insert.visible || layer?.frozen) return undefined;
    return blockContext(insert, src, outer);
  };
  return Object.assign(paint, { insertContext });
}

/**
 * The entity's paint, or undefined when it is not drawn: invisible, or on a layer that is
 * off or frozen.
 */
export const defaultPaint = createPaint();

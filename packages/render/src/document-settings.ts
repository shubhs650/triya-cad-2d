// Drawing-wide settings that change how entities are tessellated (FILLMODE, ATTMODE, IMAGEFRAME
// and WIPEOUTFRAME) and a model seen with a viewport's layers, shared by the canvas renderer and
// the plot job (M2-17) so a plot paints what the screen shows.

import type {
  DocumentModel,
  Handle,
  LayerRecord,
  NonGraphicalObject,
  RasterVariables,
  WipeoutVariables,
} from '@triya/engine';
import type { ImageFrames } from './image';

export const isFrameSetting = (o: NonGraphicalObject): o is RasterVariables | WipeoutVariables =>
  o.type === 'RASTERVARIABLES' || o.type === 'WIPEOUTVARIABLES';

/** FILLMODE (M1-46): off, as 0 or false, outlines wide polylines; on when the header has none. */
export function fillMode(model: DocumentModel): boolean {
  const v = model.header.get('$FILLMODE');
  return !(v === 0 || v === false);
}

/** ATTMODE (M1-14 part 2): which attributes references show; AutoCAD's 1 when absent. */
export function attributeMode(model: DocumentModel): number | undefined {
  const v = model.header.get('$ATTMODE');
  return typeof v === 'number' ? v : undefined;
}

/**
 * IMAGEFRAME and WIPEOUTFRAME from the drawing's objects; on when the drawing has none. A plot
 * leaves out wipeout frames that are "displayed but not plotted" (WIPEOUTFRAME 2, M2-24 part 2),
 * which the screen draws.
 */
export function imageFrames(model: DocumentModel, use: 'screen' | 'plot' = 'screen'): ImageFrames {
  let image = true;
  let wipeout = true;
  for (const o of model.objects.values()) {
    if (!isFrameSetting(o)) continue;
    if (o.type === 'RASTERVARIABLES') image = o.frame;
    else wipeout = use === 'plot' ? o.frame === 1 : o.frame !== 0;
  }
  return { image, wipeout };
}

/**
 * `model` with `layers` in place of its LAYER table (a viewport's overridden layers, M1-62), for
 * the paint functions, which read tables and the header. Everything else is the model's own.
 */
export function withLayers(
  model: DocumentModel,
  layers: ReadonlyMap<Handle, LayerRecord>,
): DocumentModel {
  const tables = { ...model.tables, layers };
  return new Proxy(model, {
    get(target, key) {
      if (key === 'tables') return tables;
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

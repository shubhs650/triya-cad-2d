// The layers a layout viewport shows (M1-62): each layer with the overrides VPLAYER or the Layer
// Properties Manager's "VP" columns gave it in that viewport. AutoCAD: "you can override the
// color, linetype, lineweight, transparency, and plot style … of layers in a layout viewport";
// ByLayer objects in the viewport then take the override, other viewports keep the layer's own
// values. Plot style overrides are not read (Triya does not plot by style yet).

import type { Handle } from '../model/handle';
import type { LayerRecord } from '../model/types';

/** A viewport's layers: `layers` with the overrides applied, `overridden` the layers changed. */
export interface ViewportLayers {
  readonly layers: ReadonlyMap<Handle, LayerRecord>;
  readonly overridden: ReadonlySet<Handle>;
}

/** The layers `viewport` shows, or undefined when no layer overrides anything in it. */
export function viewportLayers(
  layers: ReadonlyMap<Handle, LayerRecord>,
  viewport: Handle,
): ViewportLayers | undefined {
  let out: Map<Handle, LayerRecord> | undefined;
  for (const [h, l] of layers) {
    const o = l.viewportOverrides?.find((v) => v.viewport === viewport);
    if (!o) continue;
    out ??= new Map(layers);
    out.set(h, {
      ...l,
      ...(o.color ? { color: o.color } : {}),
      ...(o.linetype ? { linetype: o.linetype } : {}),
      ...(o.lineweight !== undefined ? { lineweight: o.lineweight } : {}),
      ...(o.transparency ? { transparency: o.transparency } : {}),
    });
  }
  if (!out) return undefined;
  const overridden = new Set([...out].filter(([h, l]) => l !== layers.get(h)).map(([h]) => h));
  return { layers: out, overridden };
}

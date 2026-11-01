// Entity colour and lineweight → `Paint`, resolved at cache time (ARCHITECTURE.md §7.2).
//
// This is the minimum the renderer needs to draw; the full resolution (the 256-entry ACI
// table, colour books, ByBlock through nested inserts) is the linetype and colour task,
// M1-13, which replaces `defaultPaint` through the renderer's `paint` option.

import type { Color, DocumentModel, Entity, LayerRecord } from '@triya/engine';
import type { Paint } from './tessellate';

/** ACI 1–6 and 8–9; ACI 7 (and 0, ByBlock outside a block) follow the background. */
const ACI_BASIC: Readonly<Record<number, string>> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  8: '#808080',
  9: '#c0c0c0',
};

const hex = (n: number): string => n.toString(16).padStart(2, '0');

export function colorOf(c: Color, layer: LayerRecord | undefined): Paint['color'] {
  switch (c.kind) {
    case 'rgb':
      return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
    case 'aci':
      return ACI_BASIC[Math.abs(c.index)] ?? 'foreground';
    case 'byLayer':
      return layer && layer.color.kind !== 'byLayer'
        ? colorOf(layer.color, undefined)
        : 'foreground';
    case 'byBlock':
      return 'foreground';
  }
}

/** Lineweight in millimetres (DXF stores hundredths); undefined for Default and ByBlock. */
export function lineweightOf(e: Entity, layer: LayerRecord | undefined): number | undefined {
  const w = e.lineweight === 'ByLayer' ? layer?.lineweight : e.lineweight;
  return typeof w === 'number' && w >= 0 ? w / 100 : undefined;
}

/**
 * The entity's paint, or undefined when it is not drawn: invisible, or on a layer that is
 * off or frozen.
 */
export function defaultPaint(e: Entity, model: DocumentModel): Paint | undefined {
  const layer = model.tables.layers.get(e.layer);
  if (!e.visible || (layer && (!layer.on || layer.frozen))) return undefined;
  const lineweight = lineweightOf(e, layer);
  return { color: colorOf(e.color, layer), ...(lineweight === undefined ? {} : { lineweight }) };
}

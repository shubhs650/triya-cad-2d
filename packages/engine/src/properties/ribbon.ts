// The ribbon's Layers and Properties dropdowns (M7-02 part 3; AutoCAD 2024 Help, "Layers Panel"
// and "Properties Panel" of the Home tab): the layer, colour, linetype, lineweight and
// transparency of the objects selected, or with none the drawing's current ones, which new
// objects take. They are the Properties palette's General rows for the whole selection (never
// narrowed to a type), so a pick applies exactly as the palette's does: to the selected objects,
// or with none to CLAYER, CECOLOR, CELTYPE, CELWEIGHT or CETRANSPARENCY. The layer list also
// carries each layer's colour and on, frozen and locked states, which AutoCAD's layer dropdown
// shows, and the current layer.
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { colorValue, type ColorBook } from './color-books';
import { currentLayer } from './current';
import { propertySheet, type PropertyRow } from './sheet';

/** The rows the dropdowns show, in the ribbon's order. */
export const RIBBON_PROPERTY_KEYS = [
  'layer',
  'color',
  'linetype',
  'lineweight',
  'transparency',
] as const;

export interface RibbonLayer {
  readonly handle: Handle;
  readonly name: string;
  /** Its colour as the palette's Color values write it (`aci:7`, `rgb:255,0,0`). */
  readonly color: string;
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
}

export interface RibbonProperties {
  /** How many objects are selected; 0 shows the current settings. */
  readonly count: number;
  /** The General rows of `RIBBON_PROPERTY_KEYS`, in that order (a varying one has no value). */
  readonly rows: readonly PropertyRow[];
  /** Every layer, by name. */
  readonly layers: readonly RibbonLayer[];
  readonly currentLayer: Handle;
  /** The Select Color dialog's colour books, as the palette's sheet gives them. */
  readonly colorBooks?: readonly ColorBook[];
}

export function ribbonProperties(model: DocumentModel, ids: readonly EntityId[]): RibbonProperties {
  const sheet = propertySheet(model, ids);
  const general = sheet.sections.find((s) => s.title === 'General')?.rows ?? [];
  const rows = RIBBON_PROPERTY_KEYS.map((k) => general.find((r) => r.key === k)).filter(
    (r): r is PropertyRow => r !== undefined,
  );
  const layers = [...model.tables.layers.values()]
    .map((l) => ({
      handle: l.handle,
      name: l.name,
      color: colorValue(l.color),
      on: l.on,
      frozen: l.frozen,
      locked: l.locked,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    count: sheet.count,
    rows,
    layers,
    currentLayer: currentLayer(model),
    ...(sheet.colorBooks && { colorBooks: sheet.colorBooks }),
  };
}

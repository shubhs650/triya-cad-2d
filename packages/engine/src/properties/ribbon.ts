// The ribbon's Layers and Properties dropdowns (M7-02 part 3; AutoCAD 2024 Help, "Layers Panel"
// and "Properties Panel" of the Home tab): the layer, colour, linetype, lineweight and
// transparency of the objects selected, or with none the drawing's current ones, which new
// objects take. They are the Properties palette's General rows for the whole selection (never
// narrowed to a type), so a pick applies exactly as the palette's does: to the selected objects,
// or with none to CLAYER, CECOLOR, CELTYPE, CELWEIGHT or CETRANSPARENCY. The layer list also
// carries each layer's colour and on, frozen and locked states, which AutoCAD's layer dropdown
// shows, and the current layer. M7-02 part 4: what kind of object every selected one is, when
// they share one, for the contextual tab AutoCAD shows for it (Hatch Editor, Image, PDF Underlay,
// External Reference, Array).
import type { DocumentModel } from '../model/document';
import { isXrefRecord } from '../model/xref';
import { isAssocArray, type Entity } from '../model/types';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { colorValue, type ColorBook } from './color-books';
import { currentLayer } from './current';
import { currentTextStyle } from '../commands/draw/text';
import { currentDimStyle } from '../edit/dimension';
import { currentMLeaderStyle } from '../edit/mleader';
import { currentTableStyle } from '../edit/table';
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

/**
 * Annotate's style dropdowns (M7-02 part 5): each the drawing's styles of a kind, by name, and
 * the current one, which TEXTSTYLE, DIMSTYLE, CMLEADERSTYLE or CTABLESTYLE names.
 */
export interface RibbonStyles {
  readonly current?: string;
  readonly names: readonly string[];
}

/** The style variables the dropdowns set, by the kind of style. */
export const RIBBON_STYLE_VARIABLES = {
  text: 'TEXTSTYLE',
  dim: 'DIMSTYLE',
  mleader: 'CMLEADERSTYLE',
  table: 'CTABLESTYLE',
} as const;

export type RibbonStyleKind = keyof typeof RIBBON_STYLE_VARIABLES;

/** The kinds of selection that have a contextual tab. */
export type RibbonSelection = 'hatch' | 'image' | 'pdf' | 'xref' | 'array';

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
  /** The kind every selected object is, when they all are one with a contextual tab. */
  readonly selection?: RibbonSelection;
  readonly styles: Readonly<Record<RibbonStyleKind, RibbonStyles>>;
}

const named = (records: Iterable<{ readonly name: string }>, current?: { name: string }) => {
  // Shape files are text style records too, without a name to choose.
  const names = [...records]
    .map((r) => r.name)
    .filter((n) => n !== '')
    .sort((a, b) => a.localeCompare(b));
  return current ? { current: current.name, names } : { names };
};

/** The drawing's text, dimension, multileader and table styles and the current ones. */
export function ribbonStyles(model: DocumentModel): Record<RibbonStyleKind, RibbonStyles> {
  const t = model.tables;
  return {
    text: named(t.textStyles.values(), currentTextStyle(model)),
    dim: named(t.dimStyles.values(), currentDimStyle(model)),
    mleader: named(t.mleaderStyles.values(), currentMLeaderStyle(model)),
    table: named(t.tableStyles.values(), currentTableStyle(model)),
  };
}

/**
 * The kind every object of `ids` is: hatches, raster images, PDF underlays, external references
 * or associative arrays (an INSERT an array record names); undefined for none, or a mix.
 */
export function selectionKind(
  model: DocumentModel,
  ids: readonly EntityId[],
): RibbonSelection | undefined {
  const es = ids.map((id) => model.entity(id)).filter((e): e is Entity => e !== undefined);
  if (es.length === 0) return undefined;
  let arrays: Set<Handle> | undefined;
  const kindOf = (e: Entity): RibbonSelection | undefined => {
    switch (e.geom.kind) {
      case 'HATCH':
        return 'hatch';
      case 'IMAGE':
        return 'image';
      case 'PDFUNDERLAY':
        return 'pdf';
      case 'INSERT': {
        if (isXrefRecord(model.tables.blockRecords.get(e.geom.block))) return 'xref';
        if (e.extDict === undefined) return undefined;
        arrays ??= new Set([...model.objects.values()].filter(isAssocArray).map((a) => a.insert));
        return arrays.has(e.handle) ? 'array' : undefined;
      }
      default:
        return undefined;
    }
  };
  const first = kindOf(es[0]!);
  return first !== undefined && es.every((e) => kindOf(e) === first) ? first : undefined;
}

export function ribbonProperties(model: DocumentModel, ids: readonly EntityId[]): RibbonProperties {
  const sheet = propertySheet(model, ids);
  const selection = selectionKind(model, ids);
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
    ...(selection && { selection }),
    styles: ribbonStyles(model),
  };
}

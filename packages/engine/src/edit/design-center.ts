// Design-Center-lite (M5-11): what another drawing offers, by category, and bringing it into the
// drawing shown. AutoCAD 2024 Help, "DesignCenter Window", "To Add Content with DesignCenter"
// and "To Insert a Block with DesignCenter": a drawing's Blocks, Dimstyles, Layers, Linetypes,
// Multileaderstyles, Tablestyles and Textstyles are listed by name; an item added to a drawing
// comes in as a copy, and "if a definition is a duplicate of one in the drawing, it is ignored"
// (the drawing's own is kept, as it is). A block dragged or inserted is inserted by INSERT's
// placement, its definition copied first unless the drawing has a block of that name.
//
// Items travel as PASTECLIP's records do (clipboard.ts), one Clipboard each with what it names
// (a layer's linetype, a style's text style, a block's contents, layers and nested blocks), so a
// duplicate is ignored with everything only it would have brought. Dimension styles go with
// their sub-styles (dimstyle-import.ts). Layouts and xrefs, which DesignCenter also lists, are
// left for later parts of M5-11 (ROADMAP.md).
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { SymbolTableRecord, TableName } from '../model/types';
import { insertableBlocks } from './blocks';
import { copyToClipboard, pasteDefinitions, type Clipboard } from './clipboard';
import { copyDimStyles, dimStyleOffers, importDimStyles } from './dimstyle-import';

/** DesignCenter's categories of a drawing that Triya offers, in its tree's order. */
export type DesignCenterCategory =
  'blocks' | 'dimstyles' | 'layers' | 'linetypes' | 'mleaderstyles' | 'tablestyles' | 'textstyles';

/** Each category's label in DesignCenter's tree, and the table its items are records of. */
export const DESIGN_CENTER_CATEGORIES: readonly {
  readonly category: DesignCenterCategory;
  readonly label: string;
  readonly table: TableName;
}[] = [
  { category: 'blocks', label: 'Blocks', table: 'blockRecords' },
  { category: 'dimstyles', label: 'Dimstyles', table: 'dimStyles' },
  { category: 'layers', label: 'Layers', table: 'layers' },
  { category: 'linetypes', label: 'Linetypes', table: 'linetypes' },
  { category: 'mleaderstyles', label: 'Multileaderstyles', table: 'mleaderStyles' },
  { category: 'tablestyles', label: 'Tablestyles', table: 'tableStyles' },
  { category: 'textstyles', label: 'Textstyles', table: 'textStyles' },
];

/** The names a drawing offers in each category, sorted as AutoCAD lists table names. */
export type DesignCenterContent = { readonly [K in DesignCenterCategory]: readonly string[] };

/** One item copied out of a drawing, to be added to another (`addDesignCenterItem`). */
export interface DesignCenterItem {
  readonly category: DesignCenterCategory;
  readonly name: string;
  readonly content: Clipboard;
}

const ORIGIN: Vec2 = { x: 0, y: 0 };
/** DXF 70 bit 16 (and 32, resolved): a record an xref brought in, named `xref|name`. */
const XREF_DEPENDENT = 16 | 32;
/** Always in a drawing (AutoCAD's DesignCenter lists neither). */
const NOT_LINETYPES = new Set(['BYLAYER', 'BYBLOCK']);

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

function tableOf(category: DesignCenterCategory): TableName {
  return DESIGN_CENTER_CATEGORIES.find((c) => c.category === category)!.table;
}

/** A record of the drawing's own: not one an xref brought in. */
function own(r: SymbolTableRecord): boolean {
  return ((r.flags ?? 0) & XREF_DEPENDENT) === 0 && !r.name.includes('|');
}

/** The records of `table` the drawing offers, by name. */
function offered(model: DocumentModel, table: TableName): SymbolTableRecord[] {
  return [...(model.tables[table].values() as Iterable<SymbolTableRecord>)].filter(
    (r) =>
      typeof r.name === 'string' &&
      own(r) &&
      !(table === 'linetypes' && NOT_LINETYPES.has(r.name.toUpperCase())),
  );
}

/**
 * What `model` offers DesignCenter: its named blocks (no layout, anonymous or xref blocks), its
 * dimension styles (sub-styles go with their parent), layers, linetypes (ByLayer and ByBlock
 * aside), multileader, table and text styles, each without the records xrefs brought in.
 */
export function designCenterContent(model: DocumentModel): DesignCenterContent {
  const names = (table: TableName) => offered(model, table).map((r) => r.name);
  return {
    blocks: insertableBlocks(model)
      .filter(own)
      .map((r) => r.name),
    dimstyles: dimStyleOffers(model)
      .filter((o) => o.parent === undefined && !o.name.includes('|'))
      .map((o) => o.name)
      .sort(byName),
    layers: names('layers').sort(byName),
    linetypes: names('linetypes').sort(byName),
    mleaderstyles: names('mleaderStyles').sort(byName),
    tablestyles: names('tableStyles').sort(byName),
    textstyles: names('textStyles').sort(byName),
  };
}

/** The record of `table` named `name` (case aside) that the drawing offers. */
function recordNamed(
  model: DocumentModel,
  table: TableName,
  name: string,
): SymbolTableRecord | undefined {
  const upper = name.trim().toUpperCase();
  if (table === 'blockRecords') {
    return insertableBlocks(model).find((r) => own(r) && r.name.toUpperCase() === upper);
  }
  return offered(model, table).find((r) => r.name.toUpperCase() === upper);
}

/**
 * Item `name` of `category` copied out of `model` with what it names, as the Clipboard carries
 * records; undefined when the drawing offers no such item.
 */
export function designCenterItem(
  model: DocumentModel,
  category: DesignCenterCategory,
  name: string,
): DesignCenterItem | undefined {
  const r = recordNamed(model, tableOf(category), name);
  if (!r) return undefined;
  const content =
    category === 'dimstyles'
      ? copyDimStyles(model, [r.name])
      : copyToClipboard(model, [], ORIGIN, undefined, [r.handle]).clipboard;
  return { category, name: r.name, content };
}

/** True when `model` has a record named `name` in the item's table, an xref's or not. */
export function hasDesignCenterItem(
  model: DocumentModel,
  category: DesignCenterCategory,
  name: string,
): boolean {
  const upper = name.trim().toUpperCase();
  const table = tableOf(category);
  return [...(model.tables[table].values() as Iterable<SymbolTableRecord>)].some(
    (r) => typeof r.name === 'string' && r.name.toUpperCase() === upper,
  );
}

/**
 * `item` brought into `model` by `b` with what it names, unless the drawing has a record of its
 * name in its table: DesignCenter ignores a duplicate definition, keeping the drawing's own.
 * Returns whether it was added.
 */
export function addDesignCenterItem(
  b: ChangeSetBuilder,
  model: DocumentModel,
  item: DesignCenterItem,
): boolean {
  if (item.category === 'dimstyles') {
    return importDimStyles(b, model, item.content).added.length > 0;
  }
  if (hasDesignCenterItem(model, item.category, item.name)) return false;
  pasteDefinitions(b, model, item.content);
  return true;
}

/** Whether `item` is something DesignCenter can add: plain data a drawing's engine was sent. */
export function isDesignCenterItem(item: unknown): item is DesignCenterItem {
  const i = item as DesignCenterItem | undefined;
  return (
    typeof i === 'object' &&
    i !== null &&
    typeof i.name === 'string' &&
    DESIGN_CENTER_CATEGORIES.some((c) => c.category === i.category) &&
    typeof i.content === 'object' &&
    i.content !== null &&
    Array.isArray(i.content.entities) &&
    Array.isArray(i.content.blockEntities) &&
    Array.isArray(i.content.blocks) &&
    typeof i.content.tables === 'object'
  );
}

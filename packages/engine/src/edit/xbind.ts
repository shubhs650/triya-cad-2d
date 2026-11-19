// XBIND (M5-04 part 7): single xref-dependent definitions bound into the drawing.
//
// AutoCAD 2024 help, "XBIND (Command)" and "Xbind Dialog Box": XBIND "binds one or more
// definitions of named objects in an xref to the current drawing's symbol table", of five kinds:
// Block, Dimstyle, Layer, Linetype and Textstyle (-XBIND: "Enter symbol type to bind
// [Block/Dimstyle/LAyer/LType/Style]"). "About Binding Xrefs": a bound definition is renamed
// from `blockname|definitionname` to `blockname$n$definitionname`, n the lowest number that makes
// the name one the drawing does not have; "if you bind an xref-dependent layer, its linetype is
// bound too", and so is what any bound definition names (a dimension style's text style and arrow
// blocks, a block's layers, linetypes, styles and nested blocks).
//
// The xref stays attached and keeps drawing with its own `xref|name` definitions: XBIND adds
// copies, as the help's "adds selected xref-dependent named objects to your drawing" says. Triya
// makes them with the Clipboard's deep copy (clipboard.ts: COPYCLIP of the records, PASTECLIP
// into the same drawing), the copies' xref-dependent names changed to bound ones first, so every
// copy is a new record (new handles above $HANDSEED) that the save writes, and what is not
// xref-dependent (layer 0, Continuous, the drawing's own records) is the drawing's own. What a
// paste cannot take (a nested xref's reference in a bound block, clipboard.ts `clipboardProblem`)
// is left out of the bound block and counted. An image or PDF underlay in a bound block (M5-04
// part 16) shows a definition of the drawing's, as XREF Bind files one (xref-bind.ts
// `fileDefinition`): the xref's own is its file's, kept in no dictionary of the drawing and gone
// with the load, so the copy shows the drawing's definition of the same name and file, or a new
// one filed in the drawing's ACAD_IMAGE_DICT or ACAD_PDFDEFINITIONS, under the bound name
// (`xref$n$name`) when the drawing names another file so. An image whose file states no
// boundary gets the whole image's, as Bind gives it. One undo step (XBIND).
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  BlockDefinition,
  BlockTableRecord,
  ImageDefinition,
  PdfDefinition,
  SymbolTableRecord,
  TableName,
  TextStyleRecord,
} from '../model/types';
import { isXrefRecord, loadedXrefHandles } from '../model/xref';
import { copyToClipboard, pasteDefinitions, type Clipboard } from './clipboard';

/** The five kinds of definition XBIND binds, as its dialog's tree names them. */
export type XbindKind = 'Block' | 'Dimstyle' | 'Layer' | 'Linetype' | 'Textstyle';

/** The table each kind's definitions are in, in the dialog's order. */
export const XBIND_TABLES: Readonly<Record<XbindKind, TableName>> = {
  Block: 'blockRecords',
  Dimstyle: 'dimStyles',
  Layer: 'layers',
  Linetype: 'linetypes',
  Textstyle: 'textStyles',
};

/** DXF 70: xref-dependent (16) and resolved (32). */
const DEPENDENT_BITS = 16 | 32;

/** One xref-dependent definition the drawing has, as the Xbind dialog lists it. */
export interface XbindDefinition {
  readonly handle: Handle;
  /** Its full name, `xref|name`. */
  readonly name: string;
  readonly kind: XbindKind;
}

/** An xref of the drawing, with the definitions of it XBIND can bind. */
export interface XbindXref {
  readonly name: string;
  readonly definitions: readonly XbindDefinition[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Whether `r` of `table` is a definition XBIND can bind: `xref|name`, xref-dependent. */
function bindable(table: TableName, r: SymbolTableRecord): boolean {
  if (((r.flags ?? 0) & 16) === 0 || !r.name.includes('|')) return false;
  if (table !== 'blockRecords') return true;
  // A nested xref is not a definition, and an anonymous block (a dimension's) is no one's to bind.
  return (
    !isXrefRecord(r as BlockTableRecord) && !r.name.slice(r.name.indexOf('|') + 1).startsWith('*')
  );
}

/**
 * The drawing's xrefs, by name, each with its xref-dependent definitions (the ones loaded, and
 * those the drawing keeps itself, VISRETAIN): what the Xbind dialog's Xrefs tree shows.
 */
export function xbindXrefs(model: DocumentModel): XbindXref[] {
  const xrefs = new Map<string, { name: string; definitions: XbindDefinition[] }>();
  for (const r of model.tables.blockRecords.values()) {
    if (isXrefRecord(r)) xrefs.set(r.name.toUpperCase(), { name: r.name, definitions: [] });
  }
  for (const [kind, table] of Object.entries(XBIND_TABLES) as [XbindKind, TableName][]) {
    for (const r of model.tables[table].values() as Iterable<SymbolTableRecord>) {
      if (!bindable(table, r)) continue;
      const xref = xrefs.get(r.name.slice(0, r.name.indexOf('|')).toUpperCase());
      xref?.definitions.push({ handle: r.handle, name: r.name, kind });
    }
  }
  return [...xrefs.values()]
    .map((x) => ({ name: x.name, definitions: x.definitions.sort(byName) }))
    .sort(byName);
}

/** The definition `h` XBIND can bind, or undefined. */
export function xbindDefinition(model: DocumentModel, h: Handle): XbindDefinition | undefined {
  for (const [kind, table] of Object.entries(XBIND_TABLES) as [XbindKind, TableName][]) {
    const r = model.tables[table].get(h) as SymbolTableRecord | undefined;
    if (r && bindable(table, r)) return { handle: h, name: r.name, kind };
  }
  return undefined;
}

/** What XBIND bound: each definition asked for, by its new name, and what was left out. */
export interface XbindReport {
  /** The definitions asked for, with the names their copies have. */
  readonly bound: readonly (XbindDefinition & { readonly boundName: string })[];
  /** Reason → how many objects of the bound blocks were left out. */
  readonly omitted: ReadonlyMap<string, number>;
}

/** `xbindDefinitions` as a change of its own (one XBIND undo step), with its report. */
export function xbindChange(
  model: DocumentModel,
  handles: readonly Handle[],
): { change: ChangeSet; report: XbindReport } {
  const b = new ChangeSetBuilder(model);
  const report = xbindDefinitions(b, model, handles);
  return { change: b.build(), report };
}

/**
 * XBIND: copies of the xref-dependent definitions `handles` (and of the xref-dependent ones they
 * name) made the drawing's, each `xref$n$name`.
 */
export function xbindDefinitions(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handles: readonly Handle[],
): XbindReport {
  const asked: XbindDefinition[] = [];
  for (const h of new Set(handles)) {
    const d = xbindDefinition(model, h);
    if (!d) continue;
    asked.push(d);
  }
  if (asked.length === 0) return { bound: [], omitted: new Map() };
  const copy = copyToClipboard(
    model,
    [],
    { x: 0, y: 0 },
    undefined,
    asked.map((d) => d.handle),
  );

  // The copies' bound names, n the lowest free one per table.
  const names = new Map<TableName, Set<string>>();
  const taken = (table: TableName): Set<string> => {
    let set = names.get(table);
    if (!set) {
      set = new Set(
        [...(model.tables[table].values() as Iterable<SymbolTableRecord>)].map((r) =>
          r.name.toUpperCase(),
        ),
      );
      names.set(table, set);
    }
    return set;
  };
  const renamed = new Map<Handle, string>();
  const tables: Record<string, readonly SymbolTableRecord[]> = {};
  for (const [table, list] of Object.entries(copy.clipboard.tables) as [
    TableName,
    readonly SymbolTableRecord[],
  ][]) {
    tables[table] = list.map((r) => {
      if (((r.flags ?? 0) & 16) === 0 || !r.name.includes('|')) return r;
      const bar = r.name.indexOf('|');
      const xref = r.name.slice(0, bar);
      const symbol = r.name.slice(bar + 1);
      // Anonymous blocks are pasted under new anonymous names (clipboard.ts).
      if (symbol.startsWith('*')) return withoutDependentBits(r);
      const set = taken(table);
      let n = 0;
      while (set.has(`${xref}$${n}$${symbol}`.toUpperCase())) n++;
      const name = `${xref}$${n}$${symbol}`;
      set.add(name.toUpperCase());
      renamed.set(r.handle, name);
      let out: SymbolTableRecord = { ...withoutDependentBits(r), name };
      // A style the xref's file left without a font (its Standard) is drawn in txt, AutoCAD's
      // default, which the drawing's copy names (as XREF Bind's does, xref-bind.ts).
      if (table === 'textStyles' && (out as TextStyleRecord).font.trim() === '')
        out = { ...out, font: 'txt' } as TextStyleRecord;
      return out;
    });
  }
  const blocks: BlockDefinition[] = copy.clipboard.blocks.map((d) => {
    const name = renamed.get(d.handle);
    const { flags, ...rest } = d;
    const kept = (flags ?? 0) & ~DEPENDENT_BITS;
    return { ...rest, ...(name !== undefined ? { name } : {}), ...(kept ? { flags: kept } : {}) };
  });
  const { objects, known } = drawingDefinitions(b, model, copy.clipboard.objects ?? []);
  const clip: Clipboard = {
    ...copy.clipboard,
    tables,
    blocks,
    blockEntities: copy.clipboard.blockEntities.map(withImageBoundary),
    ...(objects.length > 0 ? { objects } : {}),
  };
  pasteDefinitions(b, model, clip, known);

  const bound = asked.map((d) => ({ ...d, boundName: renamed.get(d.handle) ?? d.name }));
  return { bound, omitted: copy.refused };
}

type Definition = ImageDefinition | PdfDefinition;

/** Whether `name` is `symbol` of xref `xref`, or a bound name of it (`xref$n$symbol`), case aside. */
function boundAs(name: string, xref: string, symbol: string): boolean {
  const u = name.toUpperCase();
  const s = symbol.toUpperCase();
  if (u === s) return true;
  const head = `${xref.toUpperCase()}$`;
  if (!u.startsWith(head) || !u.endsWith(`$${s}`)) return false;
  return /^\d+$/.test(u.slice(head.length, u.length - s.length - 1));
}

/**
 * The image and PDF definitions the bound blocks show, as the drawing is to have them: `known`
 * maps one (left on the Clipboard, the paste maps it) to the drawing's definition of its type and
 * file named as it is or as an earlier XBIND of the xref named it (case aside); the others are
 * pasted as new ones, renamed `xref$n$name` (the xref the load filed them under, n the lowest
 * free) where the drawing has a definition of that name for another file, as XREF Bind names one
 * (xref-bind.ts `fileDefinition`).
 */
function drawingDefinitions(
  b: ChangeSetBuilder,
  model: DocumentModel,
  defs: readonly Definition[],
): { objects: Definition[]; known: Map<Handle, Handle> } {
  const loaded = loadedXrefHandles(model);
  const own = [...b.objects()].filter(
    (o): o is Definition =>
      (o.type === 'IMAGEDEF' || o.type === 'PDFDEFINITION') && !loaded.has(o.handle),
  );
  const known = new Map<Handle, Handle>();
  const objects: Definition[] = [];
  for (const o of defs) {
    const same = own.filter((d) => d.type === o.type);
    const xref = model.tables.blockRecords.get(o.owner)?.name ?? 'xref';
    const match = same.find((d) => d.fileName === o.fileName && boundAs(d.name, xref, o.name));
    if (match) {
      known.set(o.handle, match.handle);
      objects.push(o);
      continue;
    }
    const names = new Set(same.map((d) => d.name.toUpperCase()));
    let name = o.name;
    if (names.has(name.toUpperCase())) {
      let n = 0;
      while (names.has(`${xref}$${n}$${o.name}`.toUpperCase())) n++;
      name = `${xref}$${n}$${o.name}`;
    }
    const filed = { ...o, name };
    own.push(filed);
    objects.push(filed);
  }
  return { objects, known };
}

/**
 * An unclipped image whose file states no boundary with AutoCAD's: the whole image, in pixel
 * coordinates centred on pixels (edit/picture.ts), which the save writes (DXF 91 = 2), as XREF
 * Bind gives it (xref-bind.ts).
 */
function withImageBoundary<T extends Clipboard['blockEntities'][number]>(e: T): T {
  const g = e.geom;
  if (g.kind !== 'IMAGE' || g.clipping || g.clip.type !== 'rectangle') return e;
  if (g.clip.vertices.length === 2) return e;
  const vertices = [
    { x: -0.5, y: -0.5 },
    { x: g.size.x - 0.5, y: g.size.y - 0.5 },
  ];
  return { ...e, geom: { ...g, clip: { ...g.clip, vertices } } };
}

function withoutDependentBits(r: SymbolTableRecord): SymbolTableRecord {
  const flags = (r.flags ?? 0) & ~DEPENDENT_BITS;
  const { flags: _flags, ...rest } = r;
  return flags !== 0 ? { ...rest, flags } : rest;
}

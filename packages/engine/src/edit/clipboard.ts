// Copying objects to the Clipboard and pasting them into another drawing (M2-14 part 2: COPYCLIP,
// CUTCLIP, COPYBASE, PASTECLIP, PASTEBLOCK, PASTEORIG).
//
// AutoCAD 2024 Help, "COPYCLIP": the Clipboard holds the objects with what they need to draw,
// as a drawing of their own: the layers, linetypes, text, dimension, multileader, table and
// multiline styles and the blocks they use (and the ones those use), and the application ids of
// their xdata. "PASTECLIP" pastes them as INSERT brings in a drawing: a definition the target
// already has under the same name is the target's ("duplicate definitions are ignored"), the
// others come in, and every object pasted is a new one, with a handle above the target's
// $HANDSEED (handles are never reused or renumbered, ARCHITECTURE.md §4.1). An anonymous block (a
// dimension's `*D`, a table's `*T`) always comes in under a new anonymous name.
//
// The Clipboard is in the source's units (its $INSUNITS): pasted into a drawing in other units,
// the objects are scaled about the base point to keep their size, as INSERT scales a drawing
// in other units (M2-32; `insUnitsScale`, nothing scaled where either drawing is unitless).
// PASTEBLOCK's block keeps the source's units and its reference takes the scale.
//
// A pasted object is a copy (edit.ts): no reactors, extension dictionary or annotation scales, so
// no associativity or group membership, except that a hatch pasted with its whole boundary stays
// associative with the boundary's copies. Materials and plot style names are kept by name only
// in Triya (types.ts `TableRecords`), so a pasted object keeps one only where the target has it.
//
// An image or PDF underlay brings its definition, the IMAGEDEF or PDFDEFINITION naming its file
// (M2-32 part 2), filed in the target's ACAD_IMAGE_DICT or ACAD_PDFDEFINITIONS; as with records,
// a definition the target already has under that name is the target's. The file itself stays
// where it is: the app finds an image or PDF by its name without the folder (M1-21), so a file
// the user supplied shows in both drawings.
//
// Records and blocks keep their xdata (M2-32 part 3), as AutoCAD's deep clone copies an object's
// xdata with it: its applications come along as they do for an object's, and a 1005 handle names
// the pasted copy of what it named. A dynamic block's applications (its GUID, true name and the
// representation tags of its anonymous copies) describe the graph a paste does not bring, so
// they stay behind with it. A multileader whose content block holds attribute definitions names
// the pasted block's ATTDEFs, or, where the target has the block already, the target's ATTDEF
// of the same tag (AutoCAD's Help does not say which; the tag is what the attribute is to a
// drafter); a value whose tag the target's block lacks has nothing to belong to and goes.
//
// A dynamic block stays dynamic (M2-32 part 4), as AutoCAD's deep clone takes an object's
// extension dictionary with it: the definition brings its evaluation graph and the objects below
// it, each anonymous `*U` state its link to the definition (AcDbBlockRepBTag xdata) and data, and
// each reference its `AcDbBlockRepresentation` (the definition it shows, its parameter values),
// all `CodedObject`s (types.ts) renumbered into the target. A definition the target has already
// under that name is the target's, graph and all; a reference's representation then comes only
// where everything it names came too (an anonymous state always does), otherwise the reference
// keeps its state's geometry and link without it.
//
// What the target cannot take yet is left out when copying, with a reason: viewports (a
// layout's), external references (their content lives in another file: attaching one is
// XATTACH's, M5-04), an image whose definition is missing and what COPY refuses.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import { sub } from '../geom/vec';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { isHandle, type Handle } from '../model/handle';
import {
  isCodedObject,
  isHandleCode,
  type BlockDefinition,
  type BlockTableRecord,
  type CodedObject,
  type DimStyleRecord,
  type DxfGroup,
  type Entity,
  type EntityInit,
  type HatchGeometry,
  type ImageDefinition,
  type LayerRecord,
  type NonGraphicalObject,
  type ObjectCommon,
  type PdfDefinition,
  type SymbolTableRecord,
  type TableName,
  type TableRecords,
  type TableStyleRecord,
  type Xdata,
} from '../model/types';
import { insUnitsScale } from '../model/units';
import { HANDLE_KEYS, isXrefRecord, renumber } from '../model/xref';
import { AnonymousNames, copyProblem, transformObjects, type EditReport } from './edit';
import { followedBy, moveBy, scaleAbout, type Similarity } from './similarity';

/** The definitions the Clipboard carries, by table, as the source holds them. */
export type ClipboardTables = { readonly [K in TableName]?: readonly TableRecords[K][] };

/**
 * What COPYCLIP puts on the Clipboard: plain data (it crosses from one drawing's engine to
 * another's by structured clone), in the source drawing's handles.
 */
export interface Clipboard {
  /** The point pasted at the insertion point: COPYCLIP's lower-left extents corner, COPYBASE's. */
  readonly base: Vec2;
  /** The objects copied, in drawing order. */
  readonly entities: readonly EntityInit[];
  /** What the blocks they use hold. */
  readonly blockEntities: readonly EntityInit[];
  readonly tables: ClipboardTables;
  readonly blocks: readonly BlockDefinition[];
  /** The objects' extents, when known: what PASTECLIP drags. */
  readonly extents?: Box;
  /** The source's `$INSUNITS`, which a paste scales from; absent, unitless. */
  readonly insUnits?: number;
  /** The IMAGEDEFs and PDFDEFINITIONs the images and underlays show (M2-32 part 2). */
  readonly objects?: readonly (ImageDefinition | PdfDefinition)[];
  /**
   * What makes the blocks dynamic (M2-32 part 4): the coded objects in the extension
   * dictionaries (`extDict`) of the block records and references that carry one.
   */
  readonly coded?: readonly CodedObject[];
}

export interface ClipboardCopy {
  readonly clipboard: Clipboard;
  /** Reason → how many objects it kept off the Clipboard. */
  readonly refused: ReadonlyMap<string, number>;
  /** How many annotative objects were copied without their annotation scales. */
  readonly unannotated: number;
}

/** The tables whose records the Clipboard carries. Views, UCSs and VPORTs stay home. */
const CARRIED_TABLES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'mleaderStyles',
  'tableStyles',
  'mlineStyles',
  'appIds',
  'blockRecords',
  'materials',
  'plotStyles',
];

/** Kept by name only (types.ts): pasted onto the target's record of that name or dropped. */
const BY_NAME_ONLY: ReadonlySet<TableName> = new Set(['materials', 'plotStyles']);

/** The fields that link an object to others rather than to the definitions it is drawn with. */
const LINKS = new Set([
  'handle',
  'owner',
  'reactors',
  'extDict',
  'beginHandle',
  'endHandle',
  'layout',
  'blockRecord',
]);

/** The dimension variables that name a record (DXF 340–347): DIMTXSTY, the arrow blocks, linetypes. */
export const DIMVAR_REFERENCES: readonly string[] = [
  'DIMTXSTY',
  'DIMLDRBLK',
  'DIMBLK',
  'DIMBLK1',
  'DIMBLK2',
  'DIMLTYPE',
  'DIMLTEX1',
  'DIMLTEX2',
];

/** DXF 1005: a database handle in xdata, which AutoCAD translates when objects are copied in. */
const XDATA_HANDLE = 1005;
/** DXF 1003: a layer name in xdata, which the save checks names a layer. */
const XDATA_LAYER = 1003;

/**
 * Every handle `value` names in a reference field, its xdata's included (a 1003 layer name as
 * the handle `layers` gives it).
 */
function references(
  value: unknown,
  out: Handle[],
  layers: ReadonlyMap<string, Handle>,
  key?: string,
): void {
  if (typeof value === 'string') {
    if (key !== undefined && HANDLE_KEYS.has(key) && !LINKS.has(key) && isHandle(value)) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) references(item, out, layers, key);
    return;
  }
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return;
  for (const [k, item] of Object.entries(value)) {
    if (k === 'xdata') {
      for (const app of item as Xdata) {
        out.push(app.appId);
        for (const v of app.values) {
          if (v.code === XDATA_HANDLE && typeof v.value === 'string') out.push(v.value);
          if (v.code === XDATA_LAYER && typeof v.value === 'string') {
            const layer = layers.get(v.value.toUpperCase());
            if (layer !== undefined) out.push(layer);
          }
        }
      }
    } else if (k === 'vars') {
      // A DIMSTYLE's reference variables.
      for (const name of DIMVAR_REFERENCES) {
        const v = (item as Record<string, unknown>)[name];
        if (typeof v === 'string' && isHandle(v)) out.push(v);
      }
    } else if (k !== 'raw') references(item, out, layers, k);
  }
}

/** The definition objects a paste brings, and the dictionary meta field naming where each is filed. */
const DEFINITIONS = { IMAGEDEF: 'imageDictionary', PDFDEFINITION: 'pdfDictionary' } as const;
type Definition = ImageDefinition | PdfDefinition;

const isDefinition = (o: NonGraphicalObject | undefined): o is Definition =>
  o !== undefined && Object.hasOwn(DEFINITIONS, o.type);

/** Why `e` cannot go on the Clipboard, or undefined. */
function clipboardProblem(model: DocumentModel, e: Entity): string | undefined {
  const g = e.geom;
  if ((g.kind === 'IMAGE' || g.kind === 'PDFUNDERLAY') && g.definition !== undefined) {
    // The save writes no image without the IMAGEDEF naming its file (export entities.ts).
    if (!isDefinition(model.objects.get(g.definition))) {
      return g.kind === 'IMAGE'
        ? 'an image whose definition is missing cannot be pasted'
        : 'an underlay whose definition is missing cannot be pasted';
    }
  }
  if (g.kind === 'VIEWPORT') return 'a viewport cannot be pasted';
  if (g.kind === 'INSERT' && isXrefRecord(model.tables.blockRecords.get(g.block))) {
    return 'an external reference cannot be pasted yet';
  }
  return copyProblem(e, moveBy({ x: 0, y: 0 }));
}

/** The applications a copy leaves behind: the annotative property's, as COPY's (edit.ts). */
const ANNOTATIVE_APPS: ReadonlySet<string> = new Set(['ACADANNOTATIVE']);

/** The applications of a dynamic block's graph, which a paste leaves behind (`clipBlock`). */
const DYNAMIC_APPS: ReadonlySet<string> = new Set([
  ...ANNOTATIVE_APPS,
  'ACDBDYNAMICBLOCKGUID',
  'ACDBDYNAMICBLOCKTRUENAME',
  'ACDBBLOCKREPBTAG',
  'ACDBBLOCKREPETAG',
]);

/** The xdata a copy keeps: all but the applications `dropped` names. */
function keptXdata(
  model: DocumentModel,
  xdata: Xdata | undefined,
  dropped = ANNOTATIVE_APPS,
): Xdata | undefined {
  if (!xdata) return undefined;
  const kept = xdata.filter(
    (x) => !dropped.has(model.tables.appIds.get(x.appId)?.name.toUpperCase() ?? ''),
  );
  return kept.length > 0 ? kept : undefined;
}

/** What a copied object or record keeps of its common fields. */
function common<T extends ObjectCommon>(model: DocumentModel, o: T, dropped = ANNOTATIVE_APPS): T {
  const { raw: _raw, reactors: _reactors, extDict: _extDict, xdata, ...rest } = o;
  const kept = keptXdata(model, xdata, dropped);
  return { ...rest, ...(kept ? { xdata: kept } : {}) } as T;
}

/** An entity as the Clipboard holds it: a copy's fields (edit.ts `copiedProps`). */
function clipEntity(model: DocumentModel, e: Entity): EntityInit {
  const { id: _id, annotative: _annotative, ...rest } = common(model, e);
  let geom = rest.geom;
  if (geom.kind === 'INSERT') {
    geom = {
      ...geom,
      attributes: geom.attributes.map((a) => {
        const { annotative: _a, ...attribute } = common(model, a);
        return attribute;
      }),
    };
  } else if (geom.kind === 'LEADER') {
    const { annotation: _annotation, ...leader } = geom;
    geom = leader;
  }
  // A new object does not take a colour book's name yet (M2-48; the drawing pasted into may not
  // hold the book's DBCOLOR, which the save needs): the copy keeps the colour's RGB value.
  const c = rest.color;
  const color =
    c.kind === 'rgb' && (c.bookName !== undefined || c.colorName !== undefined)
      ? { kind: 'rgb' as const, r: c.r, g: c.g, b: c.b }
      : c;
  return { ...rest, color, geom };
}

/**
 * A record as the Clipboard holds it, with its xdata. What Triya reads of a record's xdata into
 * its fields (a layer's transparency and description, a text style's TrueType bits) agrees with
 * the xdata, which the save rewrites from them. A block record that stays `dynamic` keeps the
 * xdata naming it as one and its extension dictionary.
 */
function clipRecord(
  model: DocumentModel,
  table: TableName,
  r: ObjectCommon,
  dynamic: Dynamic | undefined,
): ObjectCommon {
  const out = common(
    model,
    r,
    table === 'blockRecords' && !dynamic ? DYNAMIC_APPS : ANNOTATIVE_APPS,
  );
  // Its extension dictionary, for what makes the block dynamic (the dictionary is a new one).
  if (dynamic && dynamic.tree.length > 0) return { ...out, extDict: r.extDict! };
  if (table === 'layers') {
    // A layer's viewport overrides name viewports of the source's layouts.
    const { viewportOverrides: _v, ...layer } = out as LayerRecord;
    return layer;
  }
  if (table === 'tableStyles') {
    // An unfilled row reads its fill colour as the file states it, which can be 257 (none);
    // a new style keeps ACI 7 there, as AutoCAD reads an unfilled one back (table-styles.ts).
    const style = out as TableStyleRecord;
    const cellStyles = style.cellStyles.map((c) =>
      !c.fillOn &&
      c.fillColor.kind === 'aci' &&
      !(c.fillColor.index >= 1 && c.fillColor.index <= 255)
        ? { ...c, fillColor: { kind: 'aci' as const, index: 7 } }
        : c,
    );
    return { ...style, cellStyles } as TableStyleRecord;
  }
  if (table === 'dimStyles') {
    // DXF states DIMVAR colours as ACIs only (`vars` holds them); the true colours are a DWG's.
    const { trueColors: _t, ...style } = out as DimStyleRecord;
    return style;
  }
  return out;
}

/**
 * A block definition as the Clipboard holds it: its own entities and record, nothing more. It
 * stays a dynamic block, or a state of one, when `dynamic` says so.
 */
function clipBlock(
  model: DocumentModel,
  d: BlockDefinition,
  dynamic: Dynamic | undefined,
): BlockDefinition {
  const {
    beginHandle: _b,
    endHandle: _e,
    dynamic: kind,
    dynamicOf,
    xrefLoaded: _loaded,
    // The BLOCK's own xdata, which the reader does not map (its BLOCK_RECORD's is the record's).
    xdata: _xdata,
    ...rest
  } = common(model, d);
  if (!dynamic) return rest;
  return {
    ...rest,
    ...(kind ? { dynamic: kind } : {}),
    ...(dynamicOf !== undefined ? { dynamicOf } : {}),
  };
}

/** A block that stays dynamic on the Clipboard: the coded objects that make it so. */
interface Dynamic {
  readonly tree: readonly CodedObject[];
}

/** The coded objects of `model`, by owner. */
function codedByOwner(model: DocumentModel): Map<Handle, CodedObject[]> {
  const out = new Map<Handle, CodedObject[]>();
  for (const o of model.objects.values()) {
    if (!isCodedObject(o)) continue;
    let list = out.get(o.owner);
    if (!list) out.set(o.owner, (list = []));
    list.push(o);
  }
  return out;
}

/** The coded objects in the extension dictionary `xdict` and below them, parents first. */
function codedTree(byOwner: ReadonlyMap<Handle, CodedObject[]>, xdict: Handle | undefined) {
  const out: CodedObject[] = [];
  if (xdict === undefined) return out;
  for (const o of byOwner.get(xdict) ?? []) if (o.key !== undefined) out.push(o);
  for (let i = 0; i < out.length; i++) out.push(...(byOwner.get(out[i]!.handle) ?? []));
  return out;
}

const GRAPH_KEY = 'ACAD_ENHANCEDBLOCK';

/**
 * Whether block `h` stays dynamic on the Clipboard, with what: a definition with its evaluation
 * graph, or a state of one (its link is its record's AcDbBlockRepBTag xdata).
 */
function dynamicOfBlock(
  model: DocumentModel,
  byOwner: ReadonlyMap<Handle, CodedObject[]>,
  h: Handle,
): Dynamic | undefined {
  const d = model.blocks.get(h);
  const tree = codedTree(byOwner, model.tables.blockRecords.get(h)?.extDict);
  if (d?.dynamic) {
    return tree.some((o) => o.key?.toUpperCase() === GRAPH_KEY) ? { tree } : undefined;
  }
  return d?.dynamicOf !== undefined ? { tree } : undefined;
}

/** DXF 1001: the application name xdata starts with. */
const XDATA_APP = 1001;

/** What a coded tree names: its handles, and the applications of its xdata by record handle. */
function codedReferences(
  model: DocumentModel,
  tree: readonly CodedObject[],
  out: Handle[],
): void {
  const apps = new Map(
    [...model.tables.appIds.values()].map((a) => [a.name.toUpperCase(), a.handle]),
  );
  for (const o of tree) {
    for (const { code, value } of o.codes) {
      if (typeof value !== 'string') continue;
      if (isHandleCode(code) && isHandle(value)) out.push(value);
      else if (code === XDATA_APP) {
        const app = apps.get(value.toUpperCase());
        if (app !== undefined) out.push(app);
      }
    }
  }
}

function count(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

/**
 * COPYCLIP: `ids` and the definitions they use, `base` the point a paste puts at its insertion
 * point. Objects the Clipboard cannot carry are left out, counted by reason.
 */
export function copyToClipboard(
  model: DocumentModel,
  ids: readonly EntityId[],
  base: Vec2,
  extents?: Box,
): ClipboardCopy {
  const refused = new Map<string, number>();
  let unannotated = 0;
  const tableOf = new Map<Handle, TableName>();
  for (const t of CARRIED_TABLES) for (const h of model.tables[t].keys()) tableOf.set(h, t);
  const layers = new Map(
    [...model.tables.layers.values()].map((l) => [l.name.toUpperCase(), l.handle]),
  );

  // The objects in drawing order, whatever order they were picked in.
  const order = new Map<EntityId, number>();
  const chosen = ids.map((id) => model.entity(id)).filter((e): e is Entity => e !== undefined);
  for (const owner of new Set(chosen.map((e) => e.owner))) {
    model.blockEntities(owner).forEach((id, i) => order.set(id, i));
  }
  const sorted = [...new Set(chosen)].sort((a, b) =>
    a.owner === b.owner ? order.get(a.id)! - order.get(b.id)! : 0,
  );

  const entities: EntityInit[] = [];
  const blockEntities: EntityInit[] = [];
  const records = new Map<TableName, Map<Handle, ObjectCommon>>();
  const blocks = new Map<Handle, BlockDefinition>();
  const objects = new Map<Handle, Definition>();
  const coded: CodedObject[] = [];
  const byOwner = codedByOwner(model);
  const pending: Handle[] = [];
  const carry = (tree: readonly CodedObject[]): void => {
    coded.push(...tree);
    codedReferences(model, tree, pending);
  };
  const take = (e: Entity, into: EntityInit[]): void => {
    const problem = clipboardProblem(model, e);
    if (problem) {
      count(refused, problem);
      return;
    }
    if (e.annotative) unannotated++;
    let c = clipEntity(model, e);
    // A dynamic block reference's representation (M2-32 part 4).
    const tree = e.geom.kind === 'INSERT' ? codedTree(byOwner, e.extDict) : [];
    if (tree.length > 0) {
      c = { ...c, extDict: e.extDict! };
      carry(tree);
    }
    into.push(c);
    references(c, pending, layers);
  };
  for (const e of sorted) take(e, entities);
  while (pending.length > 0) {
    const h = pending.pop()!;
    const o = model.objects.get(h);
    if (isDefinition(o)) {
      // Its owner is the source's dictionary, its reactors the source's images.
      if (!objects.has(h)) objects.set(h, common(model, o));
      continue;
    }
    const table = tableOf.get(h);
    if (!table) continue;
    let list = records.get(table);
    if (!list) records.set(table, (list = new Map()));
    if (list.has(h)) continue;
    const dynamic = table === 'blockRecords' ? dynamicOfBlock(model, byOwner, h) : undefined;
    const r = clipRecord(model, table, model.tables[table].get(h)!, dynamic);
    list.set(h, r);
    references(r, pending, layers);
    if (dynamic) carry(dynamic.tree);
    const def = table === 'blockRecords' ? model.blocks.get(h) : undefined;
    if (def) {
      const d = clipBlock(model, def, dynamic);
      blocks.set(h, d);
      references(d, pending, layers);
      for (const id of model.blockEntities(h)) take(model.entity(id)!, blockEntities);
    }
  }
  const tables: Record<string, ObjectCommon[]> = {};
  for (const [t, list] of records) tables[t] = [...list.values()];
  return {
    clipboard: {
      base,
      entities,
      blockEntities,
      tables: tables as ClipboardTables,
      blocks: [...blocks.values()],
      ...(extents ? { extents } : {}),
      insUnits: model.meta.insUnits,
      ...(objects.size > 0 ? { objects: [...objects.values()] } : {}),
      ...(coded.length > 0 ? { coded: coded.map((o) => common(model, o)) } : {}),
    },
    refused,
    unannotated,
  };
}

/** BLOCK DXF 70 bit 1: an anonymous block. */
const ANONYMOUS = 1;

/** `*D12` → `D`: the letter AutoCAD names an anonymous block's kind by. */
const anonymousPrefix = (name: string): string => /^\*([A-Z]+)/i.exec(name)?.[1] ?? 'U';

/** The target's record named `name` in `table`, case aside. */
function byName(model: DocumentModel, table: TableName, name: string): Handle | undefined {
  const upper = name.toUpperCase();
  for (const r of model.tables[table].values()) {
    if ((r as SymbolTableRecord).name.toUpperCase() === upper) return r.handle;
  }
  return undefined;
}

/** What a paste scales the Clipboard's objects by to keep their size in `model`'s units. */
export function pasteScale(model: DocumentModel, clip: Clipboard): number {
  return insUnitsScale(clip.insUnits ?? 0, model.meta.insUnits);
}

/**
 * Where a paste carries the Clipboard's objects: scaled by `pasteScale` about the base point,
 * which goes to `at`; undefined when they stay as they are.
 */
export function pastePlacement(
  model: DocumentModel,
  clip: Clipboard,
  at: Vec2,
): Similarity | undefined {
  const d = sub(at, clip.base);
  const k = pasteScale(model, clip);
  const move = d.x !== 0 || d.y !== 0 ? moveBy(d) : undefined;
  if (k === 1) return move;
  const scale = scaleAbout(clip.base, k);
  return move ? followedBy(scale, move) : scale;
}

/**
 * PASTECLIP: the Clipboard's objects pasted into `owner` with its base point at `at` (PASTEORIG:
 * `at` is the base point itself), scaled into `model`'s units. Returns the objects pasted.
 */
export function pasteObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  clip: Clipboard,
  owner: Handle,
  at: Vec2,
): EditReport {
  return pasteInto(b, model, clip, owner, pastePlacement(model, clip, at));
}

/** The Clipboard's objects pasted into `owner`, carried by `t` (left where they are without). */
function pasteInto(
  b: ChangeSetBuilder,
  model: DocumentModel,
  clip: Clipboard,
  owner: Handle,
  t?: Similarity,
): EditReport {
  const map = new Map<Handle, Handle>();
  const added: [TableName, ObjectCommon][] = [];
  /** Named blocks the target has already: their contents are the target's. */
  const kept = new Set<Handle>();
  const names = new AnonymousNames(model);
  const blockNames = new Map<Handle, string>();
  for (const [t, list] of Object.entries(clip.tables) as unknown as [
    TableName,
    readonly ObjectCommon[],
  ][]) {
    for (const r of list) {
      const name = (r as SymbolTableRecord).name;
      // An anonymous block, by name or by flag (DXF 70 bit 1: an R2000 DWG keeps a dynamic block
      // under its true name with that bit, where its DXF names it `*U`).
      const anonymous =
        t === 'blockRecords' &&
        (name.startsWith('*') || (((r as BlockTableRecord).flags ?? 0) & ANONYMOUS) !== 0);
      const existing = anonymous ? undefined : byName(model, t, name);
      if (existing !== undefined) {
        map.set(r.handle, existing);
        if (t === 'blockRecords') kept.add(r.handle);
        continue;
      }
      if (BY_NAME_ONLY.has(t)) continue;
      map.set(r.handle, b.allocateHandle());
      if (anonymous) blockNames.set(r.handle, names.take(anonymousPrefix(name)));
      added.push([t, r]);
    }
  }
  for (const o of clip.objects ?? []) pasteDefinition(b, model, o, map);
  const contents = clip.blockEntities.filter((e) => !kept.has(e.owner));
  // A kept block's ATTDEFs are the target's of the same tag (a multileader's values name them).
  for (const e of clip.blockEntities) {
    if (!kept.has(e.owner) || e.geom.kind !== 'ATTDEF') continue;
    const tag = e.geom.tag.toUpperCase();
    const own = model
      .blockEntities(map.get(e.owner)!)
      .map((id) => model.entity(id)!)
      .find((d) => d.geom.kind === 'ATTDEF' && d.geom.tag.toUpperCase() === tag);
    if (own) map.set(e.handle, own.handle);
  }
  // Each object's own handle and those of what it carries (an INSERT's ATTRIBs), these first, as
  // COPY allocates them.
  for (const e of [...contents, ...clip.entities]) {
    if (e.geom.kind === 'INSERT') {
      for (const a of e.geom.attributes) map.set(a.handle, b.allocateHandle());
    }
    map.set(e.handle, b.allocateHandle());
  }

  // The layers the target will have, by name: an application's xdata naming another (a source
  // whose 1003 names no layer at all) stays behind, as the save would refuse it.
  const layerNames = new Set([...model.tables.layers.values()].map((l) => l.name.toUpperCase()));
  for (const [t, r] of added) {
    if (t === 'layers') layerNames.add((r as SymbolTableRecord).name.toUpperCase());
  }
  const xdata = (x: Xdata): Xdata | undefined => {
    const out = x.flatMap((app) => {
      const appId = map.get(app.appId);
      if (appId === undefined) return [];
      const named = app.values.every(
        (v) =>
          v.code !== XDATA_LAYER ||
          (typeof v.value === 'string' && layerNames.has(v.value.toUpperCase())),
      );
      if (!named) return [];
      const values = app.values.map((v) =>
        v.code === XDATA_HANDLE && typeof v.value === 'string'
          ? { ...v, value: map.get(v.value) ?? '0' }
          : v,
      );
      return [{ appId, values }];
    });
    return out.length > 0 ? out : undefined;
  };
  // What makes the blocks dynamic: a new record's tree, and a reference's where all it names came.
  const coded = pasteCoded(b, clip, map, kept);
  const copy = <T>(value: T): T => renumber(value, map, xdata);

  for (const [t, r] of added) {
    let out = copy(r) as SymbolTableRecord;
    const name = blockNames.get(r.handle);
    if (name !== undefined) out = { ...out, name };
    if (t === 'dimStyles') {
      const vars = { ...(out as DimStyleRecord).vars };
      for (const v of DIMVAR_REFERENCES) {
        const h = vars[v];
        if (typeof h !== 'string') continue;
        const to = map.get(h);
        if (to === undefined) delete vars[v];
        else vars[v] = to;
      }
      out = { ...out, vars } as DimStyleRecord;
    }
    b.adoptTableRecord(t, out as never);
  }
  for (const d of clip.blocks) {
    if (kept.has(d.handle) || !map.has(d.handle)) continue;
    const name = blockNames.get(d.handle);
    b.adoptBlock({ ...copy(d), ...(name !== undefined ? { name } : {}) });
  }

  for (const o of coded) b.adoptObject(o);

  const pasted: Entity[] = [];
  for (const e of contents) pasted.push(b.adoptEntity(copyEntity(e, copy)));
  const top: Entity[] = [];
  for (const e of clip.entities) {
    const entity = b.adoptEntity({ ...copyEntity(e, copy), owner });
    pasted.push(entity);
    top.push(entity);
  }
  // A hatch pasted with its whole boundary stays associative with the boundary's copies.
  const source = new Map([...contents, ...clip.entities].map((e) => [map.get(e.handle)!, e]));
  for (const h of pasted) {
    const g = h.geom;
    if (g.kind !== 'HATCH' || !g.associative) continue;
    const was = (source.get(h.handle)!.geom as HatchGeometry).loops.flatMap((l) => l.sources ?? []);
    if (was.length === 0 || !was.every((s) => map.has(s))) {
      const loops = g.loops.map(({ sources: _sources, ...l }) => l);
      b.updateEntity(h.id, { geom: { ...g, loops, associative: false } });
      continue;
    }
    for (const s of new Set(was.map((s) => map.get(s)!))) {
      const id = model.ids.idOf(s);
      const boundary = id === undefined ? undefined : b.entity(id);
      if (boundary)
        b.updateEntity(boundary.id, { reactors: [...(boundary.reactors ?? []), h.handle] });
    }
  }

  const ids = top.map((e) => e.id);
  if (t) transformObjects(b, model, ids, t);
  return { ids, refused: new Map(), unannotated: 0 };
}

/**
 * The Clipboard's coded objects as pasted, in the target's handles (`map` gains theirs and their
 * extension dictionaries'). A tree comes with its record when the record is pasted as a new one
 * (`kept`: those the target has already), and with its reference when every handle it names
 * comes too: a reference to a block the target has already would otherwise name the source's
 * graph. A handle a reactor list names that does not come is left out of the list; elsewhere it
 * is 0, as AutoCAD writes a null reference.
 */
function pasteCoded(
  b: ChangeSetBuilder,
  clip: Clipboard,
  map: Map<Handle, Handle>,
  kept: ReadonlySet<Handle>,
): CodedObject[] {
  const all = clip.coded ?? [];
  if (all.length === 0) return [];
  const byOwner = new Map<Handle, CodedObject[]>();
  for (const o of all) {
    let list = byOwner.get(o.owner);
    if (!list) byOwner.set(o.owner, (list = []));
    list.push(o);
  }
  const trees: { xdict: Handle; tree: CodedObject[] }[] = [];
  const records = (clip.tables.blockRecords ?? []) as readonly ObjectCommon[];
  for (const r of records) {
    if (r.extDict !== undefined && !kept.has(r.handle)) {
      trees.push({ xdict: r.extDict, tree: codedTree(byOwner, r.extDict) });
    }
  }
  const references: { xdict: Handle; tree: CodedObject[] }[] = [];
  // A kept block's contents are the target's; the objects pasted are all new.
  const entities = [...clip.blockEntities.filter((e) => !kept.has(e.owner)), ...clip.entities];
  for (const e of entities) {
    if (e.extDict !== undefined) {
      references.push({ xdict: e.extDict, tree: codedTree(byOwner, e.extDict) });
    }
  }
  const allocate = ({ xdict, tree }: { xdict: Handle; tree: CodedObject[] }): void => {
    map.set(xdict, b.allocateHandle());
    for (const o of tree) map.set(o.handle, b.allocateHandle());
  };
  trees.forEach(allocate);
  for (const t of references) {
    const own = new Set([t.xdict, ...t.tree.map((o) => o.handle)]);
    const named = t.tree.every((o) =>
      o.codes.every(
        ({ code, value }) =>
          !isHandleCode(code) ||
          typeof value !== 'string' ||
          value === '0' ||
          own.has(value) ||
          map.has(value),
      ),
    );
    if (named) {
      trees.push(t);
      allocate(t);
    }
  }
  return trees.flatMap(({ tree }) =>
    tree.map((o) => {
      const codes: DxfGroup[] = [];
      let inGroup = false;
      for (const g of o.codes) {
        if (g.code === 102) inGroup = String(g.value).startsWith('{');
        if (!isHandleCode(g.code) || typeof g.value !== 'string' || g.value === '0') {
          codes.push(g);
          continue;
        }
        const to = map.get(g.value);
        if (to !== undefined) codes.push({ code: g.code, value: to });
        else if (!inGroup) codes.push({ code: g.code, value: '0' });
      }
      return { ...o, handle: map.get(o.handle)!, owner: map.get(o.owner)!, codes };
    }),
  );
}

/**
 * `e` in the target's handles. A multileader's attribute value whose ATTDEF has no counterpart
 * in the target (its block is the target's, without that tag) goes.
 */
function copyEntity(e: EntityInit, copy: <T>(value: T) => T): EntityInit {
  const out = copy(e);
  const g = out.geom;
  if (g.kind !== 'MULTILEADER' || !g.block?.attributes || e.geom.kind !== 'MULTILEADER') return out;
  const was = e.geom.block!.attributes!;
  const attributes = g.block.attributes.filter(
    (a, i) => was[i]!.definition === undefined || a.definition !== undefined,
  );
  return { ...out, geom: { ...g, block: { ...g.block, attributes } } };
}

/**
 * The target's definition of `o`'s type and name (case aside), or `o` filed as a new one in the
 * target's dictionary for its type: the one `meta` names, the one the target's definitions of
 * that type are filed in, or a new dictionary the save creates under a new handle (export
 * image-objects.ts). Maps `o`'s handle to the one the pasted objects show.
 */
function pasteDefinition(
  b: ChangeSetBuilder,
  model: DocumentModel,
  o: Definition,
  map: Map<Handle, Handle>,
): void {
  const name = o.name.toUpperCase();
  let owner: Handle | undefined = model.meta[DEFINITIONS[o.type]];
  // As the change leaves them: a definition an earlier paste of the same change filed counts.
  for (const d of b.objects()) {
    if (d.type !== o.type) continue;
    if ((d as Definition).name.toUpperCase() === name) {
      map.set(o.handle, d.handle);
      return;
    }
    owner ??= d.owner;
  }
  owner ??= b.allocateHandle();
  const handle = b.allocateHandle();
  map.set(o.handle, handle);
  b.adoptObject({ ...o, handle, owner });
}

/**
 * PASTEBLOCK: the Clipboard's objects as a new block (named as AutoCAD names one, `A$C` and
 * eight hex digits), based at the Clipboard's base point, and one reference to it at `at` on
 * `layer`. Returns the reference.
 */
export function pasteAsBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  clip: Clipboard,
  owner: Handle,
  layer: Handle,
  at: Vec2,
): EditReport {
  const taken = new Set([...model.tables.blockRecords.values()].map((r) => r.name.toUpperCase()));
  let n = Number.parseInt(model.handles.handSeed, 16);
  let name: string;
  do {
    name = `A$C${(n++ % 0x100000000).toString(16).toUpperCase().padStart(8, '0')}`;
  } while (taken.has(name));
  // The block is in the Clipboard's units; its reference takes the scale into the drawing's.
  const units = clip.insUnits ?? 0;
  const def = b.addBlock({ name, basePoint: clip.base, ...(units !== 0 ? { units } : {}) });
  pasteInto(b, model, clip, def.handle);
  const k = pasteScale(model, clip);
  const ref = b.addEntity({
    owner,
    layer,
    geom: {
      kind: 'INSERT',
      block: def.handle,
      position: at,
      scale: { x: k, y: k, z: k },
      rotation: 0,
      attributes: [],
    },
  });
  return { ids: [ref.id], refused: new Map(), unannotated: 0 };
}

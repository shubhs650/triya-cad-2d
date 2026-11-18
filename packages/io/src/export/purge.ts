// TriyaToAcad for PURGE (M1-75 part 25): the table records and block definitions a drawing no
// longer has go from the saved file, as AutoCAD's PURGE takes them (and LAYDEL, VIEW Delete,
// the UCS dialog's Delete, which remove the same records). Each goes with everything it owns:
// its extension dictionary and, for a block, its BLOCK and ENDBLK and the entities the same save
// erases from it.
//
// AutoCAD purges only what nothing refers to, and a save that left a reference to a removed
// record would write a dangling handle (an AUDIT error) or, through acad-ts's table, quietly move
// the referrer to the table's default record. So a record is refused while anything the saved
// drawing keeps still refers to it: what Triya maps is checked in the model (an entity's layer, a
// layer's linetype, a dimension style's text style, xdata, the name variables of the header),
// everything else in the acad-ts original, field by field (objects Triya does not map, and the
// fields it does not map of those it does). An object the same save changes refers to the
// record only if its new state does, or if the reference is in a field Triya does not map.
//
// Part 27 adds multileader and table styles, which are entries of the ACAD_MLEADERSTYLE and
// ACAD_TABLESTYLE dictionaries (PURGE, and the Delete button of the MLEADERSTYLE and TABLESTYLE
// dialogs), and VPORT records: the tiles VPORTS Join takes and the named configurations the
// VPORTS dialog deletes. AutoCAD keeps the first *Active record as the current viewport (DXF
// reference, VPORT: "the first such entry describes the current viewport"), so that one stays.
//
// Part 29 adds the other objects PURGE takes: MLINE styles, materials, visual styles and the
// plot style names of a named-plot-style drawing, entries of ACAD_MLINESTYLE, ACAD_MATERIAL,
// ACAD_VISUALSTYLE and ACAD_PLOTSTYLENAME that Triya maps by name. AutoCAD keeps Standard, the
// ByLayer, ByBlock and Global materials, the Normal plot style and its default visual styles.
// Some of what refers to them is a bare handle in acad-ts (an entity's or layer's plot style
// name, a 3D solid's face materials, the header's $CMATERIAL and interference visual styles), so
// those fields are read as references too.
//
// XREF Detach (M5-04 part 1) removes an xref's block record: its BLOCK and ENDBLK go as any
// block's do, and the `xref|symbol` records the host kept of it (VISRETAIN) go with it; an
// xref-dependent record of an xref that stays is still refused.
//
// Not purged here: shapes kept as nameless STYLE records.

import type { CadDocument } from '@node-projects/acad-ts';
import {
  ACadVersion,
  Entity as AcadEntity,
  AcdbPlaceHolder,
  AppId,
  BlockRecord,
  CadDictionary,
  CadDictionaryWithDefault,
  CadObject,
  DictionaryVariable,
  DimensionStyle,
  ExtendedDataReference,
  Insert,
  Layer,
  LineType,
  Material,
  MLineStyle,
  MultiLeaderStyle,
  Polyline,
  Seqend,
  Table,
  TableStyle,
  TextStyle,
  UCS,
  View,
  VisualStyle,
  VPort,
  XRecordEntry,
  XY,
  XYZ,
  type TableEntry,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, TableName } from '@triya/engine';
import { hex } from '../map/common';
import { entryKey } from './dictionary-entries';
import { resolve, type Resolver } from './entities';
import { documentObjects } from './passthrough';

type Purgeable =
  | 'layers'
  | 'linetypes'
  | 'textStyles'
  | 'dimStyles'
  | 'appIds'
  | 'ucs'
  | 'views'
  | 'vports'
  | 'mleaderStyles'
  | 'tableStyles'
  | 'blockRecords'
  | 'mlineStyles'
  | 'materials'
  | 'visualStyles'
  | 'plotStyles';

/**
 * A table record, or a style kept as a dictionary entry (MLEADERSTYLE, TABLESTYLE, MLINESTYLE,
 * MATERIAL, VISUALSTYLE, a plot style's ACDBPLACEHOLDER).
 */
type Named = CadObject & { name: string };

interface TableRules {
  /** What the problems call a record, as records.ts does. */
  readonly what: string;
  readonly type: abstract new (...args: never[]) => Named;
  /**
   * Records AutoCAD never purges (AutoCAD 2024 PURGE and LAYDEL): layer 0 and Defpoints, the
   * ByLayer, ByBlock and Continuous linetypes, the Standard text, dimension, multileader,
   * table and MLINE styles, the ACAD application every drawing registers, the ByLayer, ByBlock
   * and Global materials, the Normal plot style, and the default visual styles (the Visual
   * Styles Manager: "a default visual style … cannot be deleted").
   */
  readonly fixed: readonly string[];
  /**
   * Header variables (and DICTIONARYVARs, by their bare names) that name a record of the table:
   * AutoCAD looks them up by name.
   */
  readonly header: readonly string[];
}

const TABLES: Readonly<Record<Purgeable, TableRules>> = {
  layers: {
    what: 'layer',
    type: Layer,
    fixed: [Layer.defaultName, 'Defpoints'],
    header: ['$CLAYER'],
  },
  linetypes: {
    what: 'linetype',
    type: LineType,
    fixed: [LineType.byLayerName, LineType.byBlockName, LineType.continuousName],
    header: ['$CELTYPE', '$DIMLTYPE', '$DIMLTEX1', '$DIMLTEX2'],
  },
  textStyles: {
    what: 'text style',
    type: TextStyle,
    fixed: [TextStyle.defaultName],
    header: ['$TEXTSTYLE', '$DIMTXSTY'],
  },
  dimStyles: {
    what: 'dimension style',
    type: DimensionStyle,
    fixed: [DimensionStyle.defaultName],
    header: ['$DIMSTYLE'],
  },
  appIds: {
    what: 'application',
    type: AppId,
    fixed: [AppId.defaultName],
    header: [],
  },
  ucs: {
    what: 'UCS',
    type: UCS,
    fixed: [],
    header: ['$UCSNAME', '$PUCSNAME', '$UCSBASE', '$PUCSBASE', '$UCSORTHOREF', '$PUCSORTHOREF'],
  },
  views: { what: 'view', type: View, fixed: [], header: [] },
  // The first *Active record, the current viewport, is checked in planPurge.
  vports: { what: 'viewport', type: VPort, fixed: [], header: [] },
  mleaderStyles: {
    what: 'multileader style',
    type: MultiLeaderStyle,
    fixed: [MultiLeaderStyle.defaultName],
    header: [DictionaryVariable.currentMultiLeaderStyle],
  },
  tableStyles: {
    what: 'table style',
    type: TableStyle,
    fixed: [TableStyle.defaultName],
    header: [DictionaryVariable.currentTableStyle],
  },
  blockRecords: {
    what: 'block',
    type: BlockRecord,
    fixed: [],
    header: ['$DIMBLK', '$DIMBLK1', '$DIMBLK2', '$DIMLDRBLK'],
  },
  mlineStyles: {
    what: 'MLINE style',
    type: MLineStyle,
    fixed: [MLineStyle.defaultName],
    header: ['$CMLSTYLE'],
  },
  materials: {
    what: 'material',
    type: Material,
    fixed: [Material.byLayerName, Material.byBlockName, 'Global'],
    header: ['$CMATERIAL'],
  },
  // Internal visual styles (DXF 291) are checked in planPurge.
  visualStyles: {
    what: 'visual style',
    type: VisualStyle,
    fixed: [
      VisualStyle.defaultName,
      'Wireframe',
      'Hidden',
      'Realistic',
      'Conceptual',
      'Shaded',
      'Shaded with edges',
      'Shades of Gray',
      'Sketchy',
      'X-Ray',
    ],
    header: ['$INTERFEREOBJVS', '$INTERFEREVPVS'],
  },
  plotStyles: { what: 'plot style', type: AcdbPlaceHolder, fixed: ['Normal'], header: [] },
};

/** DXF 70 bits of a record an xref brings (16, 32) and of an xref's own block (4, 8 overlay). */
const XREF_DEPENDENT = 16 | 32;
const XREF_BLOCK = 4 | 8;

/** A layout's block: it goes with its layout (LAYOUT Delete, layouts.ts). */
const LAYOUT_BLOCK = /^\*(model|paper)_space/i;

/**
 * Keys of the Triya model whose values are handles (engine model/types.ts), and the dimension
 * style variables that hold one. A handle under any other key is not a reference.
 */
const HANDLE_KEYS = new Set([
  'layer',
  'linetype',
  'style',
  'textStyle',
  'block',
  'arrowhead',
  'definition',
  'frozenLayers',
  'plotStyle',
  'material',
  'visualStyle',
  'clipBoundary',
  'annotation',
  'sources',
  'blockRecord',
  'layout',
  'appId',
  'scales',
  'entities',
  'entity',
  'sort',
  'owner',
  'dynamicOf',
  'DIMTXSTY',
  'DIMLDRBLK',
  'DIMBLK',
  'DIMBLK1',
  'DIMBLK2',
  'DIMLTYPE',
  'DIMLTEX1',
  'DIMLTEX2',
]);

/** Xdata group codes that hold a handle: 1003 a layer (acad-ts keeps its handle), 1005. */
const XDATA_HANDLES = new Set([1003, 1005]);

/** The handle an xdata value holds: hex text, or the number a 1003 layer keeps (mapXdata). */
const xdataHandle = (v: unknown): Handle | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' ? hex(v) : undefined;

/**
 * acad-ts fields holding a bare handle rather than the object: an entity's or layer's plot style
 * name (DXF 390), a 3D solid's face materials, and the header's material and visual styles.
 */
const HANDLE_FIELDS = new Set([
  'plotStyleName',
  'materialHandle',
  'currentMaterialHandle',
  'interfereObjectVisualStyleHandle',
  'interfereViewportVisualStyleHandle',
]);

/** Group codes of an XRECORD entry that hold a handle (DXF reference, group code ranges). */
const isHandleCode = (c: number): boolean =>
  (c >= 320 && c <= 369) || (c >= 390 && c <= 399) || (c >= 480 && c <= 481) || c === 1005;

/** acad-ts fields that are not drawing data, or are the owner link (an owned object goes with it). */
const SKIPPED_FIELDS = new Set(['document', '_referenceHandler', 'owner', '_owner', 'handle']);
const MAX_DEPTH = 24;

export interface PurgePlan {
  /** Each goes from what owns it: its symbol table, or the dictionary listing it. */
  readonly removed: Named[];
}

interface Target {
  readonly table: Purgeable;
  readonly handle: Handle;
  readonly name: string;
  readonly acad: Named;
  /** Who refers to it: referrer key → what the problem says. */
  readonly referrers: Map<string, string>;
}

/** Whether a Triya model value refers to the record `handle`. */
function modelRefers(v: unknown, handle: Handle, key = ''): boolean {
  if (typeof v === 'string') return v === handle && HANDLE_KEYS.has(key);
  if (Array.isArray(v)) return v.some((x) => modelRefers(x, handle, key));
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.code === 'number' && 'value' in o && Object.keys(o).length === 2) {
    return XDATA_HANDLES.has(o.code) && xdataHandle(o.value) === handle;
  }
  for (const [k, x] of Object.entries(o)) {
    if (k === 'handle' || k === 'raw') continue;
    if (modelRefers(x, handle, k)) return true;
  }
  return false;
}

/** Adds every record handle a Triya model value refers to ({@link modelRefers}'s keys) to `out`. */
function modelHandles(v: unknown, out: Set<Handle>, key = ''): void {
  if (typeof v === 'string') {
    if (HANDLE_KEYS.has(key)) out.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) modelHandles(x, out, key);
    return;
  }
  if (v === null || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  if (typeof o.code === 'number' && 'value' in o && Object.keys(o).length === 2) {
    if (XDATA_HANDLES.has(o.code) && xdataHandle(o.value) !== undefined)
      out.add(xdataHandle(o.value)!);
    return;
  }
  for (const [k, x] of Object.entries(o)) {
    if (k === 'handle' || k === 'raw') continue;
    modelHandles(x, out, k);
  }
}

/** Every handle-bearing value of a Triya document (entities, records, blocks, layouts, objects). */
function modelIndex(
  m: {
    entities: Iterable<{ handle: Handle }>;
    tables: Iterable<Iterable<{ handle: Handle }>>;
    blocks: Iterable<{ handle: Handle }>;
    layouts: Iterable<{ handle: Handle }>;
    objects: Iterable<{ handle: Handle }>;
  },
  attributes = false,
): Map<Handle, unknown[]> {
  const out = new Map<Handle, unknown[]>();
  const add = (v: { handle: Handle }) => {
    const at = out.get(v.handle);
    if (at) at.push(v);
    else out.set(v.handle, [v]);
  };
  for (const e of m.entities) {
    add(e);
    // An INSERT's ATTRIBs and a multileader's, each under its own handle (purgePinned).
    const g = (e as { geom?: { attributes?: readonly { handle?: Handle }[] } }).geom;
    if (attributes) for (const a of g?.attributes ?? []) if (a.handle) add(a as { handle: Handle });
  }
  for (const t of m.tables) for (const r of t) add(r);
  for (const b of m.blocks) add(b);
  for (const l of m.layouts) add(l);
  for (const o of m.objects) add(o);
  return out;
}

/** Calls `found` for every CadObject `root`'s fields (and xdata, and XRECORD entries) refer to. */
function acadReferences(root: object, found: (target: CadObject | number) => void): void {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== 'object' || depth > MAX_DEPTH) return;
    if (v instanceof CadObject && v !== root) {
      found(v);
      return;
    }
    // Points and point lists refer to nothing (the bulk of an object's fields).
    if (v instanceof XYZ || v instanceof XY) return;
    if (Array.isArray(v) && (typeof v[0] === 'number' || v[0] instanceof XYZ || v[0] instanceof XY))
      return;
    if (seen.has(v)) return;
    seen.add(v);
    if (v instanceof ExtendedDataReference) {
      found(v.value as number);
      return;
    }
    if (v instanceof XRecordEntry) {
      if (typeof v.value === 'number' && isHandleCode(v.code)) found(v.value);
      else walk(v.value, depth + 1);
      return;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k, depth + 1);
        walk(x, depth + 1);
      }
      return;
    }
    if (Array.isArray(v) || v instanceof Set) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (SKIPPED_FIELDS.has(k) || typeof x === 'function') continue;
      if (typeof x === 'number') {
        if (x !== 0 && HANDLE_FIELDS.has(k)) found(x);
        continue;
      }
      walk(x, depth + 1);
    }
  };
  walk(root, 0);
}

/** A handle acad-ts made up reading an R12 file, which states none for the object. */
function madeUp(doc: CadDocument, handle: number): boolean {
  const m = doc.madeUpHandles;
  return !!m && (m.added.has(handle) || (handle >= m.first && handle <= m.last));
}

const sameName = (a: unknown, name: string, handle: Handle) =>
  typeof a === 'string' && (a.toUpperCase() === name.toUpperCase() || a === handle);

/**
 * Why the save cannot purge the record `b` whatever refers to it (its kind, name or place in
 * the file), or undefined. `ofDetached` says whether an xref-dependent name belongs to an xref
 * the same save detaches.
 */
function recordProblem(
  doc: CadDocument,
  rules: TableRules,
  b: { readonly name: string; readonly flags?: number },
  acad: Named | undefined,
  r12: boolean,
  ofDetached: (name: string) => boolean,
): string | undefined {
  const flags = b.flags ?? 0;
  if (!acad) return `the original is not a ${rules.what}`;
  if (rules.fixed.some((n) => n.toUpperCase() === b.name.toUpperCase()))
    return `${b.name} cannot be purged`;
  if (b.name === '') return 'a nameless record (a shape file) cannot be purged';
  if (acad instanceof VisualStyle && acad.internalFlag)
    return 'an internal visual style (DXF 291) cannot be purged';
  if (acad.owner instanceof CadDictionaryWithDefault && acad.owner.defaultEntry === acad)
    return `it is the default of ${acad.owner.name || 'its dictionary'}`;
  if ((flags & XREF_DEPENDENT) !== 0 && !ofDetached(b.name))
    return `an xref-dependent ${rules.what} goes with its xref (XREF Detach)`;
  if (acad instanceof VPort && doc.vPorts?.tryGetValue(VPort.defaultName) === acad)
    return 'the first *Active viewport is the current one (VPORTS Join keeps it and changes its view)';
  if (r12 && madeUp(doc, acad.handle))
    return `the file states no handle for this ${rules.what} (acad-ts numbers it on reading, and the records after it would be renumbered)`;
  return undefined;
}

const isR12 = (doc: CadDocument): boolean => {
  const version = doc.header?.version;
  return version !== undefined && version !== ACadVersion.Unknown && version <= ACadVersion.AC1009;
};

/**
 * The records an edit of the drawing can never let the save purge (PURGE, M5-09): those
 * {@link planPurge} refuses for what they are, the blocks holding an object Triya keeps without
 * mapping (it cannot be erased), and those referred to where the Triya document does not show it
 * (an object or field Triya does not map, the header beyond its name variables). Read once with
 * the document, so the engine's PURGE only offers what a save can take. An over-cautious answer
 * only keeps a record; a missing one would make the save refuse the change.
 */
export function purgePinned(doc: CadDocument, base: DocumentInit): Handle[] {
  const pinned = new Set<Handle>();
  const objects = documentObjects(doc);
  const r12 = isR12(doc);
  const byObject = new Map<CadObject, Handle>();
  const byHandle = new Map<number, Handle>();
  const tableOf = new Map<Handle, Purgeable>();
  // The entities Triya maps (an INSERT's ATTRIBs too), by handle.
  const entities = new Map<Handle, unknown>();
  for (const e of base.entities ?? []) {
    entities.set(e.handle, e);
    const g = e.geom as { attributes?: readonly { handle?: Handle }[] };
    for (const a of g.attributes ?? []) if (a.handle) entities.set(a.handle, a);
  }
  for (const table of Object.keys(TABLES) as Purgeable[]) {
    const rules = TABLES[table];
    for (const b of base.tables?.[table] ?? []) {
      const o = objects.get(parseInt(b.handle, 16));
      const acad = o instanceof rules.type ? o : undefined;
      if (recordProblem(doc, rules, b, acad, r12, () => false) || !acad) {
        pinned.add(b.handle);
        continue;
      }
      // A block holding an object Triya keeps unmapped, which no edit can erase. A layout's
      // block (model space's is the big one) never purges, so it is not looked through.
      if (
        acad instanceof BlockRecord &&
        !LAYOUT_BLOCK.test(acad.name) &&
        !acad.layout &&
        [...acad.entities].some((e) => !entities.has(hex(e.handle)))
      )
        pinned.add(b.handle);
      byObject.set(acad, b.handle);
      byHandle.set(acad.handle, b.handle);
      tableOf.set(b.handle, table);
    }
  }
  // The model's objects by handle; entities only as needed (a referrer's owner), as indexing
  // a 100k-entity drawing's would cost more than the rest.
  const index = modelIndex({
    entities: [],
    tables: Object.values(base.tables ?? {}),
    blocks: base.blocks ?? [],
    layouts: base.layouts ?? [],
    objects: base.objects ?? [],
  });
  for (const [h, e] of entities) if (!index.has(h)) index.set(h, [e]);
  // What each model object refers to, gathered once per object asked about.
  const refsOf = new Map<Handle, Set<Handle>>();
  const refers = (h: Handle, target: Handle) => {
    let refs = refsOf.get(h);
    if (!refs) {
      refs = new Set();
      for (const v of index.get(h) ?? []) modelHandles(v, refs);
      refsOf.set(h, refs);
    }
    return refs.has(target);
  };
  for (const o of objects.values()) {
    if (o instanceof Table) continue;
    const h = hex(o.handle);
    // An entity Triya maps shows its references in the model, which the engine reads itself:
    // walking every one would add most of a second to opening a 100k-entity drawing. The 1003
    // layer handles of their xdata, which mapXdata keeps as numbers, count there too
    // (`xdataHandle`). The public corpus purges and saves with no refusal (purge.corpus.test.ts).
    if (o instanceof AcadEntity && entities.has(h)) continue;
    acadReferences(o, (x) => {
      const t = typeof x === 'number' ? byHandle.get(x) : byObject.get(x);
      if (t === undefined || pinned.has(t) || h === t) return;
      const acad = typeof x === 'number' ? objects.get(x) : x;
      // The table or dictionary listing a record does not refer to it.
      if (acad?.owner === o || refers(h, t)) return;
      // A VERTEX, an ATTRIB's or a polyline's SEQEND is on its owner's layer as the save writes it.
      const parent = o.owner;
      if (
        tableOf.get(t) === 'layers' &&
        (parent instanceof Polyline || parent instanceof Insert) &&
        refers(hex(parent.handle), t)
      )
        return;
      pinned.add(t);
    });
  }
  // A layer purged leaves the layer states that name it, a change a file older than R2000
  // cannot save (layer-states.ts): there, a layer a state names stays.
  const version = doc.header?.version;
  if (version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015) {
    for (const o of base.objects ?? []) {
      if (o.type !== 'LAYER_STATE') continue;
      for (const l of (o as { layers?: readonly { layer?: Handle }[] }).layers ?? [])
        if (l.layer !== undefined) pinned.add(l.layer);
    }
  }
  const header = new Map(base.header ?? []);
  if (doc.header) {
    acadReferences(doc.header, (x) => {
      const t = typeof x === 'number' ? byHandle.get(x) : byObject.get(x);
      if (t === undefined || pinned.has(t)) return;
      const acad = (typeof x === 'number' ? objects.get(x) : x) as Named | undefined;
      const table = tableOf.get(t)!;
      const named = TABLES[table].header.some((n) => sameName(header.get(n), acad?.name ?? '', t));
      if (!named) pinned.add(t);
    });
  }
  return [...pinned];
}

/**
 * The records and blocks the model no longer has, and why any cannot go. `removedEntities` are
 * the originals of the entities the same save erases.
 */
export function planPurge(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  removedEntities: readonly AcadEntity[],
): { plan: PurgePlan; problems: string[] } {
  const plan: PurgePlan = { removed: [] };
  const problems: string[] = [];
  const r12 = isR12(doc);
  const targets: Target[] = [];
  // XREF Detach (M5-04): an xref's block goes, and with it the `xref|name` records the drawing
  // keeps of its symbols (VISRETAIN), as AutoCAD's detach takes them.
  const detached = (base.tables?.blockRecords ?? [])
    .filter((b) => ((b.flags ?? 0) & XREF_BLOCK) !== 0 && !model.tables.blockRecords.has(b.handle))
    .map((b) => `${b.name.toUpperCase()}|`);
  const ofDetached = (name: string) => detached.some((p) => name.toUpperCase().startsWith(p));
  for (const table of Object.keys(TABLES) as Purgeable[]) {
    const rules = TABLES[table];
    const after = model.tables[table as TableName];
    for (const b of base.tables?.[table] ?? []) {
      if (after.has(b.handle)) continue;
      const out: string[] = [];
      const acad = resolve(r, b.handle, rules.type);
      const why = recordProblem(doc, rules, b, acad, r12, ofDetached);
      if (why) out.push(why);
      if (acad && table === 'blockRecords')
        out.push(...blockProblems(acad as BlockRecord, b, base, model, removedEntities));
      if (out.length > 0) {
        problems.push(...out.map((p) => `${rules.what} ${b.name} (${b.handle}): ${p}`));
        continue;
      }
      targets.push({ table, handle: b.handle, name: b.name, acad: acad!, referrers: new Map() });
    }
  }
  // A block definition goes with its record (ChangeSetBuilder.removeBlock): one without the
  // other cannot be written.
  for (const d of base.blocks ?? []) {
    if (!model.blocks.has(d.handle) && model.tables.blockRecords.has(d.handle))
      problems.push(
        `block ${d.name} (${d.handle}): its definition goes but its BLOCK_RECORD stays`,
      );
  }
  if (targets.length === 0) return { plan, problems };

  const byObject = new Map<CadObject, Target>(targets.map((t) => [t.acad, t]));
  const byHandle = new Map<number, Target>(targets.map((t) => [t.acad.handle, t]));
  const before = modelIndex({
    entities: base.entities ?? [],
    tables: Object.values(base.tables ?? {}),
    blocks: base.blocks ?? [],
    layouts: base.layouts ?? [],
    objects: base.objects ?? [],
  });
  const after = modelIndex({
    entities: model.entities(),
    tables: Object.values(model.tables).map((t) => t.values()),
    blocks: model.blocks.values(),
    layouts: model.layouts,
    objects: model.objects.values(),
  });
  const objectName = (h: Handle, fallback: string) =>
    (r.store.original(h) ?? r.created.get(h))?.objectName ?? fallback;

  // What the saved drawing keeps, as Triya maps it.
  for (const [h, values] of after) {
    for (const t of targets) {
      if (h === t.handle || !values.some((v) => modelRefers(v, t.handle))) continue;
      const v = values[0] as { type?: string };
      t.referrers.set(h, `${objectName(h, v.type ?? 'object')} ${h} refers to it`);
    }
  }
  const headerBefore = new Map(base.header ?? []);
  for (const t of targets) {
    for (const name of TABLES[t.table].header) {
      if (sameName(model.header.get(name), t.name, t.handle))
        t.referrers.set(name, `${name} names it`);
    }
  }

  // What it keeps that Triya does not map. Whatever goes in the same save (the purged records,
  // the entities it erases, what Triya removes) takes what it owns with it.
  const going = new Set<CadObject>([...removedEntities, ...byObject.keys()]);
  for (const [h] of before) {
    if (after.has(h)) continue;
    const o = r.store.original(h);
    if (o) going.add(o);
  }
  const goes = (o: CadObject): boolean => {
    for (
      let at: CadObject | null = o, i = 0;
      at && i < MAX_DEPTH;
      at = at.owner as CadObject | null, i++
    ) {
      if (going.has(at)) return true;
    }
    return false;
  };
  const refersAfter = (h: Handle, t: Target) =>
    (after.get(h) ?? []).some((v) => modelRefers(v, t.handle));
  const refersBefore = (h: Handle, t: Target) =>
    (before.get(h) ?? []).some((v) => modelRefers(v, t.handle));
  for (const o of documentObjects(doc).values()) {
    if (o instanceof Table || goes(o)) continue;
    const h = hex(o.handle);
    acadReferences(o, (x) => {
      const t = typeof x === 'number' ? byHandle.get(x) : byObject.get(x);
      // The table or dictionary listing a record does not refer to it.
      if (!t || t.referrers.has(h) || t.acad.owner === o) return;
      // A reference Triya maps that the save changes away.
      if (after.has(h) && refersBefore(h, t) && !refersAfter(h, t)) return;
      // A polyline's VERTEX and SEQEND and an INSERT's SEQEND go to their owner's new layer
      // when the save moves it (writeProps): LAYMRG or a merge in the Layer Properties Manager
      // moving a block reference with attributes off a layer it purges (M5-06 part 2).
      const parent = o.owner;
      if (
        t.table === 'layers' &&
        (parent instanceof Polyline || (parent instanceof Insert && o instanceof Seqend))
      ) {
        const p = hex(parent.handle);
        if (after.has(p) && refersBefore(p, t) && !refersAfter(p, t)) return;
      }
      t.referrers.set(h, `${o.objectName} ${h} refers to it`);
    });
  }
  if (doc.header) {
    acadReferences(doc.header, (x) => {
      const t = typeof x === 'number' ? byHandle.get(x) : byObject.get(x);
      if (!t || t.referrers.has('header')) return;
      // A name variable Triya maps: the model's header said above whether it still names it.
      const named = TABLES[t.table].header.some((n) =>
        sameName(headerBefore.get(n), t.name, t.handle),
      );
      if (!named) t.referrers.set('header', 'the header refers to it');
    });
  }

  for (const t of targets) {
    const rules = TABLES[t.table];
    const refs = [...t.referrers.values()];
    if (refs.length === 0) {
      plan.removed.push(t.acad);
      continue;
    }
    const shown = refs.slice(0, 3);
    if (refs.length > 3) shown.push(`and ${refs.length - 3} more refer to it`);
    problems.push(...shown.map((p) => `${rules.what} ${t.name} (${t.handle}): ${p}`));
  }
  return { plan, problems };
}

function blockProblems(
  acad: BlockRecord,
  b: { readonly name: string; readonly flags?: number; readonly layout?: unknown },
  base: DocumentInit,
  model: DocumentModel,
  removedEntities: readonly AcadEntity[],
): string[] {
  // A layout's block goes with its layout (LAYOUT Delete), which layouts.ts checks. Only a layout
  // the drawing mapped can be deleted: one whose block link reading could not repair (M2-69)
  // maps no layout, yet the block may still name it (M2-49).
  const layoutGoes =
    typeof b.layout === 'string' &&
    (base.layouts ?? []).some((l) => l.handle === b.layout) &&
    !model.layouts.some((l) => l.handle === b.layout);
  if (!layoutGoes && (b.layout !== undefined || LAYOUT_BLOCK.test(b.name)))
    return ["a layout's block goes with its layout (LAYOUT Delete)"];
  // An xref's block (XREF Detach) holds nothing in the host's file; its references go in the
  // same save, or the checks below keep it.
  const out: string[] = [];
  if (model.blocks.has(hex(acad.handle))) out.push('its block definition stays');
  const erased = new Set<CadObject>(removedEntities);
  const kept = [...acad.entities].filter((e) => !erased.has(e));
  if (kept.length > 0)
    out.push(
      `it still holds ${kept.length} ${kept.length === 1 ? 'entity' : 'entities'} (${kept[0]!.objectName} ${hex(kept[0]!.handle)})`,
    );
  return out;
}

/**
 * Takes the planned records out of their tables, and the styles out of their dictionaries.
 * acad-ts's table hands whatever it still lists as referring to a removed record to the table's
 * default record, so those listings (left by referrers that have since moved on, or gone) are
 * dropped first: nothing that stays refers to the record (planPurge). A record whose name repeats
 * (a VPORT tile after the first) is keyed by its handle as well.
 */
export function writePurge(plan: PurgePlan): void {
  for (const acad of plan.removed) {
    const owner = acad.owner;
    if (owner instanceof CadDictionary) {
      const key = entryKey(owner, acad);
      if (key === undefined || !owner.remove(key))
        throw new Error(
          `${acad.objectName} ${acad.name}: acad-ts did not remove it from its dictionary`,
        );
      continue;
    }
    const table = owner as Table<TableEntry>;
    const entry = acad as TableEntry;
    for (const referrer of [...table.getReferences(entry.name)])
      table.removeReference(entry.name, referrer);
    const key =
      table.tryGetValue(entry.name) === entry ? entry.name : `${entry.handle}:${entry.name}`;
    if (table.remove(key) !== entry) {
      throw new Error(`${acad.objectName} ${acad.name}: acad-ts did not remove it from its table`);
    }
  }
}

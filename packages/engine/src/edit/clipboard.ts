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
// A pasted object is a copy (edit.ts): no reactors, extension dictionary or annotation scales, so
// no associativity or group membership, except that a hatch pasted with its whole boundary stays
// associative with the boundary's copies. Materials and plot style names are kept by name only
// in Triya (types.ts `TableRecords`), so a pasted object keeps one only where the target has it.
//
// What the target cannot take yet is left out when copying, with a reason: images and PDF
// underlays (their definitions are dictionary objects of the source), viewports (a layout's),
// external references (their content lives in another file) and what COPY refuses.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import { sub } from '../geom/vec';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { isHandle, type Handle } from '../model/handle';
import type {
  BlockDefinition,
  DimStyleRecord,
  Entity,
  EntityInit,
  HatchGeometry,
  LayerRecord,
  ObjectCommon,
  SymbolTableRecord,
  TableName,
  TableRecords,
  TableStyleRecord,
  Xdata,
} from '../model/types';
import { HANDLE_KEYS, isXrefRecord, renumber } from '../model/xref';
import { AnonymousNames, copyProblem, transformObjects, type EditReport } from './edit';
import { moveBy } from './similarity';

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

/** Why `e` cannot go on the Clipboard, or undefined. */
function clipboardProblem(model: DocumentModel, e: Entity): string | undefined {
  const g = e.geom;
  if (g.kind === 'IMAGE' && g.definition !== undefined) {
    return 'an image cannot be pasted into another drawing yet';
  }
  if (g.kind === 'PDFUNDERLAY') return 'an underlay cannot be pasted into another drawing yet';
  if (g.kind === 'VIEWPORT') return 'a viewport cannot be pasted';
  if (g.kind === 'MULTILEADER' && g.block?.attributes?.some((a) => a.definition !== undefined)) {
    // Its attribute values name the content block's ATTDEFs, which the save can only find in
    // the drawing it read (export entities.ts), not among the ones the paste adds.
    return 'a multileader with block attributes cannot be pasted into another drawing yet';
  }
  if (g.kind === 'INSERT' && isXrefRecord(model.tables.blockRecords.get(g.block))) {
    return 'an external reference cannot be pasted yet';
  }
  return copyProblem(e, moveBy({ x: 0, y: 0 }));
}

/** The xdata a copy keeps: all but the annotative property's, as COPY's (edit.ts). */
function keptXdata(model: DocumentModel, xdata: Xdata | undefined): Xdata | undefined {
  if (!xdata) return undefined;
  const kept = xdata.filter(
    (x) => model.tables.appIds.get(x.appId)?.name.toUpperCase() !== 'ACADANNOTATIVE',
  );
  return kept.length > 0 ? kept : undefined;
}

/** What a copied object or record keeps of its common fields. */
function common<T extends ObjectCommon>(model: DocumentModel, o: T): T {
  const { raw: _raw, reactors: _reactors, extDict: _extDict, xdata, ...rest } = o;
  const kept = keptXdata(model, xdata);
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
  // A new object cannot take a colour book's name yet (the save refuses it): the copy keeps
  // the colour's RGB value, as COPY's does.
  const c = rest.color;
  const color =
    c.kind === 'rgb' && (c.bookName !== undefined || c.colorName !== undefined)
      ? { kind: 'rgb' as const, r: c.r, g: c.g, b: c.b }
      : c;
  return { ...rest, color, geom };
}

/**
 * A record as the Clipboard holds it. Its xdata stays behind: what Triya reads of a record's
 * xdata is in its fields (a text style's TrueType bits, a layer's description), which the save
 * writes for a new record, and the save takes no other xdata on one.
 */
function clipRecord(model: DocumentModel, table: TableName, r: ObjectCommon): ObjectCommon {
  const { xdata: _xdata, ...out } = common(model, r);
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

/** A block definition as the Clipboard holds it: its own entities and record, nothing more. */
function clipBlock(model: DocumentModel, d: BlockDefinition): BlockDefinition {
  const {
    beginHandle: _b,
    endHandle: _e,
    // A dynamic block's graph is in its extension dictionary, which a copy does not keep.
    dynamic: _dynamic,
    dynamicOf: _dynamicOf,
    xrefLoaded: _loaded,
    // As a record's (clipRecord).
    xdata: _xdata,
    ...rest
  } = common(model, d);
  return rest;
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
  const pending: Handle[] = [];
  const take = (e: Entity, into: EntityInit[]): void => {
    const problem = clipboardProblem(model, e);
    if (problem) {
      count(refused, problem);
      return;
    }
    if (e.annotative) unannotated++;
    const c = clipEntity(model, e);
    into.push(c);
    references(c, pending, layers);
  };
  for (const e of sorted) take(e, entities);
  while (pending.length > 0) {
    const h = pending.pop()!;
    const table = tableOf.get(h);
    if (!table) continue;
    let list = records.get(table);
    if (!list) records.set(table, (list = new Map()));
    if (list.has(h)) continue;
    const r = clipRecord(model, table, model.tables[table].get(h)!);
    list.set(h, r);
    references(r, pending, layers);
    const def = table === 'blockRecords' ? model.blocks.get(h) : undefined;
    if (def) {
      const d = clipBlock(model, def);
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
    },
    refused,
    unannotated,
  };
}

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

/**
 * PASTECLIP: the Clipboard's objects pasted into `owner` with its base point at `at` (PASTEORIG:
 * `at` is the base point itself). Returns the objects pasted.
 */
export function pasteObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  clip: Clipboard,
  owner: Handle,
  at: Vec2,
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
      const anonymous = t === 'blockRecords' && name.startsWith('*');
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
  const contents = clip.blockEntities.filter((e) => !kept.has(e.owner));
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

  const pasted: Entity[] = [];
  for (const e of contents) pasted.push(b.adoptEntity(copy(e)));
  const top: Entity[] = [];
  for (const e of clip.entities) {
    const entity = b.adoptEntity({ ...copy(e), owner });
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
  const d = sub(at, clip.base);
  if (d.x !== 0 || d.y !== 0) transformObjects(b, model, ids, moveBy(d));
  return { ids, refused: new Map(), unannotated: 0 };
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
  const def = b.addBlock({ name, basePoint: clip.base });
  pasteObjects(b, model, clip, def.handle, clip.base);
  const ref = b.addEntity({
    owner,
    layer,
    geom: {
      kind: 'INSERT',
      block: def.handle,
      position: at,
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    },
  });
  return { ids: [ref.id], refused: new Map(), unannotated: 0 };
}

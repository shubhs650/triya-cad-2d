// PURGE (M5-09): the named objects nothing uses, and the unnamed objects nothing needs, after
// AutoCAD 2024's PURGE and -PURGE (AutoCAD Help, "PURGE (Command)", "Purge Dialog Box",
// "-PURGE (Command)"):
//
//   - Named items: block definitions, dimension styles, groups, layers, linetypes, materials,
//     multileader styles, plot styles, text styles, MLINE styles, table styles, visual styles and
//     registered applications (-PURGE Regapps). AutoCAD's detail and section view styles belong
//     to model documentation, which Triya does not have (PRD non-goal 1); shapes kept as nameless
//     STYLE records stay (the save cannot purge them, purge.ts in @triya/io).
//   - An item is purgeable when nothing that stays refers to it: an object in model space, a
//     layout or a block definition, another record (a layer's linetype, a dimension style's text
//     style), an object (a multileader style's block, a layer state's linetype), xdata (a
//     registered application, a 1005 handle), or a header variable that names it (the current
//     layer, text style, dimension style …). Every reference is a handle under one of the keys
//     the save's own check reads (HANDLE_KEYS, as in @triya/io's planPurge), so the engine and
//     the save agree; what only the file shows comes from the reader (`DocumentModel.purgePinned`).
//   - What AutoCAD never purges: layer 0 and Defpoints, ByLayer, ByBlock and Continuous, the
//     Standard styles, the ACAD application, the ByLayer, ByBlock and Global materials, the
//     Normal plot style and the default visual styles; an xref's records (they go with XREF
//     Detach). Layout blocks, anonymous blocks (`*U`, `*D` …) and xref blocks are not listed.
//   - "Purge nested items" takes, with what is purged, whatever only it used (a layer of the
//     objects of a purged block), until nothing more goes; without it one level goes per run.
//   - A layer frozen in a viewport or named by a layer state is still purgeable: it leaves the
//     viewport and the state, as the Layer Properties Manager's Delete Layer does.
//   - Unnamed objects: "Zero-length geometry" deletes lines, arcs, circles and polylines whose
//     length is zero, and "Empty text objects" text and mtext showing only spaces. "PURGE does
//     not remove unnamed objects from blocks or locked layers": model space and layouts only, and
//     an object on a locked layer stays. AutoCAD's help names lines, arcs, circles and polylines;
//     a spline or ellipse with no extent is left (ambiguity: the help says "and so on").
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  BlockTableRecord,
  Entity,
  Group,
  NonGraphicalObject,
  SortEntsTable,
  SymbolTableRecord,
  TableName,
} from '../model/types';
import { eraseObjects } from './edit';
import { displayText } from './find-text';
import { explodeGroup } from './groups';
import { dropLayersFromStates } from './layer-states';

/** The kinds of named items, in -PURGE's order. */
export type PurgeCategory =
  | 'blocks'
  | 'dimStyles'
  | 'groups'
  | 'layers'
  | 'linetypes'
  | 'materials'
  | 'mleaderStyles'
  | 'plotStyles'
  | 'textStyles'
  | 'mlineStyles'
  | 'tableStyles'
  | 'visualStyles'
  | 'appIds';

export const PURGE_CATEGORIES: readonly PurgeCategory[] = [
  'blocks',
  'dimStyles',
  'groups',
  'layers',
  'linetypes',
  'materials',
  'mleaderStyles',
  'plotStyles',
  'textStyles',
  'mlineStyles',
  'tableStyles',
  'visualStyles',
  'appIds',
];

interface CategoryRules {
  /** What AutoCAD's messages call one ("layer"), and several ("layers"). */
  readonly one: string;
  readonly many: string;
  /** The table holding the records; groups are objects. */
  readonly table?: TableName;
  /** Names AutoCAD never purges (purge.ts in @triya/io keeps the same list). */
  readonly fixed: readonly string[];
  /** Header variables that name the current one, or one in use. */
  readonly header: readonly string[];
}

export const PURGE_RULES: Readonly<Record<PurgeCategory, CategoryRules>> = {
  blocks: {
    one: 'block',
    many: 'blocks',
    table: 'blockRecords',
    fixed: [],
    header: ['$DIMBLK', '$DIMBLK1', '$DIMBLK2', '$DIMLDRBLK'],
  },
  dimStyles: {
    one: 'dimension style',
    many: 'dimension styles',
    table: 'dimStyles',
    fixed: ['Standard'],
    header: ['$DIMSTYLE'],
  },
  groups: { one: 'group', many: 'groups', fixed: [], header: [] },
  layers: {
    one: 'layer',
    many: 'layers',
    table: 'layers',
    fixed: ['0', 'Defpoints'],
    header: ['$CLAYER'],
  },
  linetypes: {
    one: 'linetype',
    many: 'linetypes',
    table: 'linetypes',
    fixed: ['ByLayer', 'ByBlock', 'Continuous'],
    header: ['$CELTYPE', '$DIMLTYPE', '$DIMLTEX1', '$DIMLTEX2'],
  },
  materials: {
    one: 'material',
    many: 'materials',
    table: 'materials',
    fixed: ['ByLayer', 'ByBlock', 'Global'],
    header: ['$CMATERIAL'],
  },
  mleaderStyles: {
    one: 'multileader style',
    many: 'multileader styles',
    table: 'mleaderStyles',
    fixed: ['Standard'],
    header: ['CMLEADERSTYLE'],
  },
  plotStyles: {
    one: 'plot style',
    many: 'plot styles',
    table: 'plotStyles',
    fixed: ['Normal'],
    header: [],
  },
  textStyles: {
    one: 'text style',
    many: 'text styles',
    table: 'textStyles',
    fixed: ['Standard'],
    header: ['$TEXTSTYLE', '$DIMTXSTY'],
  },
  mlineStyles: {
    one: 'mline style',
    many: 'mline styles',
    table: 'mlineStyles',
    fixed: ['Standard'],
    header: ['$CMLSTYLE'],
  },
  tableStyles: {
    one: 'table style',
    many: 'table styles',
    table: 'tableStyles',
    fixed: ['Standard'],
    header: ['CTABLESTYLE'],
  },
  visualStyles: {
    one: 'visual style',
    many: 'visual styles',
    table: 'visualStyles',
    fixed: [
      '2dWireframe',
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
  appIds: {
    one: 'registered application',
    many: 'registered applications',
    table: 'appIds',
    fixed: ['ACAD'],
    header: [],
  },
};

/** A named item: a record of its category's table, or a group. */
export interface PurgeItem {
  readonly category: PurgeCategory;
  readonly handle: Handle;
  readonly name: string;
}

/** An item that cannot be purged now, with AutoCAD's "Possible Reasons". */
export interface InUseItem extends PurgeItem {
  readonly reasons: readonly string[];
}

export interface PurgeState {
  /** What can be purged now, by category, then name. */
  readonly purgeable: readonly PurgeItem[];
  /** What cannot ("Find Non-Purgeable Items"), with why. */
  readonly inUse: readonly InUseItem[];
}

/**
 * Keys of the model whose values are handles (the same set as HANDLE_KEYS in @triya/io's
 * purge.ts): a handle under any other key is not a reference.
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

/** Xdata group codes holding a handle: 1003 a layer, 1005 any object. */
const XDATA_HANDLES = new Set([1003, 1005]);

/** Fields that are the object's own identity or links that do not make it use a record. */
const SKIPPED = new Set(['handle', 'raw', 'reactors', 'extDict', 'id', 'owner']);

/** DXF 70 bits: a record an xref brings (16, 32); an xref's own block (4, 8). */
const XREF_DEPENDENT = 16 | 32;
const XREF_BLOCK = 4 | 8;
const LAYOUT_BLOCK = /^\*(model|paper)_space/i;

const upper = (s: string) => s.toUpperCase();

/**
 * Who uses what: per handle, the referrers ("units") that refer to it. A unit is what goes as
 * one when purged: `b:<handle>` a block (its definition, record and entities), `r:<handle>` a
 * record, `o:<handle>` an object; `space` model space and the layouts, which never go;
 * `header:<name>` a header variable; `pinned` what only the file shows.
 */
type Uses = Map<Handle, Map<string, Set<string>>>;

function collectUses(model: DocumentModel): Uses {
  const uses: Uses = new Map();
  // Each use counted once per object (`by`), however many fields name the target.
  let by = '';
  const add = (target: Handle, unit: string) => {
    let m = uses.get(target);
    if (!m) uses.set(target, (m = new Map()));
    let objects = m.get(unit);
    if (!objects) m.set(unit, (objects = new Set()));
    objects.add(by);
  };

  const walk = (v: unknown, key: string, unit: string, depth: number): void => {
    if (depth > 24 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      // A layer frozen in a viewport is not in use: it leaves the viewport when purged.
      if (HANDLE_KEYS.has(key) && key !== 'frozenLayers') add(v, unit);
      return;
    }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key, unit, depth + 1);
      return;
    }
    if (ArrayBuffer.isView(v)) return;
    const o = v as Record<string, unknown>;
    if (typeof o.code === 'number' && 'value' in o && Object.keys(o).length === 2) {
      // A 1003 layer keeps acad-ts's number (mapXdata), a 1005 hex text.
      const h =
        typeof o.value === 'string'
          ? o.value
          : typeof o.value === 'number' || typeof o.value === 'bigint'
            ? o.value.toString(16).toUpperCase()
            : undefined;
      if (XDATA_HANDLES.has(o.code) && h !== undefined) add(h, unit);
      return;
    }
    for (const [k, x] of Object.entries(o)) {
      if (depth === 0 && SKIPPED.has(k)) continue;
      walk(x, k, unit, depth + 1);
    }
  };
  const spaces = new Set<Handle>();
  for (const r of model.tables.blockRecords.values())
    if (isLayoutBlock(r) || r.handle === modelSpaceOf(model)) spaces.add(r.handle);
  for (const e of model.entities()) {
    by = e.handle;
    walk(e, '', spaces.has(e.owner) ? 'space' : `b:${e.owner}`, 0);
  }
  for (const [table, records] of Object.entries(model.tables)) {
    const prefix = table === 'blockRecords' ? 'b' : 'r';
    for (const r of (records as ReadonlyMap<Handle, SymbolTableRecord>).values()) {
      by = r.handle;
      walk(r, '', `${prefix}:${r.handle}`, 0);
    }
  }
  for (const d of model.blocks.values()) {
    by = d.handle;
    walk(d, '', `b:${d.handle}`, 0);
  }
  for (const l of model.layouts) {
    by = l.handle;
    walk(l, '', 'space', 0);
  }
  for (const o of model.objects.values()) {
    // A draw order table goes with its block.
    const unit = o.type === 'SORTENTSTABLE' ? `b:${(o as SortEntsTable).block}` : `o:${o.handle}`;
    by = o.handle;
    walk(o, '', unit, 0);
  }
  by = 'file';
  for (const h of model.purgePinned) add(h, 'pinned');
  for (const h of model.passthroughLayers) add(h, 'pinned');
  for (const h of model.passthroughLinetypes) add(h, 'pinned');
  return uses;
}

function modelSpaceOf(model: DocumentModel): Handle | undefined {
  return model.layouts.find((l) => l.tabOrder === 0)?.blockRecord;
}

function isLayoutBlock(r: BlockTableRecord): boolean {
  return r.layout !== undefined || LAYOUT_BLOCK.test(r.name);
}

/** Whether PURGE lists the block at all: not a layout's, an anonymous one or an xref. */
function listedBlock(model: DocumentModel, r: BlockTableRecord): boolean {
  if (isLayoutBlock(r) || r.name.startsWith('*')) return false;
  if (((r.flags ?? 0) & XREF_BLOCK) !== 0) return false;
  return model.blocks.get(r.handle)?.xrefPath === undefined;
}

const isGroup = (o: NonGraphicalObject): o is Group => o.type === 'GROUP';

/** Every item of the category PURGE lists, by name. */
function itemsOf(model: DocumentModel, category: PurgeCategory): PurgeItem[] {
  const rules = PURGE_RULES[category];
  const out: PurgeItem[] = [];
  if (category === 'groups') {
    for (const o of model.objects.values())
      if (isGroup(o)) out.push({ category, handle: o.handle, name: o.name });
  } else {
    for (const r of model.tables[rules.table!].values()) {
      if (category === 'blocks' && !listedBlock(model, r as BlockTableRecord)) continue;
      out.push({ category, handle: r.handle, name: r.name });
    }
  }
  return out.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/** Why an item can never be purged, whoever uses it. */
function fixedReason(model: DocumentModel, item: PurgeItem): string | undefined {
  const rules = PURGE_RULES[item.category];
  if (rules.fixed.some((n) => upper(n) === upper(item.name)))
    return `${item.name} is a default ${rules.one} and cannot be purged.`;
  if (item.name === '') return 'A nameless record (a shape file) cannot be purged.';
  if (rules.table) {
    const r = model.tables[rules.table].get(item.handle) as SymbolTableRecord | undefined;
    if (((r?.flags ?? 0) & XREF_DEPENDENT) !== 0)
      return `It is xref-dependent: it goes when its xref is detached.`;
  }
  return undefined;
}

/** The header variables naming the item, by name or handle. */
function headerUses(model: DocumentModel, item: PurgeItem): string[] {
  const out: string[] = [];
  for (const name of PURGE_RULES[item.category].header) {
    const v = model.header.get(name);
    if (typeof v === 'string' && (upper(v) === upper(item.name) || v === item.handle))
      out.push(name);
  }
  return out;
}

/** The units that use the item, besides itself (a layer leaving a layer state is not a use). */
function usersOf(model: DocumentModel, uses: Uses, item: PurgeItem): Map<string, number> {
  const own =
    item.category === 'blocks'
      ? `b:${item.handle}`
      : `${item.category === 'groups' ? 'o' : 'r'}:${item.handle}`;
  const out = new Map<string, number>();
  for (const [unit, objects] of uses.get(item.handle) ?? []) {
    const n = objects.size;
    if (unit === own) continue;
    if (item.category === 'layers' && unit.startsWith('o:')) {
      const o = model.objects.get(unit.slice(2));
      if (o?.type === 'LAYER_STATE') continue;
    }
    out.set(unit, n);
  }
  for (const name of headerUses(model, item)) out.set(`header:${name}`, 1);
  if (item.category === 'groups') {
    const g = model.objects.get(item.handle) as Group | undefined;
    if (g && g.entities.length > 0) out.set('members', g.entities.length);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Possible Reasons" for each user. */
function reasons(model: DocumentModel, item: PurgeItem, users: Map<string, number>): string[] {
  const out: string[] = [];
  const rules = PURGE_RULES[item.category];
  for (const [unit, n] of users) {
    if (unit === 'space')
      out.push(`${plural(n, 'object')} in the drawing ${n === 1 ? 'uses' : 'use'} it.`);
    else if (unit === 'pinned')
      out.push('Objects Triya keeps without editing them use it, or the file needs it.');
    else if (unit === 'members') out.push(`It holds ${plural(n, 'object')}.`);
    else if (unit.startsWith('header:')) {
      const name = unit.slice(7);
      const current: Record<string, string> = {
        $CLAYER: 'layer',
        $CELTYPE: 'linetype',
        $TEXTSTYLE: 'text style',
        $DIMSTYLE: 'dimension style',
        CMLEADERSTYLE: 'multileader style',
        CTABLESTYLE: 'table style',
        $CMLSTYLE: 'mline style',
        $CMATERIAL: 'material',
      };
      out.push(
        current[name]
          ? `It is the current ${current[name]}.`
          : `The ${name.replace(/^\$/, '')} setting names it.`,
      );
    } else if (unit.startsWith('b:')) {
      const b = model.tables.blockRecords.get(unit.slice(2));
      out.push(`It is used in block "${b?.name ?? unit.slice(2)}".`);
    } else if (unit.startsWith('r:')) {
      const h = unit.slice(2);
      const found = recordNamed(model, h);
      out.push(found ? `The ${found.what} "${found.name}" uses it.` : `Record ${h} uses it.`);
    } else if (unit.startsWith('o:')) {
      const o = model.objects.get(unit.slice(2));
      const name = (o as { name?: string } | undefined)?.name;
      out.push(
        o?.type === 'GROUP'
          ? `The group "${name}" uses it.`
          : `A ${(o?.type ?? 'object').toLowerCase().replace(/_/g, ' ')}${name ? ` "${name}"` : ''} uses it.`,
      );
    }
  }
  if (out.length === 0) out.push(`The ${rules.one} is in use.`);
  return out;
}

function recordNamed(model: DocumentModel, h: Handle): { what: string; name: string } | undefined {
  for (const c of PURGE_CATEGORIES) {
    const t = PURGE_RULES[c].table;
    const r = t && (model.tables[t].get(h) as SymbolTableRecord | undefined);
    if (r) return { what: PURGE_RULES[c].one, name: r.name };
  }
  for (const t of ['views', 'ucs', 'vports'] as const) {
    const r = model.tables[t].get(h);
    if (r) return { what: t === 'ucs' ? 'UCS' : t.slice(0, -1), name: r.name };
  }
  return undefined;
}

/** What PURGE can take now, and what it cannot with why (the dialog's two views). */
export function purgeState(model: DocumentModel): PurgeState {
  const uses = collectUses(model);
  const purgeable: PurgeItem[] = [];
  const inUse: InUseItem[] = [];
  for (const category of PURGE_CATEGORIES) {
    for (const item of itemsOf(model, category)) {
      const fixed = fixedReason(model, item);
      if (fixed) {
        inUse.push({ ...item, reasons: [fixed] });
        continue;
      }
      const users = usersOf(model, uses, item);
      if (users.size === 0) purgeable.push(item);
      else inUse.push({ ...item, reasons: reasons(model, item, users) });
    }
  }
  return { purgeable, inUse };
}

const unitOf = (item: PurgeItem) =>
  item.category === 'blocks'
    ? `b:${item.handle}`
    : item.category === 'groups'
      ? `o:${item.handle}`
      : `r:${item.handle}`;

/**
 * The items to purge: `chosen` (those of them purgeable now), and with `nested` whatever only
 * they and the others going use, until nothing more can go. In the order they go: blocks first,
 * so what is left purges the objects they held.
 */
export function purgeClosure(
  model: DocumentModel,
  chosen: readonly Handle[],
  nested: boolean,
): PurgeItem[] {
  const uses = collectUses(model);
  const all = PURGE_CATEGORIES.flatMap((c) => itemsOf(model, c)).filter(
    (i) => !fixedReason(model, i),
  );
  const users = new Map(all.map((i) => [i.handle, usersOf(model, uses, i)]));
  const wanted = new Set(chosen);
  const going = new Map<Handle, PurgeItem>();
  for (const i of all)
    if (wanted.has(i.handle) && users.get(i.handle)!.size === 0) going.set(i.handle, i);
  if (nested && going.size > 0) {
    const units = new Set([...going.values()].map(unitOf));
    for (let grew = true; grew;) {
      grew = false;
      for (const i of all) {
        if (going.has(i.handle)) continue;
        if ([...users.get(i.handle)!.keys()].every((u) => units.has(u))) {
          going.set(i.handle, i);
          units.add(unitOf(i));
          grew = true;
        }
      }
    }
  }
  const order = new Map(PURGE_CATEGORIES.map((c, n) => [c, n]));
  return [...going.values()].sort((a, b) => order.get(a.category)! - order.get(b.category)!);
}

/** Purges `items` (from {@link purgeClosure}) into `b`. */
export function purgeInto(
  b: ChangeSetBuilder,
  model: DocumentModel,
  items: readonly PurgeItem[],
): void {
  const layers = new Set<Handle>();
  for (const item of items) {
    if (item.category === 'blocks') {
      eraseObjects(b, model, b.blockEntities(item.handle));
      for (const o of model.objects.values())
        if (o.type === 'SORTENTSTABLE' && (o as SortEntsTable).block === item.handle)
          b.removeObject(o.handle);
      b.removeBlock(item.handle);
    } else if (item.category === 'groups') {
      const g = model.objects.get(item.handle);
      if (g && isGroup(g)) explodeGroup(b, model, g);
    } else if (item.category === 'layers') layers.add(item.handle);
    else b.removeTableRecord(PURGE_RULES[item.category].table!, item.handle);
  }
  if (layers.size === 0) return;
  // A purged layer leaves the viewports that freeze it and the layer states that name it.
  for (const e of model.entities()) {
    const g = b.entity(e.id)?.geom;
    if (g?.kind === 'VIEWPORT' && g.frozenLayers.some((h) => layers.has(h)))
      b.updateEntity(e.id, {
        geom: { ...g, frozenLayers: g.frozenLayers.filter((h) => !layers.has(h)) },
      });
  }
  for (const h of layers) b.removeTableRecord('layers', h);
  dropLayersFromStates(b, layers);
}

// ── Unnamed objects ───────────────────────────────────────────────────────────────────────

/** Model space and the layouts' objects not on a locked layer, which PURGE may delete. */
function looseObjects(model: DocumentModel): Entity[] {
  const spaces = new Set(model.layouts.map((l) => l.blockRecord));
  return [...model.entities()].filter(
    (e) => spaces.has(e.owner) && model.tables.layers.get(e.layer)?.locked !== true,
  );
}

const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y;

/** Whether the object is a line, arc, circle or polyline of no length (exactly). */
export function isZeroLength(e: Entity): boolean {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE':
      return same(g.start, g.end);
    case 'ARC':
    case 'CIRCLE':
      return g.radius === 0;
    case 'LWPOLYLINE':
      return g.vertices.every((v) => same(v, g.vertices[0]!));
    case 'POLYLINE':
      return g.vertices.every(
        (v) => same(v, g.vertices[0]!) && (v.z ?? 0) === (g.vertices[0]!.z ?? 0),
      );
    default:
      return false;
  }
}

/** Whether the object is TEXT or MTEXT that shows only spaces. */
export function isEmptyText(e: Entity): boolean {
  const g = e.geom;
  if (g.kind === 'TEXT')
    return g.field === undefined && displayText(g.value, 'text').text.trim() === '';
  if (g.kind === 'MTEXT')
    return g.field === undefined && displayText(g.contents, 'mtext').text.trim() === '';
  return false;
}

/** The zero-length geometry PURGE deletes. */
export function zeroLengthObjects(model: DocumentModel): EntityId[] {
  return looseObjects(model)
    .filter(isZeroLength)
    .map((e) => e.id);
}

/** The empty text objects PURGE deletes. */
export function emptyTextObjects(model: DocumentModel): EntityId[] {
  return looseObjects(model)
    .filter(isEmptyText)
    .map((e) => e.id);
}

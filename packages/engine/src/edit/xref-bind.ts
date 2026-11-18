// XREF Bind (M5-04 part 2): a loaded xref made a block of the drawing, its content the drawing's.
//
// AutoCAD 2024 help, "XREF (Command)" and "Bind Xrefs/DGN Underlays Dialog Box": Bind "converts
// the selected DWG reference to a block"; "Bind: binds the selected DWG references to the
// current drawing. Xref-dependent named objects are changed from blockname|definitionname to
// blockname$n$definitionname syntax", n the lowest number that makes the name one the drawing
// does not have, "In this manner, unique named objects are created for all xref-dependent
// definitions bound into the current drawing"; "Insert: binds the DWG references to the current
// drawing in a way similar to detaching and inserting the reference drawing. Rather than being
// renamed using blockname$n$definitionname syntax, xref-dependent named objects are stripped of
// the xref name. As with inserting drawings, no name-incrementing occurs. If the name already
// exists in the host drawing, the named object assumes the properties of the definition in the
// local drawing" (BINDTYPE says which -XREF Bind does). "About Binding Xrefs": "Only the xrefs
// attached or overlaid directly to the current drawing can be bound" (nested ones come with
// them), and an xref must be loaded to be bound.
//
// In Triya the content a load brought (model/xref.ts, `xrefLoaded`) is already in the model with
// the drawing's handles; binding keeps it: the records are renamed and lose the xref-dependent
// bits (70 16, 32), the xref's block and the xrefs nested in it lose the xref bits (4, 8) and
// their path, and nothing is left out of the save any more. The host's own `xref|name` records
// (VISRETAIN) are renamed with them. A nested xref that another loaded xref also draws (the
// grandchild both the attachment and the overlay name) is bound too: its content is the drawing's
// now, and the other xref draws the block it became, as AutoCAD's would after a reload. The
// objects a load gives no dictionary (model/xref.ts: its file kept them) are filed as the save
// files new ones: an image's or PDF's definition in the drawing's ACAD_IMAGE_DICT or
// ACAD_PDFDEFINITIONS (sharing the drawing's definition of the same name and file), an XCLIP in
// a new ACAD_FILTER of its reference's new extension dictionary, a draw order table in its
// block's. One undo step (XREF); the save writes it (io export/blocks.ts, records.ts).
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import { compareHandles, type Handle } from '../model/handle';
import type {
  ImageDefinition,
  LayerState,
  NonGraphicalObject,
  PdfDefinition,
  SortEntsTable,
  SpatialFilter,
  SymbolTableRecord,
  TableName,
  TextStyleRecord,
} from '../model/types';
import {
  HANDLE_KEYS,
  XREF_FLAG,
  XREF_OVERLAY_FLAG,
  isXrefRecord,
  loadedXrefHandles,
  xrefBringing,
} from '../model/xref';

/** DXF 70: an xref-dependent record (16) and a resolved one (32). */
const DEPENDENT_BITS = 16 | 32;
const XREF_BITS = XREF_FLAG | XREF_OVERLAY_FLAG;

/** The tables that hold `xref|name` records (model/xref.ts brings them in). */
const DEPENDENT_TABLES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'mleaderStyles',
  'tableStyles',
  'mlineStyles',
  'blockRecords',
];

const DEFINITION_DICTIONARY = {
  IMAGEDEF: 'imageDictionary',
  PDFDEFINITION: 'pdfDictionary',
} as const;

/** Why xref `block` cannot be bound, or undefined. */
export function xrefBindProblem(model: DocumentModel, block: Handle): string | undefined {
  const record = model.tables.blockRecords.get(block);
  const def = model.blocks.get(block);
  if (!record || !def) return `No block ${block}.`;
  if (!isXrefRecord(record)) return `${record.name} is not an external reference.`;
  const parent = xrefBringing(model, block);
  if (parent) return `${record.name} is nested in ${parent.name} and cannot be bound.`;
  if (!def.xrefLoaded) return `${record.name} is not loaded: reload it to bind it.`;
  for (const h of boundContent(model, [block]).xrefs) {
    if (h === block) continue;
    if (!model.blocks.get(h)?.xrefLoaded)
      return `${record.name} cannot be bound: its nested xref ${model.tables.blockRecords.get(h)!.name} is not loaded.`;
  }
  return undefined;
}

/**
 * The ChangeSet that binds the xrefs `blocks` (XREF Bind), as Insert when `insert` (BINDTYPE 1).
 * Throws when `xrefBindProblem` names a reason for any of them.
 */
export function xrefBindChange(
  model: DocumentModel,
  blocks: readonly Handle[],
  insert = false,
): ChangeSet {
  for (const h of blocks) {
    const problem = xrefBindProblem(model, h);
    if (problem) throw new Error(problem);
  }
  const b = new ChangeSetBuilder(model);
  bindXrefs(b, model, blocks, insert);
  return b.build();
}

/** Every value of the model with a handle: entity, record, block definition or object. */
function valueOf(model: DocumentModel, h: Handle): unknown {
  const e = model.entityByHandle(h);
  if (e) return e;
  for (const t of DEPENDENT_TABLES) {
    const r = model.tables[t].get(h);
    if (r) return { ...r, ...(t === 'blockRecords' ? { def: model.blocks.get(h) } : {}) };
  }
  return model.objects.get(h);
}

/** Calls `found` with each handle `value` names under a handle key, other than its own. */
function named(value: unknown, found: (h: Handle) => void): void {
  const walk = (v: unknown, key: string | undefined): void => {
    if (typeof v === 'string') {
      if (key !== undefined && HANDLE_KEYS.has(key)) found(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
    } else if (typeof v === 'object' && v !== null && !ArrayBuffer.isView(v)) {
      for (const [k, item] of Object.entries(v)) {
        if (k === 'handle' || k === 'owner' || k === 'raw' || k === 'xdata') continue;
        walk(item, k);
      }
    }
  };
  walk(value, undefined);
}

/**
 * What binding `blocks` makes the drawing's: the handles their loads brought, those of the xrefs
 * nested in them, and what of other loads that content names (a nested xref an earlier load
 * brought), with all that holds; and the xref blocks that become plain blocks.
 */
function boundContent(
  model: DocumentModel,
  blocks: readonly Handle[],
): { handles: Set<Handle>; xrefs: Set<Handle> } {
  const loaded = loadedXrefHandles(model);
  const handles = new Set<Handle>();
  const xrefs = new Set<Handle>(blocks);
  const queue: Handle[] = [];
  const take = (h: Handle): void => {
    if (handles.has(h)) return;
    handles.add(h);
    queue.push(h);
    const def = model.blocks.get(h);
    if (!def) return;
    if (isXrefRecord(model.tables.blockRecords.get(h))) xrefs.add(h);
    for (const x of def.xrefLoaded ?? []) take(x);
    for (const id of model.blockEntities(h)) take(model.entity(id)!.handle);
  };
  for (const block of blocks) for (const h of model.blocks.get(block)?.xrefLoaded ?? []) take(h);
  while (queue.length > 0) {
    named(valueOf(model, queue.pop()!), (h) => {
      if (loaded.has(h)) take(h);
    });
  }
  return { handles, xrefs };
}

/** `xrefBindChange` into a change being built (-XREF Bind's undo step). */
export function bindXrefs(
  b: ChangeSetBuilder,
  model: DocumentModel,
  blocks: readonly Handle[],
  insert = false,
): void {
  const { handles, xrefs } = boundContent(model, blocks);

  // Other loads let go of what is the drawing's now.
  for (const d of model.blocks.values()) {
    if (xrefs.has(d.handle) || !d.xrefLoaded?.some((h) => handles.has(h))) continue;
    b.updateBlock(d.handle, { xrefLoaded: d.xrefLoaded.filter((h) => !handles.has(h)) });
  }
  for (const h of xrefs) {
    const record = model.tables.blockRecords.get(h)!;
    const def = model.blocks.get(h)!;
    b.updateTableRecord('blockRecords', h, { flags: (record.flags ?? 0) & ~XREF_BITS });
    b.updateBlock(h, {
      xrefPath: undefined,
      xrefLoaded: undefined,
      xrefHandles: undefined,
      ...(def.flags !== undefined ? { flags: def.flags & ~(XREF_BITS | DEPENDENT_BITS) } : {}),
    });
  }

  // ── The records: renamed (Bind), or given their own names (Insert) ─────────────────────────
  const prefixes = new Set(
    [...xrefs].map((h) => `${model.tables.blockRecords.get(h)!.name.toUpperCase()}|`),
  );
  /** Insert: a record of the xref's that is the drawing's record of the same name. */
  const merged = new Map<Handle, Handle>();
  const renamed = new Map<Handle, string>();
  for (const table of DEPENDENT_TABLES) {
    const records = [...model.tables[table].values()] as SymbolTableRecord[];
    const binding = records.filter((r) => {
      if (handles.has(r.handle)) return true;
      // The drawing's own records of the xrefs' symbols (VISRETAIN).
      const name = r.name.toUpperCase();
      return (
        ((r.flags ?? 0) & DEPENDENT_BITS) !== 0 && [...prefixes].some((p) => name.startsWith(p))
      );
    });
    const going = new Set(binding.map((r) => r.handle));
    const names = new Map<string, Handle>();
    for (const r of records) if (!going.has(r.handle)) names.set(r.name.toUpperCase(), r.handle);
    for (const r of binding) {
      // As the change has it so far: a bound xref's record has lost its xref bits above.
      const was = b.tableRecord(table, r.handle) as SymbolTableRecord;
      const flags = (was.flags ?? 0) & ~DEPENDENT_BITS;
      const bar = r.name.indexOf('|');
      let name = r.name;
      if (bar >= 0) {
        const xref = r.name.slice(0, bar);
        const symbol = r.name.slice(bar + 1);
        if (insert) {
          const own = names.get(symbol.toUpperCase());
          if (own !== undefined) {
            merged.set(r.handle, own);
            continue;
          }
          name = symbol;
        } else {
          let n = 0;
          while (names.has(`${xref}$${n}$${symbol}`.toUpperCase())) n++;
          name = `${xref}$${n}$${symbol}`;
        }
      }
      names.set(name.toUpperCase(), r.handle);
      if (name !== r.name) renamed.set(r.handle, name);
      // No flags left is none, as a load and the importer leave a record without.
      const patch = flags !== (was.flags ?? 0) ? { flags: flags || undefined } : {};
      if (table === 'blockRecords') {
        if (name !== r.name) b.updateBlock(r.handle, { name });
        if ('flags' in patch) b.updateTableRecord(table, r.handle, patch);
      } else {
        // A style the xref's file left without a font (its Standard) is drawn in txt, AutoCAD's
        // default font; the drawing's own style names it, as AutoCAD's Standard does.
        const font =
          table === 'textStyles' && (was as TextStyleRecord).font.trim() === ''
            ? { font: 'txt' }
            : {};
        if (name !== r.name || 'flags' in patch || 'font' in font)
          b.updateTableRecord(table, r.handle, {
            ...patch,
            ...font,
            ...(name !== r.name ? { name } : {}),
          });
      }
    }
  }
  if (merged.size > 0) mergeRecords(b, model, merged);

  // ── The objects a load leaves without a dictionary ─────────────────────────────────────────
  // In handle order: of two bound definitions of one name, the first keeps it.
  const loaded = loadedXrefHandles(model);
  for (const h of [...handles].sort(compareHandles)) {
    const o = b.object(h);
    if (!o) continue;
    if (o.type === 'IMAGEDEF' || o.type === 'PDFDEFINITION')
      fileDefinition(b, model, o as ImageDefinition | PdfDefinition, handles, loaded);
    else if (o.type === 'SPATIAL_FILTER') fileClip(b, model, o as SpatialFilter);
    else if (o.type === 'SORTENTSTABLE') fileDrawOrder(b, o as SortEntsTable);
  }
  // An unclipped image the xref's file states no boundary of has AutoCAD's: the whole image, in
  // pixel coordinates centred on pixels (edit/picture.ts), which the save writes (DXF 91 = 2).
  for (const h of handles) {
    const e = model.entityByHandle(h);
    const cur = e && b.entity(e.id);
    if (cur?.geom.kind !== 'IMAGE' || cur.geom.clipping || cur.geom.clip.type !== 'rectangle')
      continue;
    if (cur.geom.clip.vertices.length === 2) continue;
    const { size } = cur.geom;
    const vertices = [
      { x: -0.5, y: -0.5 },
      { x: size.x - 0.5, y: size.y - 0.5 },
    ];
    b.updateEntity(e!.id, { geom: { ...cur.geom, clip: { ...cur.geom.clip, vertices } } });
  }

  // The layer states name the layers by their new names; an Insert-merged layer's entry gives
  // way to the drawing's layer's.
  const touched = new Set([...renamed.keys(), ...merged.values()]);
  for (const o of [...b.objects()]) {
    if (o.type !== 'LAYER_STATE') continue;
    const s = o as LayerState;
    if (!s.layers.some((e) => e.layer !== undefined && touched.has(e.layer))) continue;
    const seen = new Set<Handle>();
    const layers: LayerState['layers'][number][] = [];
    for (const e of s.layers) {
      if (e.layer === undefined || !touched.has(e.layer)) {
        layers.push(e);
        continue;
      }
      if (seen.has(e.layer)) continue;
      seen.add(e.layer);
      const name = b.tableRecord('layers', e.layer)?.name ?? e.name;
      layers.push(name === e.name ? e : { ...e, name });
    }
    b.updateObject(o.handle, { layers } as Partial<LayerState>);
  }
}

/**
 * Insert: the records of `merged` give way to the drawing's of their names: what names one
 * names the drawing's, and they go (a block with what it holds).
 */
function mergeRecords(
  b: ChangeSetBuilder,
  model: DocumentModel,
  merged: ReadonlyMap<Handle, Handle>,
): void {
  const remap = (v: unknown, key: string | undefined): unknown => {
    if (typeof v === 'string')
      return key !== undefined && HANDLE_KEYS.has(key) ? (merged.get(v) ?? v) : v;
    if (Array.isArray(v)) return v.map((item) => remap(item, key));
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v))
      out[k] = k === 'handle' || k === 'raw' || k === 'xdata' ? item : remap(item, k);
    return out;
  };
  /** The top-level fields of `value` that name a merged record, remapped. */
  const patch = <T extends object>(value: T): Partial<T> | undefined => {
    let out: Partial<T> | undefined;
    named(value, (h) => {
      if (merged.has(h)) out = {};
    });
    if (!out) return undefined;
    for (const [k, item] of Object.entries(value)) {
      if (k === 'handle' || k === 'owner' || k === 'raw' || k === 'xdata' || k === 'id') continue;
      const next = remap(item, k);
      if (JSON.stringify(next) !== JSON.stringify(item)) (out as Record<string, unknown>)[k] = next;
    }
    return out;
  };
  const going = new Set(merged.keys());
  for (const e of model.entities()) {
    const cur = b.entity(e.id);
    if (!cur || going.has(cur.owner)) continue;
    const p = patch(cur);
    if (p) b.updateEntity(e.id, p);
  }
  for (const table of Object.keys(model.tables) as TableName[]) {
    for (const r of model.tables[table].values()) {
      if (going.has(r.handle)) continue;
      const cur = b.tableRecord(table, r.handle);
      const p = cur && patch(cur);
      if (p) b.updateTableRecord(table, r.handle, p as never);
    }
  }
  for (const d of model.blocks.values()) {
    if (going.has(d.handle)) continue;
    const cur = b.block(d.handle);
    const p = cur && patch(cur);
    if (p) b.updateBlock(d.handle, p);
  }
  for (const o of [...b.objects()]) {
    const p = patch(o);
    if (p) b.updateObject(o.handle, p as Partial<NonGraphicalObject>);
  }
  for (const l of model.layouts) {
    const cur = b.layout(l.handle);
    const p = cur && patch(cur);
    if (p) b.updateLayout(l.handle, p);
  }
  for (const h of going) {
    if (model.blocks.has(h)) {
      for (const id of b.blockEntities(h)) b.removeEntity(id);
      b.removeBlock(h);
      continue;
    }
    for (const t of DEPENDENT_TABLES)
      if (model.tables[t].has(h) && b.tableRecord(t, h)) b.removeTableRecord(t, h);
  }
}

/**
 * An image's or PDF's definition filed in the drawing's dictionary for its type, as PASTECLIP
 * files one (clipboard.ts `pasteDefinition`): the drawing's definition of the same name and file
 * takes its place, another name is the bound one (`xref$n$name`) when the name is taken.
 */
function fileDefinition(
  b: ChangeSetBuilder,
  model: DocumentModel,
  o: ImageDefinition | PdfDefinition,
  bound: ReadonlySet<Handle>,
  loaded: ReadonlySet<Handle>,
): void {
  let owner: Handle | undefined = model.meta[DEFINITION_DICTIONARY[o.type]];
  const names = new Set<string>();
  for (const d of b.objects()) {
    if (d.type !== o.type || d.handle === o.handle) continue;
    // Another xref's (it is not saved), or one bound after this one (it gives way to this one).
    if (loaded.has(d.handle) && (!bound.has(d.handle) || compareHandles(d.handle, o.handle) > 0))
      continue;
    const def = d as ImageDefinition | PdfDefinition;
    // The drawing's own, or one bound before this one, filed already.
    owner ??= d.owner;
    if (def.name.toUpperCase() === o.name.toUpperCase() && def.fileName === o.fileName) {
      // The images showing this one show the drawing's.
      for (const e of model.entities()) {
        const cur = b.entity(e.id);
        if (cur && 'definition' in cur.geom && cur.geom.definition === o.handle)
          b.updateEntity(e.id, { geom: { ...cur.geom, definition: d.handle } as never });
      }
      b.removeObject(o.handle);
      return;
    }
    names.add(def.name.toUpperCase());
  }
  owner ??= b.allocateHandle();
  let name = o.name;
  if (names.has(name.toUpperCase())) {
    const xref = model.tables.blockRecords.get(o.owner)?.name ?? 'xref';
    let n = 0;
    while (names.has(`${xref}$${n}$${o.name}`.toUpperCase())) n++;
    name = `${xref}$${n}$${o.name}`;
  }
  b.updateObject(o.handle, {
    owner,
    name,
    reactors: undefined,
  } as unknown as Partial<NonGraphicalObject>);
}

/** An XCLIP in a new ACAD_FILTER of its reference's new extension dictionary (export xclips.ts). */
function fileClip(b: ChangeSetBuilder, model: DocumentModel, o: SpatialFilter): void {
  const ref = model.entityByHandle(o.insert);
  if (!ref || !b.entity(ref.id)) {
    b.removeObject(o.handle);
    return;
  }
  const extDict = b.entity(ref.id)!.extDict ?? b.allocateHandle();
  b.updateEntity(ref.id, { extDict });
  const owner = b.allocateHandle();
  b.updateObject(o.handle, { owner, reactors: [owner] } as Partial<NonGraphicalObject>);
}

/** A draw order table in its block's new extension dictionary (export draw-order.ts). */
function fileDrawOrder(b: ChangeSetBuilder, o: SortEntsTable): void {
  const record = b.tableRecord('blockRecords', o.block);
  if (!record) {
    b.removeObject(o.handle);
    return;
  }
  const owner = record.extDict ?? b.allocateHandle();
  if (record.extDict === undefined)
    b.updateTableRecord('blockRecords', o.block, { extDict: owner });
  b.updateObject(o.handle, { owner, reactors: [owner] } as Partial<NonGraphicalObject>);
}

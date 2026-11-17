// XREF Detach (M5-04): an xref taken out of the drawing with everything that names it.
//
// AutoCAD 2024 help, "XREF (Command)", -XREF Detach: "Detaches one or more drawing references
// from your drawing, erasing all instances of a specified xref and marking the xref definition
// for deletion from the definition table"; "To Detach an Xref": "Only the xrefs attached or
// overlaid directly to the current drawing can be detached; nested xrefs cannot be detached."
// "About Xref-Dependent Named Objects": the `xref|name` layers, linetypes and styles come and go
// with the xref, so the records the host keeps of them (VISRETAIN keeps the xref's layers' own
// settings in the host file) go with it too, unless something the drawing keeps still uses one
// (an entity of the host moved onto an xref layer), which then stays as it is.
//
// Detach changes the drawing, so it is one undo step (XREF), and the save writes it: the xref's
// BLOCK_RECORD, BLOCK and ENDBLK, its references with their XCLIPs and its dependent records leave
// the DXF (io export/purge.ts). Unload and Reload, which change only what the drawing shows, are
// `xrefUnloadChange` (model/xref.ts).
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { BlockTableRecord, SymbolTableRecord, TableName } from '../model/types';
import { HANDLE_KEYS, isXrefRecord, removeXrefContent, xrefBringing } from '../model/xref';
import { eraseObjects } from './edit';

/** DXF 70 bit 16: a record that belongs to an xref. */
const DEPENDENT_FLAG = 16;

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

/** Why xref `block` cannot be detached, or undefined. */
export function xrefDetachProblem(model: DocumentModel, block: Handle): string | undefined {
  const record = model.tables.blockRecords.get(block);
  if (!record || !model.blocks.has(block)) return `No block ${block}.`;
  if (!isXrefRecord(record)) return `${record.name} is not an external reference.`;
  const parent = xrefBringing(model, block);
  if (parent) return `${record.name} is nested in ${parent.name} and cannot be detached.`;
  return undefined;
}

/**
 * The ChangeSet that detaches the xrefs `blocks` (XREF Detach): their loaded content, every
 * reference to them in any space or block (with its XCLIP), their definitions and records, and
 * the host's `name|symbol` records nothing else uses. Throws when `xrefDetachProblem` names a
 * reason for any of them.
 */
export function xrefDetachChange(model: DocumentModel, blocks: readonly Handle[]): ChangeSet {
  for (const h of blocks) {
    const problem = xrefDetachProblem(model, h);
    if (problem) throw new Error(problem);
  }
  const b = new ChangeSetBuilder(model);
  detachXrefs(b, model, blocks);
  return b.build();
}

/** `xrefDetachChange` into a change being built (-XREF Detach's undo step). */
export function detachXrefs(
  b: ChangeSetBuilder,
  model: DocumentModel,
  blocks: readonly Handle[],
): void {
  const going = new Set(blocks);
  removeXrefContent(b, model, [...going]);

  // Every reference to the xrefs, wherever it is (a block of the drawing may hold one).
  const refs: EntityId[] = [];
  for (const e of model.entities()) {
    if (e.geom.kind === 'INSERT' && going.has(e.geom.block) && b.entity(e.id)) refs.push(e.id);
  }
  eraseObjects(b, model, refs);
  for (const h of going) b.removeBlock(h);

  // The host's records of the xrefs' dependent symbols (VISRETAIN).
  const prefixes = [...going].map(
    (h) => `${model.tables.blockRecords.get(h)!.name.toUpperCase()}|`,
  );
  const candidates = new Map<Handle, TableName>();
  for (const table of DEPENDENT_TABLES) {
    for (const r of model.tables[table].values() as IterableIterator<SymbolTableRecord>) {
      if (!b.tableRecord(table, r.handle) || ((r.flags ?? 0) & DEPENDENT_FLAG) === 0) continue;
      const name = r.name.toUpperCase();
      if (prefixes.some((p) => name.startsWith(p))) candidates.set(r.handle, table);
    }
  }
  if (candidates.size > 0) {
    const used = usedOf(b, model, candidates);
    for (const [h, table] of candidates) {
      if (used.has(h)) continue;
      if (table === 'blockRecords') {
        if (b.block(h) && b.blockEntities(h).length === 0) b.removeBlock(h);
        else used.add(h);
      } else b.removeTableRecord(table, h);
    }
    // A viewport's frozen layers let go of the layers that went (as LAYDEL's do).
    for (const e of model.entities()) {
      const cur = b.entity(e.id);
      if (cur?.geom.kind !== 'VIEWPORT') continue;
      const kept = cur.geom.frozenLayers.filter((h) => !candidates.has(h) || used.has(h));
      if (kept.length !== cur.geom.frozenLayers.length)
        b.updateEntity(e.id, { geom: { ...cur.geom, frozenLayers: kept } });
    }
  }
}

/**
 * Which of `candidates` something the change leaves in the drawing still names: an entity, a
 * record that is no candidate, a block definition, an object or a layout. A viewport's frozen
 * layers do not keep a layer (they let go of it), and the candidates do not keep each other.
 */
function usedOf(
  b: ChangeSetBuilder,
  model: DocumentModel,
  candidates: ReadonlyMap<Handle, TableName>,
): Set<Handle> {
  const used = new Set<Handle>();
  const walk = (v: unknown, key: string | undefined): void => {
    if (typeof v === 'string') {
      if (key !== undefined && HANDLE_KEYS.has(key) && candidates.has(v)) used.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
    } else if (typeof v === 'object' && v !== null && !ArrayBuffer.isView(v)) {
      for (const [k, item] of Object.entries(v)) {
        if (k === 'handle' || k === 'owner' || k === 'frozenLayers' || k === 'raw') continue;
        walk(item, k);
      }
    }
  };
  for (const e of model.entities()) {
    const cur = b.entity(e.id);
    if (cur) walk(cur, undefined);
  }
  for (const [table, records] of Object.entries(model.tables)) {
    for (const r of (records as ReadonlyMap<Handle, BlockTableRecord>).values()) {
      if (candidates.has(r.handle)) continue;
      const cur = b.tableRecord(table as TableName, r.handle);
      if (cur) walk(cur, undefined);
    }
  }
  for (const d of model.blocks.values()) {
    if (candidates.has(d.handle)) continue;
    const cur = b.block(d.handle);
    if (cur) walk(cur, undefined);
  }
  for (const o of b.objects()) walk(o, undefined);
  for (const l of model.layouts) walk(b.layout(l.handle), undefined);
  // A candidate that stays keeps what it names (a kept layer its linetype).
  for (let size = -1; size !== used.size;) {
    size = used.size;
    for (const h of [...used]) walk(b.tableRecord(candidates.get(h)!, h), undefined);
  }
  return used;
}

// TriyaToAcad for block definitions (M1-75 part 22): a block is a BLOCK_RECORD (its name, units,
// Allow exploding and Scale uniformly settings) with a BLOCK and an ENDBLK entity, the BLOCK
// holding the definition's base point and flags (anonymous, has attributes). The save writes a
// new block (BLOCK, and the anonymous blocks the dimension and table commands make), a moved base
// point (BASE in the block editor), a renamed block (RENAME) and edited block settings, the
// inverse of `blockRecord()` in map/tables.ts and `mapBlock` in map/blocks.ts. The BLOCK and
// ENDBLK of a new block are numbered above every handle the engine handed out, as a polyline's
// vertices are (the engine does not know them). The record checks every table shares are in
// records.ts; what a save cannot keep yet is refused before anything changes: removing a block
// (PURGE), xref and layout blocks (M1-21, M6), and changes to a dynamic block's links.

import {
  ACadVersion,
  BlockRecord,
  Layer,
  XYZ,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  BlockDefinition,
  BlockTableRecord,
  DocumentInit,
  DocumentModel,
  Handle,
  Vec2,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { onlyNewDictionary, type DrawOrderChanges } from './draw-order';
import { resolve, same, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

/** BLOCK DXF 70 bits a drawing's own blocks may carry: 1 anonymous, 2 has attribute definitions. */
const OWN_FLAGS = 1 | 2;
const ANONYMOUS = 1;
/** BLOCK DXF 70 bits of an xref (4, 8 overlay) and of a block an xref brings (16, 32). */
const XREF_BLOCK = 4 | 8 | 16 | 32;

/** `$INSUNITS` codes: 0 unitless to 24 US survey miles (AutoCAD 2024). */
const MAX_UNITS = 24;

/** A layout's block: AutoCAD names them and makes them with the layout (LAYOUT New, M6). */
const LAYOUT_BLOCK = /^\*(model|paper)_space/i;

/** What a block record defaults to when a format has nowhere to keep it. */
const SETTINGS_DEFAULTS = { units: 0, explodable: true, scalable: true } as const;
const SETTINGS = ['units', 'explodable', 'scalable'] as const;

/** Definition fields the save writes (the name is the record's). */
const WRITTEN = new Set(['handle', 'name', 'basePoint']);

export interface BlockPlan {
  readonly records: RecordPlan<BlockRecord, BlockTableRecord>;
  /** New definitions: their new record and base point. */
  readonly added: { readonly acad: BlockRecord; readonly basePoint: Vec2 }[];
  /** Definitions whose base point moves. */
  readonly moved: { readonly acad: BlockRecord; readonly basePoint: Vec2 }[];
}

/**
 * Where a block's units, explodability and scalability are kept: a DWG from R2007 (the fields
 * follow the R2007 marker in the BLOCK_HEADER object), and a DXF from R2000 (BLOCK_RECORD 70,
 * 280 and 281); an R12 DXF has no BLOCK_RECORD at all.
 */
function keepsSettings(format: CadFormat | undefined, version: ACadVersion | undefined): boolean {
  if (version === undefined || version === ACadVersion.Unknown) return true;
  return format === 'dwg' ? version >= ACadVersion.AC1021 : version >= ACadVersion.AC1015;
}

/** The model's block changes against the original's mapping, and why any cannot be written. */
export function planBlocks(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  format: CadFormat | undefined,
  drawOrder: DrawOrderChanges,
): { plan: BlockPlan; problems: string[] } {
  const version = doc.header?.version;
  const baseRecords = base.tables?.blockRecords ?? [];
  const was = new Map(baseRecords.map((b) => [b.handle, b]));
  // A record that only gains the extension dictionary a new draw order table needs is the draw
  // order writer's (draw-order.ts).
  const after = new Map(
    [...model.tables.blockRecords].map(([h, b]) => [
      h,
      onlyNewDictionary(drawOrder, was.get(h), b) ? was.get(h)! : b,
    ]),
  );
  const defs = new Map(model.blocks);
  const records = planRecords(doc, baseRecords, after, r, {
    what: 'block',
    removable: true,
    type: BlockRecord,
    make: (a) => {
      const acad = new BlockRecord(a.name);
      acad.blockFlags = (a.flags ?? 0) as never;
      return acad;
    },
    fixedNames: [],
    problems: (b, a) => recordProblems(format, version, b, a, defs.get(a.handle)),
  });
  const plan: BlockPlan = { records: records.plan, added: [], moved: [] };
  const problems = [...records.problems];
  const baseDefs = new Map((base.blocks ?? []).map((d) => [d.handle, d]));
  for (const [h, a] of defs) {
    const b = baseDefs.get(h);
    if (b && same(b, a)) continue;
    const record = after.get(h);
    const out: string[] = [];
    if (!record || record.name !== a.name) out.push(`its name differs from its BLOCK_RECORD's`);
    if (!same(b?.dynamic, a.dynamic) || !same(b?.dynamicOf, a.dynamicOf))
      out.push('dynamic block links change (Triya does not evaluate dynamic blocks)');
    const rest = (d: BlockDefinition | undefined) =>
      Object.fromEntries(
        Object.entries(d ?? {}).filter(([k]) => !WRITTEN.has(k) && !k.startsWith('dynamic')),
      );
    if (!same(rest(b), rest(a)))
      out.push('BLOCK or ENDBLK handles, xdata, reactors or an extension dictionary change');
    const moved = !b || !same(b.basePoint, a.basePoint);
    if (b && moved && (LAYOUT_BLOCK.test(b.name) || record?.layout !== undefined))
      out.push("a layout block's base point is $INSBASE");
    else if (b && moved && ((record?.flags ?? 0) & XREF_BLOCK) !== 0)
      out.push("an xref's base point is its drawing's (M1-21)");
    if (out.length > 0) {
      problems.push(...out.map((p) => `block ${a.name} (${h}): ${p}`));
      continue;
    }
    if (!moved) continue;
    const acad = resolve(r, h, BlockRecord);
    if (!acad) continue; // the record's own problem says why
    (b ? plan.moved : plan.added).push({ acad, basePoint: a.basePoint });
  }
  // A definition removed goes with its record, whose removal records.ts refuses.
  return { plan, problems };
}

function recordProblems(
  format: CadFormat | undefined,
  version: ACadVersion | undefined,
  b: BlockTableRecord | undefined,
  a: BlockTableRecord,
  def: BlockDefinition | undefined,
): string[] {
  const out: string[] = [];
  const renamed = !b || b.name !== a.name;
  const flags = a.flags ?? 0;
  if (!def) out.push('a BLOCK_RECORD without a block definition');
  if (b && renamed) {
    // AutoCAD's RENAME lists neither anonymous nor layout blocks, and a dynamic block's
    // name is also its AcDbDynamicBlockTrueName xdata.
    if (b.layout !== undefined || LAYOUT_BLOCK.test(b.name))
      return [`${b.name} cannot be renamed (a layout's block)`];
    if (((b.flags ?? 0) & ANONYMOUS) !== 0 || b.name.startsWith('*'))
      return ['an anonymous block cannot be renamed'];
    if (def?.dynamic) out.push("a dynamic block's name is in its AcDbDynamicBlockTrueName xdata");
  }
  if (!b && LAYOUT_BLOCK.test(a.name)) out.push("a layout's block comes with its layout (M6)");
  if (!b && a.layout !== undefined) out.push("a layout's block comes with its layout (M6)");
  if (b && !same(b.layout, a.layout)) out.push('its layout changes');
  if (!b || !same(b.flags ?? 0, flags)) {
    if ((flags & ~OWN_FLAGS) !== 0 || ((b?.flags ?? 0) & ~OWN_FLAGS) !== 0)
      out.push(`block flags ${flags} (xref blocks are M1-21)`);
    else if (b && ((b.flags ?? 0) & ANONYMOUS) !== (flags & ANONYMOUS))
      out.push('a block cannot become anonymous or named');
  }
  if (renamed && out.length === 0) {
    if (a.name.startsWith('*') && (flags & ANONYMOUS) === 0)
      out.push('a name starting with * needs the anonymous flag (1)');
    else if (!a.name.startsWith('*') && (flags & ANONYMOUS) !== 0)
      out.push("an anonymous block's name starts with *");
  }
  if (!Number.isInteger(a.units) || a.units < 0 || a.units > MAX_UNITS)
    out.push(`block units ${a.units} are not a $INSUNITS code (0 to ${MAX_UNITS})`);
  if (!keepsSettings(format, version)) {
    const name = version === undefined ? '' : ACadVersion[version];
    for (const k of SETTINGS) {
      if (b ? !same(b[k], a[k]) : a[k] !== SETTINGS_DEFAULTS[k])
        out.push(
          `${name} does not store a block's ${k === 'units' ? 'units' : k === 'explodable' ? 'Allow exploding' : 'Scale uniformly'}`,
        );
    }
  }
  return out;
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeRecord(
  acad: BlockRecord,
  b: BlockTableRecord | undefined,
  a: BlockTableRecord,
): void {
  const changed = changes(b, a);
  if (b && changed('name')) acad.name = a.name;
  if (b && changed('flags')) acad.blockFlags = (a.flags ?? 0) as never;
  if (changed('units')) acad.units = a.units as never;
  if (changed('explodable')) acad.isExplodable = a.explodable;
  if (changed('scalable')) acad.canScale = a.scalable;
}

/**
 * Writes the planned block changes onto `doc`, before any entity: the entities a new block holds
 * are added to it by the entity writer. New blocks join the BLOCK_RECORD table with their BLOCK and
 * ENDBLK numbered by `r.allocate()` and on layer 0, as AutoCAD keeps them.
 */
export function writeBlocks(doc: CadDocument, r: Resolver, plan: BlockPlan): void {
  const layer0 = doc.layers?.tryGetValue(Layer.defaultName);
  for (const { acad, after } of plan.records.added) {
    acad.blockEntity.handle = r.allocate();
    acad.blockEnd.handle = r.allocate();
    if (layer0) {
      acad.blockEntity.layer = layer0;
      acad.blockEnd.layer = layer0;
    }
    // acad-ts keeps a non-zero handle it has not seen, so the record keeps Triya's handle.
    doc.blockRecords!.add(acad);
    writeRecord(acad, undefined, after);
  }
  for (const { acad, before, after } of plan.records.updated) writeRecord(acad, before, after);
  for (const { acad, basePoint } of plan.added) {
    acad.blockEntity.basePoint = new XYZ(basePoint.x, basePoint.y, 0);
  }
  // A moved base point keeps the Z it had (Triya maps the plan view).
  for (const { acad, basePoint } of plan.moved) {
    acad.blockEntity.basePoint = new XYZ(basePoint.x, basePoint.y, acad.blockEntity.basePoint.z);
  }
}

// TriyaToAcad (ARCHITECTURE.md §6.1, M1-05): a save starts from the retained acad-ts original
// and applies, by handle, what differs between the Triya document and the original's own
// mapping. Unchanged objects are not touched at all, so whatever Triya does not map, and every
// detail of what it does, is written back exactly as read (the passthrough invariant, §6.2).
//
// Export compares states rather than replaying change sets: undo and redo then need nothing
// from the I/O side, and the original only has to be the file as opened (the I/O worker reads
// it again from the bytes it kept). The original is mutated, so each export needs a fresh read.

import type { CadDocument, TableEntry } from '@node-projects/acad-ts';
import {
  ACadVersion,
  BlockRecord,
  Entity as AcadEntity,
  LineType,
  Viewport,
} from '@node-projects/acad-ts';
import {
  compareHandles,
  type DocumentInit,
  type DocumentModel,
  type Entity,
  type EntityInit,
  type Handle,
} from '@triya/engine';
import { documentInit } from '../map/document';
import type { CadFormat } from '../read';
import { writeCadDocument, type WriteOptions } from '../write';
import { createAcadEntity, entityProblems, same, writeEntity, type Resolver } from './entities';
import {
  onlyNewDictionary,
  planDrawOrder,
  writeDrawOrder,
  type DrawOrderChanges,
} from './draw-order';
import { planHeader, writeHeader } from './header';
import { planLayers, writeLayers } from './layers';
import { planLinetypes, writeLinetypes } from './linetypes';
import { PassthroughStore } from './passthrough';
import { addR12View, r12ViewChanges, r12ViewportProblems, writeR12View } from './r12-viewport';
import { planTextStyles, writeTextStyles } from './text-styles';

/** R12 and before, whose viewports state their view in the MVIEW xdata (as patch 0119 reads it). */
const isR12 = (version: ACadVersion | undefined): boolean =>
  version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1012;

/** A difference the exporter cannot write yet; nothing was changed. */
export class UnsupportedChangeError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `cannot save these changes yet: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`,
    );
    this.name = 'UnsupportedChangeError';
  }
}

export interface ExportSummary {
  readonly updated: number;
  readonly added: number;
  readonly removed: number;
  /** Objects written back without Triya mapping them. */
  readonly passthrough: number;
}

interface Plan {
  readonly updated: {
    readonly acad: AcadEntity;
    readonly before: Entity | EntityInit;
    readonly after: Entity;
  }[];
  readonly added: { readonly block: BlockRecord; readonly after: Entity }[];
  readonly removed: AcadEntity[];
}

/** Mapped entities as the engine holds them, without the session-local id. */
const withoutId = (e: Entity): Omit<Entity, 'id'> => {
  const { id: _id, ...rest } = e;
  return rest;
};

function keyedProblems(
  what: string,
  before: readonly { handle: Handle }[],
  after: ReadonlyMap<Handle, unknown>,
): string[] {
  const out: string[] = [];
  const old = new Map(before.map((r) => [r.handle, r]));
  for (const [h, r] of old) if (!same(r, after.get(h))) out.push(`${what} ${h} changes`);
  for (const h of after.keys()) if (!old.has(h)) out.push(`new ${what} ${h}`);
  return out;
}

/** The tables whose records have writers (layers.ts, text-styles.ts, linetypes.ts). */
const WRITTEN_TABLES = new Set(['layers', 'textStyles', 'linetypes']);

/**
 * The non-entity changes no writer handles yet (header, the tables above and draw order:
 * header.ts, draw-order.ts). A block record may gain the extension dictionary a new draw order
 * table needs.
 */
function nonEntityProblems(
  base: DocumentInit,
  model: DocumentModel,
  drawOrder: DrawOrderChanges,
): string[] {
  const out: string[] = [];
  const baseTables = (base.tables ?? {}) as Record<string, readonly { handle: Handle }[]>;
  for (const [name, table] of Object.entries(model.tables)) {
    if (WRITTEN_TABLES.has(name)) continue;
    let records: ReadonlyMap<Handle, unknown> = table;
    if (name === 'blockRecords') {
      const was = new Map((base.tables?.blockRecords ?? []).map((b) => [b.handle, b]));
      records = new Map(
        [...model.tables.blockRecords].map(([h, b]) => [
          h,
          onlyNewDictionary(drawOrder, was.get(h), b) ? was.get(h) : b,
        ]),
      );
    }
    out.push(...keyedProblems(`${name} record`, baseTables[name] ?? [], records));
  }
  const notDrawOrder = <T extends { type: string }>(o: T): boolean => o.type !== 'SORTENTSTABLE';
  out.push(
    ...keyedProblems(
      'object',
      (base.objects ?? []).filter(notDrawOrder),
      new Map([...model.objects].filter(([, o]) => notDrawOrder(o))),
    ),
  );
  if (!same(base.layouts ?? [], model.layouts)) out.push('layout changes');
  if (!same(base.blocks ?? [], [...model.blocks.values()])) out.push('block definition changes');
  return out;
}

/**
 * Entity order: survivors must keep their order and new entities follow them, which is how
 * acad-ts appends to a block. Reordering is roadmap M1-75 (DRAWORDER edits SORTENTS instead).
 */
function orderProblems(base: DocumentInit, model: DocumentModel): string[] {
  const out: string[] = [];
  const baseOrder = new Map<Handle, Handle[]>();
  for (const e of base.entities ?? []) {
    const list = baseOrder.get(e.owner) ?? [];
    list.push(e.handle);
    baseOrder.set(e.owner, list);
  }
  for (const block of model.blocks.keys()) {
    const old = baseOrder.get(block) ?? [];
    const oldSet = new Set(old);
    const now = model.blockEntities(block).map((id) => model.entity(id)!.handle);
    const survivors = now.filter((h) => oldSet.has(h));
    const nowSet = new Set(now);
    const expected = old.filter((h) => nowSet.has(h));
    const firstNew = now.findIndex((h) => !oldSet.has(h));
    const lastOld = now.reduce((last, h, i) => (oldSet.has(h) ? i : last), -1);
    if (!same(survivors, expected) || (firstNew >= 0 && firstNew < lastOld)) {
      out.push(`entity order in block ${block} changes`);
    }
  }
  return out;
}

/**
 * What acad-ts cannot write to the format at hand: what an R12 viewport cannot state (see
 * r12-viewport.ts), its DWG writer leaves a LARGE_RADIAL_DIMENSION out (roadmap M1-74), and a
 * VIEWPORT's style sheet before R2000 or visual style before R2007, which neither format stores
 * (DXF 1 and 348 are R2000+ and R2007+, as the DWG fields are); so an edited or new one would be
 * lost. `acad` is the original of an edited entity.
 */
function formatProblems(
  format: CadFormat | undefined,
  version: ACadVersion | undefined,
  before: EntityInit | undefined,
  e: Entity,
  acad?: AcadEntity,
): string[] {
  if (format === 'dwg' && e.type === 'LARGE_RADIAL_DIMENSION') {
    return [`${e.type} ${e.handle}: acad-ts has no DWG writer for it (M1-74)`];
  }
  if (isR12(version) && e.geom.kind === 'VIEWPORT') {
    const b = before?.geom.kind === 'VIEWPORT' ? before.geom : undefined;
    const v = acad instanceof Viewport ? acad : undefined;
    return r12ViewportProblems(v, b, e.geom).map((p) => `${e.type} ${e.handle}: ${p}`);
  }
  if (e.geom.kind === 'VIEWPORT') {
    const b = before?.geom.kind === 'VIEWPORT' ? before.geom : undefined;
    const g = e.geom;
    const out: string[] = [];
    const name = version === undefined ? '' : (ACadVersion[version] ?? '');
    const sheet = b ? b.plotStyleSheet !== g.plotStyleSheet : g.plotStyleSheet !== '';
    const style = b ? b.visualStyle !== g.visualStyle : g.visualStyle !== undefined;
    if (sheet && version !== undefined && version < ACadVersion.AC1015) {
      out.push(`${e.type} ${e.handle}: ${name} cannot store a viewport's plot style sheet`);
    }
    if (style && version !== undefined && version < ACadVersion.AC1021) {
      out.push(`${e.type} ${e.handle}: ${name} cannot store a viewport's visual style`);
    }
    return out;
  }
  return [];
}

function plan(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  format: CadFormat | undefined,
  drawOrder: DrawOrderChanges,
): { plan: Plan; problems: string[] } {
  const problems = [...nonEntityProblems(base, model, drawOrder), ...orderProblems(base, model)];
  const version = doc.header?.version;
  const out: Plan = { updated: [], added: [], removed: [] };
  const baseByHandle = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  for (const b of base.entities ?? []) {
    const acad = r.store.original(b.handle);
    const m = model.entityByHandle(b.handle);
    if (!(acad instanceof AcadEntity)) {
      problems.push(`${b.type} ${b.handle}: the original is not an entity`);
      continue;
    }
    if (!m) {
      out.removed.push(acad);
      continue;
    }
    if (same(b, withoutId(m))) continue;
    if (m.owner !== b.owner) {
      problems.push(`${m.type} ${m.handle}: moves to another block`);
      continue;
    }
    problems.push(
      ...entityProblems(r, b as Entity, m),
      ...formatProblems(format, version, b, m, acad),
    );
    out.updated.push({ acad, before: b, after: m });
  }
  for (const m of model.entities()) {
    if (baseByHandle.has(m.handle)) continue;
    problems.push(
      ...entityProblems(r, undefined, m),
      ...formatProblems(format, version, undefined, m),
    );
    const block = r.store.original(m.owner);
    if (!(block instanceof BlockRecord)) {
      problems.push(`${m.type} ${m.handle}: owner block ${m.owner} is not in the drawing`);
    } else if (doc.getCadObject(Number.parseInt(m.handle, 16))) {
      problems.push(`${m.type} ${m.handle}: the handle is already used`);
    } else {
      out.added.push({ block, after: m });
    }
  }
  // Additions go in handle order, which is the order the engine allocated them in.
  out.added.sort((a, b) => compareHandles(a.after.handle, b.after.handle));
  return { plan: out, problems };
}

/**
 * Applies the Triya document's differences from `original`'s own mapping onto `original`, by
 * handle (ARCHITECTURE.md §6.1). Throws `UnsupportedChangeError`, leaving `original` as it was,
 * when a difference has no writer yet (for the `format` the save is for, when given).
 */
export function triyaToAcad(
  original: CadDocument,
  model: DocumentModel,
  format?: CadFormat,
): ExportSummary {
  const base = documentInit(original);
  const store = PassthroughStore.of(original, base);
  const lineTypes = original.lineTypes;
  const docHeader = original.header;
  // Held children a save creates (polyline vertices) are numbered after everything the engine
  // allocated, so they meet neither an engine handle nor one the file already uses.
  let next = Math.max(Number.parseInt(model.handSeed, 16), docHeader?.handleSeed ?? 0);
  const created = new Map<Handle, TableEntry>();
  const r = {
    store,
    byLayer: lineTypes?.tryGetValue('ByLayer') ?? LineType.byLayer,
    byBlock: lineTypes?.tryGetValue('ByBlock') ?? LineType.byBlock,
    allocate: () => next++,
    created,
  } satisfies Resolver;
  // Records first: entities and the header may name one the same save adds, a linetype's text
  // a text style, a layer a linetype.
  const textStyles = planTextStyles(original, base, model, r);
  const linetypes = planLinetypes(original, base, model, r);
  const layers = planLayers(original, base, model, r);
  const header = planHeader(original, base, model, format, [...created.values()]);
  const drawOrder = planDrawOrder(original, base, model, r);
  const { plan: p, problems } = plan(original, base, model, r, format, drawOrder);
  problems.unshift(
    ...header.problems,
    ...textStyles.problems,
    ...linetypes.problems,
    ...layers.problems,
  );
  problems.push(...drawOrder.problems);
  if (problems.length > 0) throw new UnsupportedChangeError(problems);

  writeTextStyles(original, textStyles.plan);
  writeLinetypes(original, r, linetypes.plan);
  writeLayers(original, r, layers.plan);

  // Removing an entity from its block unregisters it and its extension dictionary, which only
  // it owns (§6.2 rule 3); shared objects it points to stay. Its draw order entry goes with it,
  // as AutoCAD saves no entry for an erased entity.
  for (const e of p.removed) {
    const block = e.owner as BlockRecord;
    block.sortEntitiesTable?.remove(e);
    block.entities.remove(e);
  }
  const r12 = isR12(original.header?.version);
  for (const { acad, before, after } of p.updated) {
    writeEntity(r, acad, before as Entity, after);
    if (
      r12 &&
      acad instanceof Viewport &&
      before.geom.kind === 'VIEWPORT' &&
      after.geom.kind === 'VIEWPORT' &&
      r12ViewChanges(before.geom, after.geom)
    ) {
      writeR12View(acad);
    }
  }
  for (const { block, after } of p.added) {
    const e = createAcadEntity(after.geom)!;
    // acad-ts keeps a non-zero handle it has not seen, so the entity keeps Triya's handle.
    e.handle = Number.parseInt(after.handle, 16);
    block.entities.add(e);
    writeEntity(r, e, undefined, after);
    if (r12 && e instanceof Viewport) addR12View(original, e);
  }
  writeDrawOrder(original, drawOrder.plan, new Set(p.removed));
  writeHeader(original, header.changes);
  // New objects are allocated above $HANDSEED; the seed written back covers every handle the
  // engine handed out, used or not, as AutoCAD skips handles of cancelled objects, and every
  // held child the save numbered.
  const seed = Math.max(Number.parseInt(model.handSeed, 16), next);
  if (docHeader && seed > docHeader.handleSeed) docHeader.handleSeed = seed;
  return {
    updated: p.updated.length,
    added: p.added.length,
    removed: p.removed.length,
    passthrough: store.handles.length,
  };
}

/** `triyaToAcad`, then the writer: the bytes of the save (consumes `original`). */
export function exportDocument(
  original: CadDocument,
  model: DocumentModel,
  options: WriteOptions,
): Uint8Array {
  triyaToAcad(original, model, options.format);
  return writeCadDocument(original, options);
}

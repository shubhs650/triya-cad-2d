// TriyaToAcad (ARCHITECTURE.md §6.1, M1-05): a save starts from the retained acad-ts original
// and applies, by handle, what differs between the Triya document and the original's own
// mapping. Unchanged objects are not touched at all, so whatever Triya does not map, and every
// detail of what it does, is written back exactly as read (the passthrough invariant, §6.2).
//
// Export compares states rather than replaying change sets: undo and redo then need nothing
// from the I/O side, and the original only has to be the file as opened (the I/O worker reads
// it again from the bytes it kept). The original is mutated, so each export needs a fresh read.

import type { CadDocument } from '@node-projects/acad-ts';
import { BlockRecord, Entity as AcadEntity, LineType } from '@node-projects/acad-ts';
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
import { PassthroughStore } from './passthrough';

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

/**
 * Header variables acad-ts makes up on every read when the file does not state them (the clock
 * and fresh GUIDs, CadHeader.ts), so the model, mapped from an earlier read, cannot match the
 * original here. Triya never writes them: the writer and AutoCAD own them.
 */
const VOLATILE_HEADER = new Set([
  '$TDCREATE',
  '$TDUCREATE',
  '$TDUPDATE',
  '$TDUUPDATE',
  '$VERSIONGUID',
  '$FINGERPRINTGUID',
]);

function headerProblems(base: DocumentInit, model: DocumentModel): string[] {
  const before = new Map(base.header ?? []);
  const names = new Set([...before.keys(), ...model.header.keys()]);
  return [...names]
    .filter((n) => !VOLATILE_HEADER.has(n) && !same(before.get(n), model.header.get(n)))
    .map((n) => `header variable ${n} changes`);
}

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

function nonEntityProblems(base: DocumentInit, model: DocumentModel): string[] {
  const out = headerProblems(base, model);
  const baseTables = (base.tables ?? {}) as Record<string, readonly { handle: Handle }[]>;
  for (const [name, table] of Object.entries(model.tables)) {
    out.push(...keyedProblems(`${name} record`, baseTables[name] ?? [], table));
  }
  out.push(...keyedProblems('object', base.objects ?? [], model.objects));
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
 * Types acad-ts can read from a file but not write to the format at hand: its DWG writer leaves
 * a LARGE_RADIAL_DIMENSION out (roadmap M1-74), so an edited or new one would be lost.
 */
function formatProblems(format: CadFormat | undefined, e: Entity): string[] {
  return format === 'dwg' && e.type === 'LARGE_RADIAL_DIMENSION'
    ? [`${e.type} ${e.handle}: acad-ts has no DWG writer for it (M1-74)`]
    : [];
}

function plan(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  format: CadFormat | undefined,
): { plan: Plan; problems: string[] } {
  const problems = [...nonEntityProblems(base, model), ...orderProblems(base, model)];
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
    problems.push(...entityProblems(r, b as Entity, m), ...formatProblems(format, m));
    out.updated.push({ acad, before: b, after: m });
  }
  for (const m of model.entities()) {
    if (baseByHandle.has(m.handle)) continue;
    problems.push(...entityProblems(r, undefined, m), ...formatProblems(format, m));
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
  const header = original.header;
  // Held children a save creates (polyline vertices) are numbered after everything the engine
  // allocated, so they meet neither an engine handle nor one the file already uses.
  let next = Math.max(Number.parseInt(model.handSeed, 16), header?.handleSeed ?? 0);
  const r: Resolver = {
    store,
    byLayer: lineTypes?.tryGetValue('ByLayer') ?? LineType.byLayer,
    byBlock: lineTypes?.tryGetValue('ByBlock') ?? LineType.byBlock,
    allocate: () => next++,
  };
  const { plan: p, problems } = plan(original, base, model, r, format);
  if (problems.length > 0) throw new UnsupportedChangeError(problems);

  // Removing an entity from its block unregisters it and its extension dictionary, which only
  // it owns (§6.2 rule 3); shared objects it points to stay.
  for (const e of p.removed) (e.owner as BlockRecord).entities.remove(e);
  for (const { acad, before, after } of p.updated) writeEntity(r, acad, before as Entity, after);
  for (const { block, after } of p.added) {
    const e = createAcadEntity(after.geom)!;
    // acad-ts keeps a non-zero handle it has not seen, so the entity keeps Triya's handle.
    e.handle = Number.parseInt(after.handle, 16);
    block.entities.add(e);
    writeEntity(r, e, undefined, after);
  }
  // New objects are allocated above $HANDSEED; the seed written back covers every handle the
  // engine handed out, used or not, as AutoCAD skips handles of cancelled objects, and every
  // held child the save numbered.
  const seed = Math.max(Number.parseInt(model.handSeed, 16), next);
  if (header && seed > header.handleSeed) header.handleSeed = seed;
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

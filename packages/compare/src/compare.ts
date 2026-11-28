// Drawing compare (M8-05, FR-Z3, DEC-022): which entities one drawing added, removed or modified
// against another, on normalised geometry and handles. Not a pixel diff.
//
// Each space is compared with the same space of the other drawing: model space with model space,
// a layout with the layout of the same name (case aside, as AutoCAD names layouts). Within a space
// entities are paired in two passes:
//
// 1. By handle (`matchHandles`, on by default): two revisions of one file keep their handles, as
//    Triya and AutoCAD never renumber them, so an entity with the same handle and type in both is
//    the same object, modified when its geometry or properties differ.
// 2. By geometry, for what is left: an entity of the same type whose normalised geometry agrees
//    within the tolerance is the same object redrawn (a drawing rebuilt from scratch, or a copy
//    pasted over an erased original), modified when only its properties differ.
//
// Whatever is still unpaired was removed (only in the first drawing) or added (only in the
// second). Entities inside block definitions are not listed: a named block whose contents differ
// makes its references `block` modifications, and an anonymous block is compared by contents,
// since every save may renumber it. AutoCAD's DWG Compare works the same way on geometry and
// lists changed block definitions through their references.

import {
  toleranceForSize,
  type DocumentModel,
  type Entity,
  type EntityType,
  type Handle,
  type Tolerance,
} from '@triya/engine';
import {
  Names,
  TEXT_KEYS,
  anchorOf,
  geometryDifferences,
  magnitudeOf,
  propertyDifferences,
  sameValue,
  type PropertyKey,
  type SameContext,
} from './same';

/** COMPARE's settings (DWG Compare's Settings dialog, plus how entities pair). */
export interface CompareSettings {
  /**
   * How far a coordinate or length (drawing units) and an angle (radians) may move and still be
   * the same. Each defaults to the drawings' own epsilon, from the larger drawing's extents
   * (DEC-036), so that only noise from a file's round trip is ignored.
   */
  readonly tolerance?: Partial<Tolerance>;
  /** Pair entities by handle before geometry (two revisions of one file). Default true. */
  readonly matchHandles?: boolean;
  /** Compare entity properties (layer, colour, linetype...). Default true; false: geometry only. */
  readonly properties?: boolean;
}

/** What differs about a modified entity. */
export type CompareChange =
  /** Its geometry (position, size, shape, style references). */
  | 'geometry'
  /** What it says: a text's or attribute definition's contents, a dimension's text override. */
  | 'text'
  /** A block reference's attributes. */
  | 'attributes'
  /** A block reference's named block holds other entities in the second drawing. */
  | 'block'
  | PropertyKey;

export type CompareStatus = 'added' | 'removed' | 'modified';

export interface CompareItem {
  readonly status: CompareStatus;
  /** 'Model' or the layout's name, as the drawing holding the entity names it. */
  readonly space: string;
  readonly type: EntityType;
  /** The entity in the first drawing (removed or modified). */
  readonly a?: Handle;
  /** The entity in the second drawing (added or modified). */
  readonly b?: Handle;
  /** How a modified entity was paired with its original. */
  readonly matchedBy?: 'handle' | 'geometry';
  /** What differs, for a modified entity: geometry first, then the properties in AcDbEntity order. */
  readonly changes: readonly CompareChange[];
  /** The geometry keys that differ (`start`, `radius`, `contents`...), sorted. */
  readonly fields: readonly string[];
}

/** An entity found unchanged: the same in both drawings. */
export interface ComparePair {
  readonly space: string;
  readonly a: Handle;
  readonly b: Handle;
  readonly matchedBy: 'handle' | 'geometry';
}

export interface CompareResult {
  /** The tolerance used. */
  readonly tolerance: Tolerance;
  /** Differences, space by space (Model, then layouts in tab order), removed and modified in the first drawing's order, then added in the second's. */
  readonly items: readonly CompareItem[];
  readonly unchanged: readonly ComparePair[];
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly unchanged: number;
  };
}

interface Space {
  readonly name: string;
  readonly block: Handle;
}

/** Model space and every paper space of a drawing, in tab order. */
function spacesOf(model: DocumentModel): Space[] {
  const out: Space[] = [];
  const seen = new Set<Handle>();
  const records = [...model.tables.blockRecords.values()];
  const modelSpace = records.find((r) => r.name.toUpperCase() === '*MODEL_SPACE');
  if (modelSpace && model.hasBlock(modelSpace.handle)) {
    out.push({ name: 'Model', block: modelSpace.handle });
    seen.add(modelSpace.handle);
  }
  for (const l of model.layouts) {
    if (seen.has(l.blockRecord) || !model.hasBlock(l.blockRecord)) continue;
    out.push({ name: l.name, block: l.blockRecord });
    seen.add(l.blockRecord);
  }
  // A paper space without a layout (an R12 file's *Paper_Space) keeps its record's name.
  for (const r of records) {
    if (!seen.has(r.handle) && /^\*PAPER_SPACE/i.test(r.name) && model.hasBlock(r.handle)) {
      out.push({ name: r.name, block: r.handle });
      seen.add(r.handle);
    }
  }
  return out;
}

function entitiesOf(model: DocumentModel, block: Handle): Entity[] {
  return model.blockEntities(block).flatMap((id) => {
    const e = model.entity(id);
    return e ? [e] : [];
  });
}

/** The pairs two lists of entities make, by handle then by geometry. */
interface Pairing {
  readonly pairs: { a: Entity; b: Entity; matchedBy: 'handle' | 'geometry' }[];
  readonly removed: Entity[];
  readonly added: Entity[];
}

class Comparison {
  readonly ctx: SameContext;
  readonly #settings: Required<Omit<CompareSettings, 'tolerance'>>;
  readonly #blocks = new Map<string, boolean>();

  constructor(a: DocumentModel, b: DocumentModel, tol: Tolerance, settings: CompareSettings) {
    this.#settings = {
      matchHandles: settings.matchHandles ?? true,
      properties: settings.properties ?? true,
    };
    this.ctx = {
      tol,
      a: new Names(a),
      b: new Names(b),
      sameBlock: (ha, hb) => this.sameBlock(ha, hb),
    };
  }

  /** The differences between two entities thought to be the same object. */
  differences(a: Entity, b: Entity): { changes: CompareChange[]; fields: string[] } {
    const fields = geometryDifferences(a.geom, b.geom, this.ctx);
    const changes: CompareChange[] = [];
    if (fields.some((f) => !TEXT_KEYS.has(f) && f !== 'attributes')) changes.push('geometry');
    if (fields.some((f) => TEXT_KEYS.has(f))) changes.push('text');
    if (fields.includes('attributes')) changes.push('attributes');
    if (
      a.geom.kind === 'INSERT' &&
      b.geom.kind === 'INSERT' &&
      !fields.includes('block') &&
      !this.sameBlock(a.geom.block, b.geom.block)
    ) {
      changes.push('block');
    }
    if (this.#settings.properties) changes.push(...propertyDifferences(a, b, this.ctx));
    return { changes, fields };
  }

  #same(a: Entity, b: Entity): boolean {
    return this.differences(a, b).changes.length === 0;
  }

  /** Whether two block definitions hold the same entities (in any order) about the same base point. */
  sameBlock(ha: Handle, hb: Handle): boolean {
    const key = `${ha} ${hb}`;
    const known = this.#blocks.get(key);
    if (known !== undefined) return known;
    // A block that refers to itself (never valid, but read) is taken as the same meanwhile.
    this.#blocks.set(key, true);
    const ba = this.ctx.a.block(ha);
    const bb = this.ctx.b.block(hb);
    let same = false;
    if (ba && bb && sameValue('', ba.basePoint, bb.basePoint, this.ctx)) {
      const ea = entitiesOf(this.ctx.a.model, ha);
      const eb = entitiesOf(this.ctx.b.model, hb);
      if (ea.length === eb.length) {
        const p = this.pair(ea, eb, false, (x, y) => this.#same(x, y));
        same = p.removed.length === 0 && p.added.length === 0;
      }
    }
    this.#blocks.set(key, same);
    return same;
  }

  /**
   * Pairs `ea` with `eb`: by handle when `byHandle`, then each unpaired entity of `ea` with an
   * unpaired entity of `eb` of its type whose geometry agrees, preferring one for which `exact`
   * holds as well (the same properties too).
   */
  pair(
    ea: readonly Entity[],
    eb: readonly Entity[],
    byHandle: boolean,
    exact: (a: Entity, b: Entity) => boolean,
  ): Pairing {
    const pairs: Pairing['pairs'] = [];
    const takenB = new Set<Entity>();
    const left: Entity[] = [];
    if (byHandle) {
      const bByHandle = new Map(eb.map((e) => [e.handle, e]));
      for (const a of ea) {
        const b = bByHandle.get(a.handle);
        if (b && b.type === a.type) {
          pairs.push({ a, b, matchedBy: 'handle' });
          takenB.add(b);
        } else left.push(a);
      }
    } else left.push(...ea);

    // Unpaired entities of `eb` filed by type and by the grid cell of their anchor; an anchor
    // within the tolerance of another lies in the same or a neighbouring cell.
    const cell = Math.max(2 * this.ctx.tol.linear, Number.MIN_VALUE);
    const index = new Map<string, Entity[]>();
    const keyOf = (type: string, i: number, j: number) => `${type} ${i} ${j}`;
    for (const b of eb) {
      if (takenB.has(b)) continue;
      const p = anchorOf(b.geom);
      const k = keyOf(b.type, Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = index.get(k);
      if (list) list.push(b);
      else index.set(k, [b]);
    }
    const removed: Entity[] = [];
    for (const a of left) {
      const p = anchorOf(a.geom);
      const i = Math.floor(p.x / cell);
      const j = Math.floor(p.y / cell);
      let found: Entity | undefined;
      let fallback: Entity | undefined;
      for (let di = -1; di <= 1 && !found; di++) {
        for (let dj = -1; dj <= 1 && !found; dj++) {
          for (const b of index.get(keyOf(a.type, i + di, j + dj)) ?? []) {
            if (takenB.has(b)) continue;
            if (geometryDifferences(a.geom, b.geom, this.ctx).length !== 0) continue;
            if (exact(a, b)) {
              found = b;
              break;
            }
            fallback ??= b;
          }
        }
      }
      const b = found ?? fallback;
      if (b) {
        pairs.push({ a, b, matchedBy: 'geometry' });
        takenB.add(b);
      } else removed.push(a);
    }
    return { pairs, removed, added: eb.filter((b) => !takenB.has(b)) };
  }

  get matchHandles(): boolean {
    return this.#settings.matchHandles;
  }
}

function defaultTolerance(a: DocumentModel, b: DocumentModel): Tolerance {
  let m = 0;
  for (const model of [a, b]) {
    for (const e of model.entities()) m = Math.max(m, magnitudeOf(e.geom));
  }
  // Coordinates up to m apart span up to 2m.
  return toleranceForSize(2 * m);
}

/**
 * Compares drawing `b` (the revision) with drawing `a` (the original): what `b` added, removed
 * and modified, space by space.
 */
export function compareDrawings(
  a: DocumentModel,
  b: DocumentModel,
  settings: CompareSettings = {},
): CompareResult {
  const base = defaultTolerance(a, b);
  const tolerance: Tolerance = {
    linear: settings.tolerance?.linear ?? base.linear,
    angular: settings.tolerance?.angular ?? base.angular,
  };
  const cmp = new Comparison(a, b, tolerance, settings);
  const spacesB = new Map(spacesOf(b).map((s) => [s.name.toUpperCase(), s]));
  const items: CompareItem[] = [];
  const unchanged: ComparePair[] = [];
  const counted = { added: 0, removed: 0, modified: 0 };

  const report = (space: string, ea: readonly Entity[], eb: readonly Entity[]) => {
    const p = cmp.pair(
      ea,
      eb,
      cmp.matchHandles,
      (x, y) => cmp.differences(x, y).changes.length === 0,
    );
    // Pairs in the first drawing's order, interleaved with what it removed.
    const pairOf = new Map(p.pairs.map((q) => [q.a, q]));
    const removed = new Set(p.removed);
    for (const e of ea) {
      const q = pairOf.get(e);
      if (q) {
        const d = cmp.differences(q.a, q.b);
        if (d.changes.length === 0) {
          unchanged.push({ space, a: q.a.handle, b: q.b.handle, matchedBy: q.matchedBy });
        } else {
          items.push({
            status: 'modified',
            space,
            type: q.b.type,
            a: q.a.handle,
            b: q.b.handle,
            matchedBy: q.matchedBy,
            ...d,
          });
          counted.modified++;
        }
      } else if (removed.has(e)) {
        items.push({
          status: 'removed',
          space,
          type: e.type,
          a: e.handle,
          changes: [],
          fields: [],
        });
        counted.removed++;
      }
    }
    for (const e of p.added) {
      items.push({ status: 'added', space, type: e.type, b: e.handle, changes: [], fields: [] });
      counted.added++;
    }
  };

  for (const sa of spacesOf(a)) {
    const key = sa.name.toUpperCase();
    const sb = spacesB.get(key);
    spacesB.delete(key);
    report(sa.name, entitiesOf(a, sa.block), sb ? entitiesOf(b, sb.block) : []);
  }
  for (const sb of spacesB.values()) report(sb.name, [], entitiesOf(b, sb.block));

  return {
    tolerance,
    items,
    unchanged,
    counts: { ...counted, unchanged: unchanged.length },
  };
}

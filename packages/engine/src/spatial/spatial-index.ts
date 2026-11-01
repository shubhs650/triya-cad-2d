// SpatialIndex (M1-07, ARCHITECTURE.md §4): one R-tree per block record, so one per layout
// (each layout draws one block record) and one per block definition, keyed on the entity's
// bounds in that block's own coordinates. The renderer culls with it, osnap and picking ask it
// for candidates, and block references are bounded through it.
//
// Each block's tree is a static packed R-tree plus an overlay of entries edited since it was
// built (dead tree items are skipped). An edit costs a map update; once the overlay and dead
// items pass a share of the block, the tree is repacked, so queries stay at packed-tree speed
// and the repack cost is spread over many edits.
//
// Invalidation: `apply(changeSet)`, called right after `DocumentModel.apply` with the same
// change set, re-bounds the touched entities and then every INSERT (and DIMENSION and
// ACAD_TABLE, through their *D and *T blocks) whose block's contents changed, up through
// nesting, because their boxes are built from block extents.

import { boxesOverlap, type Box } from '../geom/bounds';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity } from '../model/types';
import type { Tolerance } from '../geom/tolerance';
import {
  entityBounds,
  type AnnotationBounds,
  type BoundsContext,
  type EntityBounds,
} from './entity-bounds';
import { PackedRTree } from './packed-tree';
import { annotationParts } from '../annotation/multileader';

/** Kinds whose bounds use `annotationBounds`: themselves, or their attributes (INSERT). */
const ANNOTATION_KINDS: ReadonlySet<string> = new Set([
  'TEXT',
  'MTEXT',
  'ATTDEF',
  'TOLERANCE',
  'LEADER',
  'MULTILEADER',
  'DIMENSION',
  'ARC_DIMENSION',
  'INSERT',
]);

export interface SpatialIndexOptions {
  /** The document's extents-derived tolerance (spline bounds flatten with it). */
  readonly tol: Tolerance;
  /** Exact text and annotation bounds, when a text engine is available. */
  readonly annotationBounds?: AnnotationBounds;
  /**
   * Edits a block's tree absorbs before it is repacked. Default: 1/16 of the block's entries,
   * at least 256. Tests set it low to exercise repacking.
   */
  readonly maxPending?: number;
}

/** Block extents: a box (EMPTY_BOX when nothing is drawn) or 'unknown'. */
export type BlockExtents = Box | 'unknown';

type InfiniteBounds = Extract<EntityBounds, { kind: 'infinite' }>;

/** Does the line (or ray) cross the closed box? Liang–Barsky clipping of its parameter range. */
function lineHitsBox(l: InfiniteBounds, q: Box): boolean {
  let t0 = l.ray ? 0 : -Infinity;
  let t1 = Infinity;
  const axes: [number, number, number, number][] = [
    [l.base.x, l.direction.x, q.minX, q.maxX],
    [l.base.y, l.direction.y, q.minY, q.maxY],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (d === 0) {
      if (p < lo || p > hi) return false;
      continue;
    }
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1;
}

/** One block record's entries. */
class BlockTree {
  tree = PackedRTree.build([]);
  readonly entries = new Map<EntityId, EntityBounds>();
  /** Finite boxes not in `tree`: edited since it was packed. */
  readonly overlay = new Map<EntityId, Box>();
  readonly infinite = new Map<EntityId, InfiniteBounds>();
  readonly unknown = new Set<EntityId>();

  set(id: EntityId, b: EntityBounds): void {
    this.delete(id);
    this.entries.set(id, b);
    if (b.kind === 'box') this.overlay.set(id, b.box);
    else if (b.kind === 'infinite') this.infinite.set(id, b);
    else if (b.kind === 'unknown') this.unknown.add(id);
  }

  delete(id: EntityId): void {
    if (!this.entries.delete(id)) return;
    this.tree.kill(id);
    this.overlay.delete(id);
    this.infinite.delete(id);
    this.unknown.delete(id);
  }

  query(q: Box, out: EntityId[]): void {
    this.tree.search(q, out);
    for (const [id, b] of this.overlay) if (boxesOverlap(b, q, 0)) out.push(id);
    for (const [id, l] of this.infinite) if (lineHitsBox(l, q)) out.push(id);
    for (const id of this.unknown) out.push(id);
  }

  repackIfNeeded(maxPending: number | undefined): void {
    const pending = this.overlay.size + this.tree.deadCount;
    if (pending > (maxPending ?? Math.max(256, this.entries.size >> 4))) this.repack();
  }

  repack(): void {
    const items: { id: EntityId; box: Box }[] = [];
    for (const [id, b] of this.entries) if (b.kind === 'box') items.push({ id, box: b.box });
    this.tree = PackedRTree.build(items);
    this.overlay.clear();
  }

  extents(): BlockExtents {
    if (this.unknown.size > 0 || this.infinite.size > 0) return 'unknown';
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of this.entries.values()) {
      if (b.kind !== 'box') continue;
      minX = Math.min(minX, b.box.minX);
      minY = Math.min(minY, b.box.minY);
      maxX = Math.max(maxX, b.box.maxX);
      maxY = Math.max(maxY, b.box.maxY);
    }
    return { minX, minY, maxX, maxY };
  }
}

/** The blocks an entity's bounds are built from: its block, or its parts' arrowhead blocks. */
function referencedBlocks(e: Entity, model: DocumentModel): readonly Handle[] {
  const g = e.geom;
  if (g.kind === 'INSERT') return [g.block];
  if (g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION' || g.kind === 'ACAD_TABLE')
    return g.block === undefined ? [] : [g.block];
  const parts = annotationParts(g, model);
  if (!parts) return [];
  return [...new Set(parts.flatMap((p) => (p.geom.kind === 'INSERT' ? [p.geom.block] : [])))];
}

export class SpatialIndex {
  readonly #model: DocumentModel;
  readonly #options: SpatialIndexOptions;
  readonly #ctx: BoundsContext;
  readonly #trees = new Map<Handle, BlockTree>();
  /** Block → the entities whose bounds come from its extents. */
  readonly #refs = new Map<Handle, Set<EntityId>>();
  /** Entity → the blocks it was linked under, so unlinking needs no recomputation. */
  readonly #linked = new Map<EntityId, readonly Handle[]>();
  readonly #extents = new Map<Handle, BlockExtents>();
  /** Blocks whose extents are being computed, to cut reference cycles. */
  readonly #computing = new Set<Handle>();
  /** Entities whose bounds must be recomputed before anyone reads them. */
  readonly #stale = new Set<EntityId>();
  readonly #refreshing = new Set<EntityId>();

  private constructor(model: DocumentModel, options: SpatialIndexOptions) {
    this.#model = model;
    this.#options = options;
    this.#ctx = {
      tol: options.tol,
      annotationBounds: options.annotationBounds,
      blockExtents: (h) => this.extents(h),
      basePoint: (h) => model.blocks.get(h)?.basePoint,
      tables: model,
    };
  }

  /** Indexes every block record of the model. */
  static build(model: DocumentModel, options: SpatialIndexOptions): SpatialIndex {
    const index = new SpatialIndex(model, options);
    const all: Entity[] = [];
    for (const h of model.blocks.keys()) {
      for (const id of model.blockEntities(h)) all.push(model.entity(id)!);
    }
    index.#update([], all);
    for (const t of index.#trees.values()) t.repack();
    return index;
  }

  /** Brings the index up to date with a change set the model has just applied. */
  apply(cs: ChangeSet): void {
    // A text style edit (font, width factor, obliquing) moves the glyphs of every text.
    if (cs.tables?.textStyles) this.reboundAnnotations();
    const e = cs.entities;
    if (!e) return;
    const removed = [
      ...(e.removed ?? []).map((p) => p.entity),
      ...(e.updated ?? []).map((r) => r.before),
    ];
    const added = [
      ...(e.added ?? []).map((p) => p.entity),
      ...(e.updated ?? []).map((r) => r.after),
    ];
    this.#update(removed, added);
  }

  /**
   * Re-bounds every entity whose bounds come from `annotationBounds` (text, attributes and
   * other annotations) and the references whose blocks hold them: after a text style changes,
   * or when the fonts behind the bounds change (a user font loaded, M1-37).
   */
  reboundAnnotations(): void {
    const all: Entity[] = [];
    for (const h of this.#model.blocks.keys())
      for (const id of this.#model.blockEntities(h)) {
        const e = this.#model.entity(id)!;
        if (ANNOTATION_KINDS.has(e.geom.kind)) all.push(e);
      }
    this.#update(all, all);
  }

  /**
   * Entities of the block record whose bounds overlap `box` (closed: touching counts), in no
   * particular order. Entities with unknown bounds are always included; callers that need an
   * exact answer test the candidates' geometry.
   */
  query(block: Handle, box: Box): EntityId[] {
    const out: EntityId[] = [];
    this.#trees.get(block)?.query(box, out);
    return out;
  }

  /** `query` on the block record a layout draws (model space for the Model layout). */
  queryLayout(layout: Handle, box: Box): EntityId[] {
    const l = this.#model.layouts.find((x) => x.handle === layout);
    if (!l) throw new Error(`layout ${layout} does not exist`);
    return this.query(l.blockRecord, box);
  }

  /** The bounds the index holds for an entity, or undefined if the entity does not exist. */
  bounds(id: EntityId): EntityBounds | undefined {
    const owner = this.#model.entity(id)?.owner;
    return owner === undefined ? undefined : this.#trees.get(owner)?.entries.get(id);
  }

  /**
   * The extents of a block record's contents in its own coordinates (EMPTY_BOX when empty),
   * 'unknown' when it holds something without known bounds, undefined for no such block.
   */
  extents(block: Handle): BlockExtents | undefined {
    if (!this.#model.hasBlock(block)) return undefined;
    const memo = this.#extents.get(block);
    if (memo !== undefined) return memo;
    if (this.#computing.has(block)) return 'unknown'; // the block contains itself
    this.#computing.add(block);
    let cyclic = false;
    for (const id of this.#model.blockEntities(block)) {
      // A member being bounded right now asked (through other blocks) for these extents.
      if (this.#refreshing.has(id)) cyclic = true;
      else this.#refresh(id);
    }
    this.#computing.delete(block);
    const ext = cyclic ? 'unknown' : this.#tree(block).extents();
    this.#extents.set(block, ext);
    return ext;
  }

  #tree(block: Handle): BlockTree {
    let t = this.#trees.get(block);
    if (!t) {
      t = new BlockTree();
      this.#trees.set(block, t);
    }
    return t;
  }

  #link(e: Entity): void {
    const blocks = referencedBlocks(e, this.#model);
    if (blocks.length === 0) return;
    this.#linked.set(e.id, blocks);
    for (const block of blocks) {
      let set = this.#refs.get(block);
      if (!set) {
        set = new Set();
        this.#refs.set(block, set);
      }
      set.add(e.id);
    }
  }

  #unlink(e: Entity): void {
    for (const block of this.#linked.get(e.id) ?? []) this.#refs.get(block)?.delete(e.id);
    this.#linked.delete(e.id);
  }

  #update(removed: readonly Entity[], added: readonly Entity[]): void {
    const dirty = new Set<Handle>();
    for (const e of removed) {
      this.#trees.get(e.owner)?.delete(e.id);
      this.#unlink(e);
      dirty.add(e.owner);
    }
    for (const e of added) {
      this.#link(e);
      this.#stale.add(e.id);
      dirty.add(e.owner);
    }
    // Every block whose contents changed, and every block that (transitively) references one:
    // their memoised extents are stale, and so are the references' bounds.
    const affected = [...dirty];
    const seen = new Set(affected);
    for (let i = 0; i < affected.length; i++) {
      const block = affected[i]!;
      this.#extents.delete(block);
      for (const ref of this.#refs.get(block) ?? []) {
        this.#stale.add(ref);
        const owner = this.#model.entity(ref)?.owner;
        if (owner !== undefined && !seen.has(owner)) {
          seen.add(owner);
          affected.push(owner);
        }
      }
    }
    for (const id of [...this.#stale]) this.#refresh(id);
    for (const block of affected) this.#trees.get(block)?.repackIfNeeded(this.#options.maxPending);
  }

  #refresh(id: EntityId): void {
    if (!this.#stale.delete(id)) return;
    const e = this.#model.entity(id);
    if (!e) return;
    this.#refreshing.add(id);
    const b = entityBounds(e.geom, this.#ctx);
    this.#refreshing.delete(id);
    this.#tree(e.owner).set(id, b);
  }
}

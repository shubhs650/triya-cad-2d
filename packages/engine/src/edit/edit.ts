// ERASE, MOVE/ROTATE/SCALE/MIRROR and COPY on a set of objects (M2-06): the per-object geometry
// is transform.ts's; this is what goes with it, as AutoCAD 2024 keeps a drawing consistent.
//
// - A dimension draws its `*D` block, which holds it as last drawn in drawing coordinates: the
//   block's contents are carried with the dimension (their text kept readable), and a copy gets
//   a block of its own. A table's `*T` block is in the table's frame: it only scales.
// - Objects that hang together move together: a clipped viewport and its clip boundary, and an
//   associative hatch whose every boundary object moves. A hatch or associative dimension that
//   would lose its shape (some of its boundary or geometry moved without it, or it without
//   them) lets go of it, as AutoCAD's associativity does when it cannot follow; Triya has no
//   hatch or dimension regeneration yet (M2-10, M4-07) to follow instead.
// - ERASE unhooks what referred to an erased object: an associative hatch, a dimension
//   association, a leader's annotation, a viewport's clip, a group's member list.
// - A copy is a new object: its own handle (and its ATTRIBs'), no reactors or extension
//   dictionary, so no associativity or group membership, except that hatches copied with their
//   whole boundary stay associative with the copies. Copies of annotative objects are not
//   annotative (a new annotative object is DEC-013's, not saved yet).
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  DimAssoc,
  Entity,
  EntityGeometry,
  Group,
  HatchGeometry,
  InsertAttribute,
  NonGraphicalObject,
  SpatialFilter,
  Xdata,
} from '../model/types';
import { moveBy, point, scaleAbout, type Similarity } from './similarity';
import { stretchGeometry } from './stretch';
import { moveGrip } from './grips';
import { sub } from '../geom/vec';
import {
  annotativeData,
  transformGeometry,
  transformProblem,
  type TransformOptions,
} from './transform';

/** What an edit did, and the objects it left out with the reason for each. */
export interface EditReport {
  /** The objects changed, or for COPY the copies made. */
  readonly ids: readonly EntityId[];
  /** Reason → how many objects it kept out. */
  readonly refused: ReadonlyMap<string, number>;
  /** How many copies of annotative objects were made without their annotation scales. */
  readonly unannotated: number;
}

/** DXF 90 bit 65536: the viewport is clipped by its 340 entity. */
const NON_RECTANGULAR = 0x10000;

const hatchSources = (g: HatchGeometry): Handle[] => [
  ...new Set(g.loops.flatMap((l) => l.sources ?? [])),
];

const assocGeometry = (a: DimAssoc): Handle[] => [
  ...new Set(
    a.points.flatMap((p) => (p ? [...p.geometry, ...(p.intersection?.geometry ?? [])] : [])),
  ),
];

/** The links between objects an edit must keep straight, read once per edit. */
class Links {
  readonly #b: ChangeSetBuilder;
  readonly #model: DocumentModel;
  readonly assocs: DimAssoc[];
  readonly groups: Group[];

  constructor(b: ChangeSetBuilder, model: DocumentModel) {
    this.#b = b;
    this.#model = model;
    const all = [...model.objects.values()];
    this.assocs = all.filter((o): o is DimAssoc => o.type === 'DIMASSOC');
    this.groups = all.filter((o): o is Group => o.type === 'GROUP');
  }

  entity(h: Handle | undefined): Entity | undefined {
    if (h === undefined) return undefined;
    const id = this.#model.ids.idOf(h);
    return id === undefined ? undefined : this.#b.entity(id);
  }

  /** Takes `gone` off the reactors of the entities `on`. */
  unreact(on: Iterable<Handle>, gone: Handle): void {
    for (const h of on) {
      const e = this.entity(h);
      if (e?.reactors?.includes(gone)) {
        const reactors = e.reactors.filter((r) => r !== gone);
        this.#b.updateEntity(e.id, { reactors: reactors.length > 0 ? reactors : undefined });
      }
    }
  }

  /** An associative hatch lets go of its boundary objects (HATCHEDIT Associative off). */
  dissociateHatch(hatch: Entity): void {
    const g = this.#b.entity(hatch.id)?.geom;
    if (g?.kind !== 'HATCH' || !g.associative) return;
    const sources = hatchSources(g);
    const loops = g.loops.map(({ sources: _sources, ...l }) => l);
    this.#b.updateEntity(hatch.id, { geom: { ...g, loops, associative: false } });
    this.unreact(sources, hatch.handle);
  }

  /** A dimension association is dropped (DIMDISASSOCIATE). */
  disassociate(a: DimAssoc): void {
    if (!this.#b.object(a.handle)) return;
    this.#b.removeObject(a.handle);
    this.unreact([a.dimension, ...assocGeometry(a)], a.handle);
  }

  /** A viewport lets go of its clip boundary and is rectangular again (VPCLIP Delete). */
  unclip(viewport: Entity): void {
    const g = this.#b.entity(viewport.id)?.geom;
    if (g?.kind !== 'VIEWPORT' || g.clipBoundary === undefined) return;
    const { clipBoundary, ...rest } = g;
    this.#b.updateEntity(viewport.id, { geom: { ...rest, flags: g.flags & ~NON_RECTANGULAR } });
    this.unreact([clipBoundary], viewport.handle);
  }
}

const isLocked = (b: ChangeSetBuilder, e: Entity): boolean =>
  b.tableRecord('layers', e.layer)?.locked === true;

function count(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

// ── ERASE ───────────────────────────────────────────────────────────────────────────────────

/** ERASE: removes the objects and unhooks whatever referred to them. */
export function eraseObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
): EditReport {
  const links = new Links(b, model);
  const refused = new Map<string, number>();
  // A layer's viewport overrides name the viewport; Triya cannot rewrite them yet (M1-62).
  const overridden = new Set<Handle>();
  for (const l of model.tables.layers.values()) {
    for (const o of l.viewportOverrides ?? []) overridden.add(o.viewport);
  }
  const erased: Entity[] = [];
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    if (overridden.has(e.handle))
      count(refused, 'a viewport with layer overrides cannot be erased yet');
    else erased.push(e);
  }
  const gone = new Set(erased.map((e) => e.handle));
  // An XCLIP goes with its reference.
  for (const o of model.objects.values()) {
    if (
      o.type === 'SPATIAL_FILTER' &&
      gone.has((o as SpatialFilter).insert) &&
      b.object(o.handle)
    ) {
      b.removeObject(o.handle);
    }
  }
  for (const a of links.assocs) {
    if (gone.has(a.dimension) || assocGeometry(a).some((h) => gone.has(h))) links.disassociate(a);
  }
  for (const g of links.groups) {
    const entities = g.entities.filter((h) => !gone.has(h));
    if (entities.length !== g.entities.length) {
      b.updateObject(g.handle, { entities } as Partial<NonGraphicalObject>);
    }
  }
  for (const e of erased) {
    const g = e.geom;
    if (g.kind === 'HATCH') links.unreact(hatchSources(g), e.handle);
    if (g.kind === 'LEADER' && g.annotation !== undefined) {
      links.unreact([g.annotation], e.handle);
    }
    if (g.kind === 'VIEWPORT' && g.clipBoundary !== undefined) {
      links.unreact([g.clipBoundary], e.handle);
    }
    // Whatever names this object lets go of it.
    for (const r of e.reactors ?? []) {
      const other = links.entity(r);
      if (!other || gone.has(other.handle)) continue;
      const og = other.geom;
      if (og.kind === 'HATCH' && hatchSources(og).includes(e.handle)) links.dissociateHatch(other);
      if (og.kind === 'LEADER' && og.annotation === e.handle) {
        const { annotation: _annotation, ...rest } = og;
        b.updateEntity(other.id, { geom: rest });
      }
      if (og.kind === 'VIEWPORT' && og.clipBoundary === e.handle) links.unclip(other);
    }
  }
  for (const e of erased) b.removeEntity(e.id);
  return { ids: erased.map((e) => e.id), refused, unannotated: 0 };
}

// ── MOVE, ROTATE, SCALE, MIRROR ─────────────────────────────────────────────────────────────

/** The objects that go with `ids`: clip boundaries with their viewports, hatches with their whole boundary. */
function withPartners(b: ChangeSetBuilder, links: Links, ids: readonly EntityId[]): Entity[] {
  const set = new Map<Handle, Entity>();
  const add = (e: Entity | undefined) => {
    if (e && !set.has(e.handle) && !isLocked(b, e)) set.set(e.handle, e);
  };
  for (const id of ids) add(b.entity(id));
  for (const e of [...set.values()]) {
    const g = e.geom;
    if (g.kind === 'VIEWPORT') add(links.entity(g.clipBoundary));
    for (const r of e.reactors ?? []) {
      const other = links.entity(r);
      if (other?.geom.kind === 'VIEWPORT' && other.geom.clipBoundary === e.handle) add(other);
    }
  }
  for (const e of [...set.values()]) {
    for (const r of e.reactors ?? []) {
      const other = links.entity(r);
      if (other?.geom.kind === 'HATCH' && other.geom.associative) {
        if (hatchSources(other.geom).every((h) => set.has(h))) add(other);
      }
    }
  }
  return [...set.values()];
}

/** MOVE, ROTATE, SCALE or MIRROR (without copying): `ids` carried by `t`. */
export function transformObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  t: Similarity,
  o: TransformOptions = {},
): EditReport {
  const links = new Links(b, model);
  const refused = new Map<string, number>();
  const candidates = withPartners(b, links, ids);
  const moving: Entity[] = [];
  for (const e of candidates) {
    const problem = transformProblem(e.geom, t);
    if (problem) count(refused, problem);
    else moving.push(e);
  }
  const moved = new Set(moving.map((e) => e.handle));
  // What would lose its shape lets go first, while its old links are still in place.
  for (const e of moving) {
    for (const r of e.reactors ?? []) {
      const other = links.entity(r);
      if (other?.geom.kind === 'HATCH' && !moved.has(other.handle)) links.dissociateHatch(other);
    }
    if (e.geom.kind === 'HATCH' && !hatchSources(e.geom).every((h) => moved.has(h))) {
      links.dissociateHatch(e);
    }
  }
  const keptAssocs: DimAssoc[] = [];
  for (const a of links.assocs) {
    const members = [a.dimension, ...assocGeometry(a)].filter((h) => links.entity(h));
    const inside = members.filter((h) => moved.has(h)).length;
    if (inside === 0) continue;
    if (inside === members.length) keptAssocs.push(a);
    else links.disassociate(a);
  }
  const blocksDone = new Set<Handle>();
  for (const e of moving) {
    const cur = b.entity(e.id)!;
    b.updateEntity(e.id, carried(cur, t, o));
    carryBlock(b, cur.geom, t, blocksDone);
  }
  for (const a of keptAssocs) {
    const points = a.points.map((p) => {
      if (!p) return p;
      const q = point(t, p.point);
      return { ...p, point: { ...p.point, x: q.x, y: q.y } };
    });
    b.updateObject(a.handle, { points } as Partial<NonGraphicalObject>);
  }
  return { ids: moving.map((e) => e.id), refused, unannotated: 0 };
}

/** An entity's geometry carried, with its annotative representations. */
function carried(
  e: Entity,
  t: Similarity,
  o: TransformOptions,
): Pick<Entity, 'geom' | 'annotative'> {
  const geom = transformGeometry(e.geom, t, o);
  const g = e.geom;
  if (e.annotative && (g.kind === 'TEXT' || g.kind === 'ATTDEF')) {
    return { geom, annotative: annotativeData(t, e.annotative, g, o) };
  }
  return { geom };
}

/** A dimension's `*D` block carried with it; a table's `*T` block scaled about its base. */
function carryBlock(
  b: ChangeSetBuilder,
  g: EntityGeometry,
  t: Similarity,
  done: Set<Handle>,
): void {
  const inner = blockMotion(b, g, t);
  if (!inner || done.has(inner.block)) return;
  done.add(inner.block);
  for (const id of b.blockEntities(inner.block)) {
    const e = b.entity(id)!;
    if (transformProblem(e.geom, inner.t)) continue;
    b.updateEntity(id, carried(e, inner.t, { mirrorText: false }));
  }
}

/** How the block an entity draws by moves with it, if it does. */
function blockMotion(
  b: ChangeSetBuilder,
  g: EntityGeometry,
  t: Similarity,
): { block: Handle; t: Similarity } | undefined {
  const isDim =
    g.kind === 'DIMENSION' || g.kind === 'ARC_DIMENSION' || g.kind === 'LARGE_RADIAL_DIMENSION';
  if (isDim && g.block !== undefined && b.block(g.block)) return { block: g.block, t };
  if (g.kind === 'ACAD_TABLE' && g.block !== undefined && t.scale !== 1) {
    const d = b.block(g.block);
    if (d) return { block: g.block, t: scaleAbout(d.basePoint, t.scale) };
  }
  return undefined;
}

// ── STRETCH ─────────────────────────────────────────────────────────────────────────────────

/** Where STRETCH's window is, and what the canvas says lies in it. */
export interface StretchWindow {
  readonly box: Box;
  /** The objects wholly inside it (moved whatever their kind); unknown without a canvas. */
  readonly inside?: ReadonlySet<EntityId>;
  /**
   * The objects it crosses or holds. One the selection took that is not here was picked
   * individually, and moves ("objects selected individually are moved rather than stretched").
   */
  readonly crossing?: ReadonlySet<EntityId>;
}

/** How STRETCH treats each selected object: moved whole, given a new shape, or left. */
export interface StretchPlan {
  readonly move: readonly EntityId[];
  readonly shape: ReadonlyMap<EntityId, EntityGeometry>;
  readonly refused: ReadonlyMap<string, number>;
}

/** The points of a box (edges included, as AutoCAD's window takes a point on its edge). */
export const inBox =
  (box: Box) =>
  (p: Vec2): boolean =>
    p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;

/** What STRETCH by `d` does to each of `ids` (`stretch.ts` per object). */
export function planStretch(
  model: DocumentModel,
  ids: readonly EntityId[],
  w: StretchWindow | undefined,
  d: Vec2,
): StretchPlan {
  const move: EntityId[] = [];
  const shape = new Map<EntityId, EntityGeometry>();
  const refused = new Map<string, number>();
  const inside = w ? inBox(w.box) : () => false;
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    if (!w || w.inside?.has(id) || (w.crossing && !w.crossing.has(id))) {
      move.push(id);
      continue;
    }
    const r = stretchGeometry(e.geom, inside, d);
    if (r.kind === 'move') move.push(id);
    else if (r.kind === 'shape') shape.set(id, r.geom);
    else if (r.kind === 'whole') count(refused, r.reason);
  }
  return { move, shape, refused };
}

/**
 * STRETCH: the objects' points inside the window move by `d`, objects wholly inside (or picked
 * individually) move whole. What linked to a reshaped object lets go of it: an associative
 * hatch, a dimension association (Triya cannot regenerate either yet, M2-10, M4-07).
 */
export function stretchObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  w: StretchWindow | undefined,
  d: Vec2,
): EditReport {
  return applyStretch(b, model, planStretch(model, ids, w, d), d);
}

/** What dragging the grip at `grip` to `to` does to each of `ids` (`grips.ts`). */
export function planGrip(
  model: DocumentModel,
  ids: readonly EntityId[],
  grip: Vec2,
  to: Vec2,
): StretchPlan {
  const move: EntityId[] = [];
  const shape = new Map<EntityId, EntityGeometry>();
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    const r = moveGrip(e.geom, grip, to);
    if (r.kind === 'move') move.push(id);
    else if (r.kind === 'shape') shape.set(id, r.geom);
  }
  return { move, shape, refused: new Map() };
}

/** The STRETCH grip mode: the grip at `grip` of each of `ids` that has one dragged to `to`. */
export function gripObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  grip: Vec2,
  to: Vec2,
): EditReport {
  return applyStretch(b, model, planGrip(model, ids, grip, to), sub(to, grip));
}

/** A stretch plan carried out: reshaped objects let go of their links, moved ones carry them. */
function applyStretch(
  b: ChangeSetBuilder,
  model: DocumentModel,
  plan: StretchPlan,
  d: Vec2,
): EditReport {
  const links = new Links(b, model);
  const refused = new Map(plan.refused);
  const reshaped: EntityId[] = [];
  for (const [id, geom] of plan.shape) {
    const e = b.entity(id);
    if (!e || isLocked(b, e)) continue;
    for (const r of e.reactors ?? []) {
      const other = links.entity(r);
      if (other?.geom.kind === 'HATCH') links.dissociateHatch(other);
    }
    for (const a of links.assocs) {
      if (assocGeometry(a).includes(e.handle) || a.dimension === e.handle) links.disassociate(a);
    }
    b.updateEntity(id, { geom });
    reshaped.push(id);
  }
  const moved = transformObjects(b, model, plan.move, moveBy(d));
  for (const [reason, n] of moved.refused) refused.set(reason, (refused.get(reason) ?? 0) + n);
  return { ids: [...moved.ids, ...reshaped], refused, unannotated: 0 };
}

// ── COPY ────────────────────────────────────────────────────────────────────────────────────

/** Why `e` cannot be copied, beyond what keeps it from moving. */
function copyProblem(e: Entity, t: Similarity): string | undefined {
  const g = e.geom;
  if (g.kind === 'REGION') return 'a region cannot be copied';
  if (g.kind === 'VIEWPORT' && g.clipBoundary !== undefined) {
    return 'a clipped viewport cannot be copied';
  }
  return transformProblem(g, t);
}

/** COPY (and ROTATE, SCALE or MIRROR keeping the originals): copies of `ids` carried by `t`. */
export function copyObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  t: Similarity,
  o: TransformOptions = {},
): EditReport {
  const refused = new Map<string, number>();
  const copies = new Map<Handle, Entity>();
  const names = new AnonymousNames(model);
  let unannotated = 0;
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    const problem = copyProblem(e, t);
    if (problem) {
      count(refused, problem);
      continue;
    }
    if (e.annotative) unannotated++;
    copies.set(e.handle, copyEntity(b, e, e.owner, t, o, names));
  }
  // A hatch copied with its whole boundary stays associative with the boundary's copies.
  for (const copy of copies.values()) {
    const g = copy.geom;
    if (g.kind !== 'HATCH' || !g.associative) continue;
    const sources = hatchSources(g);
    if (!sources.every((h) => copies.has(h))) {
      const loops = g.loops.map(({ sources: _sources, ...l }) => l);
      b.updateEntity(copy.id, { geom: { ...g, loops, associative: false } });
      continue;
    }
    const loops = g.loops.map((l) =>
      l.sources ? { ...l, sources: l.sources.map((h) => copies.get(h)!.handle) } : l,
    );
    b.updateEntity(copy.id, { geom: { ...g, loops } });
    for (const h of sources) {
      const s = b.entity(copies.get(h)!.id)!;
      b.updateEntity(s.id, { reactors: [...(s.reactors ?? []), copy.handle] });
    }
  }
  return { ids: [...copies.values()].map((e) => e.id), refused, unannotated };
}

/** The next free `*D<n>` or `*T<n>` name, for the block a dimension's or table's copy draws. */
class AnonymousNames {
  readonly #next = new Map<string, number>();
  readonly #model: DocumentModel;
  constructor(model: DocumentModel) {
    this.#model = model;
  }

  take(prefix: string): string {
    let n = this.#next.get(prefix);
    if (n === undefined) {
      n = 1;
      const re = new RegExp(`^\\*${prefix}(\\d+)$`, 'i');
      for (const d of this.#model.blocks.values()) {
        const m = re.exec(d.name);
        if (m) n = Math.max(n, Number(m[1]) + 1);
      }
    }
    this.#next.set(prefix, n + 1);
    return `*${prefix}${n}`;
  }
}

/**
 * The xdata a copy keeps: all but the annotative property's (`AcadAnnotative`, which goes with
 * the annotation scales a copy does not keep) and an R12 viewport's view (`ACAD`'s MVIEW data,
 * which the save writes from the viewport itself).
 */
function copiedXdata(
  b: ChangeSetBuilder,
  e: Entity | InsertAttribute,
  viewport: boolean,
): Xdata | undefined {
  if (!e.xdata) return undefined;
  const kept = e.xdata.filter((x) => {
    const name = b.tableRecord('appIds', x.appId)?.name.toUpperCase();
    return name !== 'ACADANNOTATIVE' && !(viewport && name === 'ACAD');
  });
  return kept.length > 0 ? kept : undefined;
}

/** The properties a copy keeps: everything but identity, links and annotation scales. */
function copiedProps(b: ChangeSetBuilder, e: Entity | InsertAttribute, viewport = false) {
  const xdata = copiedXdata(b, e, viewport);
  return {
    layer: e.layer,
    // A new object cannot take a colour book's name yet (the save refuses it): the copy keeps
    // the colour's RGB value.
    color:
      e.color.kind === 'rgb' && (e.color.bookName !== undefined || e.color.colorName !== undefined)
        ? { kind: 'rgb' as const, r: e.color.r, g: e.color.g, b: e.color.b }
        : e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
    transparency: e.transparency,
    ltScale: e.ltScale,
    visible: e.visible,
    ...(e.plotStyle !== undefined ? { plotStyle: e.plotStyle } : {}),
    ...(e.material !== undefined ? { material: e.material } : {}),
    ...(xdata !== undefined ? { xdata } : {}),
  };
}

function copyEntity(
  b: ChangeSetBuilder,
  e: Entity,
  owner: Handle,
  t: Similarity,
  o: TransformOptions,
  names: AnonymousNames,
): Entity {
  let geom = transformGeometry(e.geom, t, o);
  switch (geom.kind) {
    case 'INSERT':
      geom = {
        ...geom,
        attributes: geom.attributes.map((a) => {
          const {
            handle: _handle,
            raw: _raw,
            reactors: _reactors,
            extDict: _extDict,
            annotative: _annotative,
            xdata: _xdata,
            ...rest
          } = a;
          const xdata = copiedXdata(b, a, false);
          return { ...rest, ...(xdata ? { xdata } : {}), handle: b.allocateHandle() };
        }),
      };
      break;
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      if (geom.block !== undefined && b.block(geom.block)) {
        geom = { ...geom, block: copyBlock(b, geom.block, 'D', t, names) };
      }
      break;
    case 'ACAD_TABLE':
      if (geom.block !== undefined) {
        const d = b.block(geom.block);
        if (d)
          geom = {
            ...geom,
            block: copyBlock(b, geom.block, 'T', scaleAbout(d.basePoint, t.scale), names),
          };
      }
      break;
    case 'LEADER': {
      const { annotation: _annotation, ...rest } = geom;
      geom = rest;
      break;
    }
    case 'VIEWPORT': {
      let id = 1;
      for (const other of b.blockEntities(owner)) {
        const og = b.entity(other)?.geom;
        if (og?.kind === 'VIEWPORT') id = Math.max(id, og.id + 1);
      }
      geom = { ...geom, id };
      break;
    }
  }
  return b.addEntity({ ...copiedProps(b, e, geom.kind === 'VIEWPORT'), owner, geom });
}

/** A copy of an anonymous block, its contents carried by `t`; returns the copy's handle. */
function copyBlock(
  b: ChangeSetBuilder,
  block: Handle,
  prefix: 'D' | 'T',
  t: Similarity,
  names: AnonymousNames,
): Handle {
  const src = b.block(block)!;
  const basePoint: Vec2 = src.basePoint;
  const def = b.addBlock({ name: names.take(prefix), basePoint, flags: 1 });
  for (const id of b.blockEntities(block)) {
    const e = b.entity(id)!;
    if (copyProblem(e, t)) continue;
    copyEntity(b, e, def.handle, t, { mirrorText: false }, names);
  }
  return def.handle;
}

/** The command-line lines for what an edit left out: "1 was not moved: …". */
export function refusalMessages(refused: ReadonlyMap<string, number>, verb: string): string[] {
  return [...refused].map(
    ([reason, n]) => `${n} ${n === 1 ? 'object was' : 'objects were'} not ${verb}: ${reason}.`,
  );
}

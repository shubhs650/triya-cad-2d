// TriyaToAcad for the links AutoCAD keeps both ways through an entity's reactors
// (102 {ACAD_REACTORS 330}):
// - a LEADER and its annotation (M1-75 part 15): the LEADER names the MTEXT, TOLERANCE or block
//   reference it annotates (DXF 340), and the annotation lists the leader in its reactors, as
//   every LEADER of the AutoCAD-saved corpus files shows. The LEADER command makes the leader
//   first and its annotation next, so a new leader may name an annotation the same save adds.
// - an associative HATCH and its boundary objects (M1-75 part 17): each loop lists the objects
//   it was made from (DXF 97 count and 330 handles), and each object lists the hatch in its
//   reactors, as every associative hatch of the corpus shows. HATCH with "Pick points" (and
//   BOUNDARY) makes the boundary first, so a new hatch may name objects the same save adds.
// Other reactor changes (groups, associative dimensions, viewport clips, ...) are still refused:
// their other end is not written yet.

import type {
  DocumentInit,
  DocumentModel,
  Entity,
  EntityInit,
  Handle,
  HatchLoop,
} from '@triya/engine';
import { same } from './entities';

/** What AutoCAD attaches to a leader as its annotation (AcDbLeader::attachAnnotation). */
const ANNOTATION_TYPES = new Set(['MTEXT', 'TOLERANCE', 'INSERT']);

/**
 * The curves AutoCAD keeps an associative hatch on ("lines, arcs, circles, 2D polylines,
 * ellipses, splines and regions", AutoCAD 2024 HATCH, Boundaries).
 */
const CURVE_TYPES = new Set([
  'LINE',
  'ARC',
  'CIRCLE',
  'ELLIPSE',
  'SPLINE',
  'LWPOLYLINE',
  'POLYLINE',
  'REGION',
]);
/**
 * The text a text box loop (DXF 92 bit 8) goes around, as island detection treats it. The
 * corpus shows MTEXT only; TEXT is taken as the same kind of island (AutoCAD's documentation
 * names "text" without listing the object types).
 */
const TEXT_TYPES = new Set(['TEXT', 'MTEXT']);
/** DXF 92 bit 8: a loop around a text box. */
const TEXT_BOX = 8;

const annotationOf = (e: Entity | EntityInit): Handle | undefined =>
  e.geom.kind === 'LEADER' ? e.geom.annotation : undefined;

const loopsOf = (e: Entity | EntityInit | undefined): readonly HatchLoop[] =>
  e?.geom.kind === 'HATCH' ? e.geom.loops : [];

/** The boundary objects of a hatch, every loop's in order (none for any other entity). */
const sourcesOf = (e: Entity | EntityInit | undefined): Handle[] =>
  loopsOf(e).flatMap((l) => l.sources ?? []);

/** Whether `owner`, listed in an entity's reactors, names entity `handle` back. */
function linked(owner: Entity | undefined, handle: Handle): boolean {
  if (!owner) return false;
  return annotationOf(owner) === handle || sourcesOf(owner).includes(handle);
}

/** Why the model's entity reactors, leader annotations and hatch boundaries cannot be written. */
export function reactorProblems(base: DocumentInit, model: DocumentModel): string[] {
  const out: string[] = [];
  const baseByHandle = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  for (const m of model.entities()) {
    const b = baseByHandle.get(m.handle);
    const what = `${m.type} ${m.handle}`;
    const after = m.reactors ?? [];
    const before = b?.reactors ?? [];
    if (!same(before, after)) {
      for (const h of after.filter((x) => !before.includes(x))) {
        if (!linked(model.entityByHandle(h), m.handle)) {
          out.push(`${what}: reactor ${h} is not a leader it annotates or a hatch it bounds`);
        }
      }
      for (const h of before.filter((x) => !after.includes(x))) {
        const was = baseByHandle.get(h);
        const now = model.entityByHandle(h);
        if (!was || (was.geom.kind !== 'LEADER' && was.geom.kind !== 'HATCH')) {
          out.push(`${what}: reactor ${h} goes, which is not a leader's or a hatch's`);
        } else if (linked(now, m.handle)) {
          const kind = was.geom.kind === 'LEADER' ? 'leader still annotates' : 'hatch still names';
          out.push(`${what}: reactor ${h} goes, but that ${kind} it`);
        }
      }
    }
    if (m.geom.kind === 'LEADER') out.push(...leaderProblems(model, what, m, b));
    if (m.geom.kind === 'HATCH') out.push(...hatchProblems(model, what, m, b));
  }
  return out;
}

function leaderProblems(
  model: DocumentModel,
  what: string,
  m: Entity,
  b: EntityInit | undefined,
): string[] {
  const out: string[] = [];
  const annotation = annotationOf(m);
  const old = b && annotationOf(b);
  if (b && annotation === old) return out;
  if (annotation !== undefined) {
    const a = model.entityByHandle(annotation);
    if (!a) {
      out.push(`${what}: annotation ${annotation} is not an entity of the drawing`);
    } else {
      if (!ANNOTATION_TYPES.has(a.type)) {
        out.push(
          `${what}: annotation ${annotation} is a ${a.type}, not MTEXT, TOLERANCE or INSERT`,
        );
      }
      if (a.owner !== m.owner) out.push(`${what}: annotation ${annotation} is in another block`);
      if (!(a.reactors ?? []).includes(m.handle)) {
        out.push(`${what}: annotation ${annotation} does not point back at it (reactors)`);
      }
    }
  }
  // AutoCAD takes the leader off the reactors of an annotation it no longer annotates.
  if (old !== undefined && old !== annotation) {
    const a = model.entityByHandle(old);
    if (a && (a.reactors ?? []).includes(m.handle)) {
      out.push(`${what}: its old annotation ${old} still points at it (reactors)`);
    }
  }
  return out;
}

function hatchProblems(
  model: DocumentModel,
  what: string,
  m: Entity,
  b: EntityInit | undefined,
): string[] {
  if (m.geom.kind !== 'HATCH') return [];
  const g = m.geom;
  const perLoop = (e: Entity | EntityInit | undefined) => loopsOf(e).map((l) => l.sources ?? []);
  const wasAssociative = b?.geom.kind === 'HATCH' && b.geom.associative;
  if (b && wasAssociative === g.associative && same(perLoop(b), perLoop(m))) return [];
  const out: string[] = [];
  const sources = sourcesOf(m);
  // AutoCAD writes no boundary objects for a hatch that is not associative (DXF 97 is 0), and
  // makes a hatch non-associative when its boundary objects go (HATCHEDIT, ERASE).
  if (!g.associative && sources.length > 0) {
    out.push(`${what}: boundary objects on a hatch that is not associative`);
  }
  if (g.associative && sources.length === 0) {
    out.push(`${what}: associative without boundary objects`);
  }
  const seen = new Set<Handle>();
  g.loops.forEach((l, i) => {
    const textBox = (l.flags & TEXT_BOX) !== 0;
    for (const h of l.sources ?? []) {
      const where = `${what}: loop ${i}: boundary object ${h}`;
      if (seen.has(h)) out.push(`${where} twice`);
      seen.add(h);
      const s = model.entityByHandle(h);
      if (!s) {
        out.push(`${where} is not an entity of the drawing`);
        continue;
      }
      if (s.owner !== m.owner) out.push(`${where} is in another block`);
      if (TEXT_TYPES.has(s.type)) {
        if (!textBox) out.push(`${where} is text, in a loop that is not a text box`);
      } else if (!CURVE_TYPES.has(s.type) || (s.geom.kind === 'POLYLINE' && s.geom.is3d)) {
        out.push(`${where} is a ${s.type}, not a curve or text AutoCAD bounds a hatch with`);
      } else if (textBox) {
        out.push(`${where} is a ${s.type}, in a text box loop`);
      }
      if (!(s.reactors ?? []).includes(m.handle)) {
        out.push(`${where} does not point back at it (reactors)`);
      }
    }
  });
  // AutoCAD takes the hatch off the reactors of an object it no longer keeps to.
  for (const h of sourcesOf(b)) {
    if (sources.includes(h)) continue;
    const s = model.entityByHandle(h);
    if (s && (s.reactors ?? []).includes(m.handle)) {
      out.push(`${what}: its old boundary object ${h} still points at it (reactors)`);
    }
  }
  return out;
}

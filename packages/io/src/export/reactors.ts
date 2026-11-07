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
// - a non-rectangular VIEWPORT and the entity that clips it (M1-75 part 18): the viewport names
//   it (DXF 340, DWG hard pointer) and sets "non-rectangular clipping" (DXF 90 bit 65536), and
//   the entity lists the viewport in its reactors, as every clipped viewport of the corpus
//   shows. VPCLIP Polygonal and MVIEW Polygonal draw the polygon first, so a viewport may be
//   clipped by an entity the same save adds.
// - a GROUP and its members (M1-75 part 23): the group lists them (DXF 340), and each lists the
//   group in its reactors, as every grouped entity of the corpus shows. GROUP makes the group
//   with its members, so a new group's members list it in the same save; the group's own side
//   is checked in groups.ts.
// - a DIMASSOC and the dimension and geometry it links (M1-75 part 35): the DIMASSOC names
//   them (DXF 330, 331, 332), and each lists the DIMASSOC in its reactors, as every associative
//   dimension of the corpus shows; the DIMASSOC's side is checked in dim-assocs.ts.
// Other reactor changes are still refused: their other end is not written yet.

import type {
  DocumentInit,
  DocumentModel,
  Entity,
  EntityGeometry,
  EntityInit,
  DimAssoc,
  Group,
  Handle,
  HatchLoop,
  NonGraphicalObject,
} from '@triya/engine';
import { dimAssocGeometry } from './dim-assocs';
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

/** DXF 90 bit 65536: the viewport is clipped by its 340 entity (DXF reference, VIEWPORT). */
const NON_RECTANGULAR = 0x10000;

/**
 * What VPCLIP and MVIEW Object take as a clipping boundary: "closed polylines, circles,
 * ellipses, closed splines, and regions" (AutoCAD 2024 VPCLIP).
 */
const CLIP_TYPES = new Set(['LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'REGION']);

const clipOf = (e: Entity | EntityInit | undefined): Handle | undefined =>
  e?.geom.kind === 'VIEWPORT' ? e.geom.clipBoundary : undefined;

/** Whether a clip boundary of an accepted type is closed (open curves cannot clip). */
function closed(g: EntityGeometry): boolean {
  switch (g.kind) {
    case 'LWPOLYLINE':
      return g.closed;
    case 'POLYLINE':
      return g.closed && !g.is3d;
    case 'SPLINE':
      return g.closed || g.periodic;
    case 'ELLIPSE': {
      // A full ellipse runs a whole turn of its parameter; acad-ts writes 0 to 2π.
      const sweep = g.endParam - g.startParam;
      return Math.abs(Math.abs(sweep) - 2 * Math.PI) <= 1e-9 || sweep === 0;
    }
    default:
      return true;
  }
}

const loopsOf = (e: Entity | EntityInit | undefined): readonly HatchLoop[] =>
  e?.geom.kind === 'HATCH' ? e.geom.loops : [];

/** The boundary objects of a hatch, every loop's in order (none for any other entity). */
const sourcesOf = (e: Entity | EntityInit | undefined): Handle[] =>
  loopsOf(e).flatMap((l) => l.sources ?? []);

const isGroup = (o: NonGraphicalObject | undefined): o is Group => o?.type === 'GROUP';
const isAssoc = (o: NonGraphicalObject | undefined): o is DimAssoc => o?.type === 'DIMASSOC';

/** The objects that list themselves in entities' reactors and are written. */
type Linker = Entity | Group | DimAssoc;

/** Whether `owner`, listed in an entity's reactors, names entity `handle` back. */
function linked(owner: Linker | undefined, handle: Handle): boolean {
  if (!owner) return false;
  if ('geom' in owner) {
    return (
      annotationOf(owner) === handle ||
      sourcesOf(owner).includes(handle) ||
      clipOf(owner) === handle
    );
  }
  if (isAssoc(owner)) {
    return owner.dimension === handle || dimAssocGeometry(owner).includes(handle);
  }
  return owner.entities.includes(handle);
}

/** The entity kinds that list themselves in another's reactors, and what they call the link. */
const LINKS: Record<string, string> = {
  LEADER: 'leader still annotates it',
  HATCH: 'hatch still names it',
  VIEWPORT: 'viewport is still clipped by it',
  GROUP: 'group still lists it',
  DIMASSOC: 'dimension association still names it',
};

/**
 * Why the model's entity reactors, leader annotations, hatch boundaries and viewport clips
 * cannot be written.
 */
export function reactorProblems(base: DocumentInit, model: DocumentModel): string[] {
  const out: string[] = [];
  const baseByHandle = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  const baseGroups = new Map(
    (base.objects ?? [])
      .filter((o): o is Group | DimAssoc => isGroup(o) || isAssoc(o))
      .map((g) => [g.handle, g] as const),
  );
  const owner = (h: Handle): Linker | undefined => {
    const o = model.objects.get(h);
    return isGroup(o) || isAssoc(o) ? o : model.entityByHandle(h);
  };
  for (const m of model.entities()) {
    const b = baseByHandle.get(m.handle);
    const what = `${m.type} ${m.handle}`;
    const after = m.reactors ?? [];
    const before = b?.reactors ?? [];
    if (!same(before, after)) {
      for (const h of after.filter((x) => !before.includes(x))) {
        if (!linked(owner(h), m.handle)) {
          out.push(
            `${what}: reactor ${h} is not a leader it annotates, a hatch it bounds, a viewport it clips, a group it is in or a dimension association naming it`,
          );
        }
      }
      for (const h of before.filter((x) => !after.includes(x))) {
        const was = baseGroups.get(h) ?? baseByHandle.get(h);
        const kind = was && ('geom' in was ? was.geom.kind : was.type);
        if (!kind || !(kind in LINKS)) {
          out.push(
            `${what}: reactor ${h} goes, which is not a leader's, a hatch's, a viewport's, a group's or a dimension association's`,
          );
        } else if (linked(owner(h), m.handle)) {
          out.push(`${what}: reactor ${h} goes, but that ${LINKS[kind]}`);
        }
      }
    }
    if (m.geom.kind === 'LEADER') out.push(...leaderProblems(model, what, m, b));
    if (m.geom.kind === 'HATCH') out.push(...hatchProblems(model, what, m, b));
    if (m.geom.kind === 'VIEWPORT') out.push(...viewportProblems(model, what, m, b));
  }
  return out;
}

function viewportProblems(
  model: DocumentModel,
  what: string,
  m: Entity,
  b: EntityInit | undefined,
): string[] {
  if (m.geom.kind !== 'VIEWPORT') return [];
  const clip = m.geom.clipBoundary;
  const old = clipOf(b);
  const nonRectangular = (m.geom.flags & NON_RECTANGULAR) !== 0;
  const wasNonRectangular = b?.geom.kind === 'VIEWPORT' && (b.geom.flags & NON_RECTANGULAR) !== 0;
  if (b && clip === old && nonRectangular === wasNonRectangular) return [];
  const out: string[] = [];
  // VPCLIP sets the flag with the clip and clears it on Delete; AutoCAD draws a viewport with
  // one and not the other as neither.
  if (clip !== undefined && !nonRectangular) {
    out.push(`${what}: a clip boundary without non-rectangular clipping (DXF 90 bit 65536)`);
  }
  if (clip === undefined && nonRectangular) {
    out.push(`${what}: non-rectangular clipping (DXF 90 bit 65536) without a clip boundary`);
  }
  if (clip !== undefined && clip !== old) {
    const where = `${what}: clip boundary ${clip}`;
    const c = model.entityByHandle(clip);
    if (!c) {
      out.push(`${where} is not an entity of the drawing`);
    } else {
      if (c.owner !== m.owner) out.push(`${where} is in another block`);
      if (!CLIP_TYPES.has(c.type)) {
        out.push(`${where} is a ${c.type}, not a closed curve or region VPCLIP takes`);
      } else if (!closed(c.geom)) {
        out.push(`${where} is not closed`);
      }
      if (!(c.reactors ?? []).includes(m.handle)) {
        out.push(`${where} does not point back at it (reactors)`);
      }
      // One object clips one viewport: it follows that viewport (its reactor) and goes with it.
      for (const h of c.reactors ?? []) {
        if (h !== m.handle && clipOf(model.entityByHandle(h)) === clip) {
          out.push(`${where} clips viewport ${h} too`);
        }
      }
    }
  }
  // AutoCAD takes the viewport off the reactors of an object that no longer clips it.
  if (old !== undefined && old !== clip) {
    const c = model.entityByHandle(old);
    if (c && (c.reactors ?? []).includes(m.handle)) {
      out.push(`${what}: its old clip boundary ${old} still points at it (reactors)`);
    }
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

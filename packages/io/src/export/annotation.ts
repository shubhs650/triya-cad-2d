// TriyaToAcad for annotative entities (M1-75 part 37): an annotative object keeps one context
// data object per annotation scale in its extension dictionary's `AcDbContextDataManager`
// (`ACDB_ANNOTATIONSCALES`), each holding where the object draws at that scale. A save must keep
// them in step with the object, or AutoCAD draws a scale where the object no longer is.
//
// What AutoCAD does (AutoCAD 2024 help, "Work with Annotative Objects" and "Set Annotation Scale
// for Annotative Objects"): MOVE, ROTATE and the other edit commands change every representation
// with the object, while a grip edit moves only the current scale's ("you can use grips to move
// the current scale representation independently"); ANNORESET puts the others back at the
// current one. Triya's engine states each representation (`AnnotativeData`), so its commands
// decide which move, and the save writes TEXT representations (ACDB_TEXTOBJECTCONTEXTDATA_CLASS)
// by handle.
//
// Refused:
// - adding or removing a representation, or changing its scale or default flag (OBJECTSCALE,
//   ANNOUPDATE): annotative creation is a PRD non-goal (DEC-013), and so is a new entity that
//   comes with representations (COPY of an annotative object would add context data objects);
// - a change to the shape of an entity that has a representation Triya does not write (an
//   annotative MTEXT, dimension, block reference, hatch, leader or multiline attribute): its
//   context data would still describe the old shape;
// - a TEXT whose placement changes to one none of its representations states. AutoCAD keeps the
//   text's own 10/11/50/72 equal to the representation it draws (the current scale's; every
//   annotative TEXT of the corpus agrees with its default one), and the help does not say what
//   it does with a text that matches none, so the save does not make one (an ambiguity: the
//   drafter's expectation is that a moved text moves at least one of its scales);
// - a change of a text's plane (normal), whose context data is in its OCS.

import { TextObjectContextData, XY } from '@node-projects/acad-ts';
import type {
  AnnotationRepresentation,
  AnnotativeData,
  TextFields,
  TextRepresentation,
  Vec2,
  Vec3,
} from '@triya/engine';
import { resolve, type Resolver } from './entities';

const TWO_PI = 2 * Math.PI;
const norm = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

const reps = (a: AnnotativeData | undefined): readonly AnnotationRepresentation[] =>
  a?.representations ?? [];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: Vec2 | undefined): boolean => !!p && finite(p.x) && finite(p.y);
const samePoint = (a: Vec2 | undefined, b: Vec2 | undefined): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y);

/** What a representation is apart from its values: the context data object, scale and flag. */
const identity = (r: AnnotationRepresentation): string =>
  JSON.stringify([r.handle, r.scale ?? null, r.isDefault ?? null, r.text === undefined]);

/** A text's own placement, as a representation states it. */
function placementOf(t: TextFields): TextRepresentation {
  return {
    position: t.position,
    alignmentPoint: t.alignmentPoint ?? { x: 0, y: 0 },
    rotation: t.rotation,
    halign: t.halign,
  };
}

/** Whether representation `r` states the placement of text `t`. */
function states(r: TextRepresentation, t: TextFields): boolean {
  // Left-baseline text has no 11; its context data's (0,0 in AutoCAD's files) says nothing.
  const aligned = t.alignmentPoint !== undefined;
  return (
    samePoint(r.position, t.position) &&
    r.rotation === t.rotation &&
    r.halign === t.halign &&
    (!aligned || samePoint(r.alignmentPoint, t.alignmentPoint))
  );
}

const sameRep = (a: TextRepresentation | undefined, b: TextRepresentation | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    samePoint(a.position, b.position) &&
    samePoint(a.alignmentPoint, b.alignmentPoint) &&
    a.rotation === b.rotation &&
    a.halign === b.halign);

const samePlacement = (a: TextFields, b: TextFields): boolean =>
  sameRep(placementOf(a), placementOf(b));

const sameNormal = (a: Vec3 | undefined, b: Vec3 | undefined): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z);

/** What an annotative object is, for the checks: its representations, shape and text. */
export interface Annotated {
  readonly annotative?: AnnotativeData | undefined;
  /** Everything a representation could describe (an entity's geometry, an ATTRIB's fields). */
  readonly shape: unknown;
  /** Its text frame, for TEXT, ATTDEF and ATTRIB. */
  readonly text?: TextFields | undefined;
  readonly normal?: Vec3 | undefined;
}

/** Why the representation change from `before` (undefined: a new object) to `after` cannot be written. */
export function annotationProblems(
  r: Resolver,
  before: Annotated | undefined,
  after: Annotated,
  sameShape: (a: unknown, b: unknown) => boolean,
): string[] {
  const b = reps(before?.annotative);
  const a = reps(after.annotative);
  if (!before) {
    return a.length > 0
      ? [
          'a new annotative object (its context data objects would be new: annotative creation, DEC-013)',
        ]
      : [];
  }
  if (b.length === 0 && a.length === 0) return [];
  if (a.length !== b.length || a.some((x, i) => identity(x) !== identity(b[i]!))) {
    return [
      'annotation scale representations added, removed, reordered or given another scale or default flag (OBJECTSCALE: annotative creation, DEC-013)',
    ];
  }
  const out: string[] = [];
  const changedShape = !sameShape(before.shape, after.shape);
  if (changedShape && a.some((x) => !x.text)) {
    out.push(
      'an annotative object whose representations at other scales Triya does not write changes shape (they would keep the old one)',
    );
    return out;
  }
  a.forEach((x, i) => {
    if (!x.text || sameRep(b[i]!.text, x.text)) return;
    const t = x.text;
    if (!point(t.position) || !point(t.alignmentPoint) || !finite(t.rotation))
      out.push(`representation ${x.handle}: ${JSON.stringify(t)} is not a placement`);
    else if (!(Number.isInteger(t.halign) && t.halign >= 0 && t.halign <= 5))
      out.push(`representation ${x.handle}: horizontal alignment ${t.halign} is not 0 to 5`);
    if (!resolve(r, x.handle, TextObjectContextData))
      out.push(`representation ${x.handle} is not a text context data object of the drawing`);
  });
  if (!sameNormal(before.normal, after.normal)) {
    out.push("an annotative text's plane changes (its representations are in its OCS)");
  }
  const bt = before.text;
  const at = after.text;
  if (bt && at && !samePlacement(bt, at) && !a.some((x) => x.text && states(x.text, at))) {
    out.push(
      'the text is placed where none of its annotation scale representations is (AutoCAD keeps a text at the one it draws)',
    );
  }
  return out;
}

const ocsX = (x: number, down: boolean): number => (down ? -x + 0 : x);

/**
 * Writes the TEXT representations of `after` that differ from `before` onto their context data
 * objects, in the OCS of a text whose plane is `normal`. Callers check `annotationProblems` first.
 */
export function writeAnnotation(
  r: Resolver,
  before: AnnotativeData | undefined,
  after: AnnotativeData | undefined,
  normal: Vec3 | undefined,
): void {
  const old = new Map(reps(before).map((x) => [x.handle, x]));
  const down = normal !== undefined && normal.z < 0;
  for (const x of reps(after)) {
    const t = x.text;
    if (!t || sameRep(old.get(x.handle)?.text, t)) continue;
    const c = resolve(r, x.handle, TextObjectContextData)!;
    c.insertionPoint = new XY(ocsX(t.position.x, down), t.position.y);
    c.alignmentPoint = new XY(ocsX(t.alignmentPoint.x, down), t.alignmentPoint.y);
    c.rotation = down ? norm(Math.PI - t.rotation) : t.rotation;
    c.horizontalMode = t.halign;
  }
}

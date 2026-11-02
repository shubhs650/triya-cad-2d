// TriyaToAcad for entities (M1-05, ARCHITECTURE.md §6.1): writes a Triya entity's properties
// and geometry onto an acad-ts entity, the inverse of `map/entities.ts`. On an update only the
// fields that differ from the entity as it was mapped are written, so everything Triya does not
// model (and every unchanged value, to the bit) stays as the file had it (§6.2 rule 2).
//
// Geometry writers exist for the types markup creates and edits first and, since M1-75 parts 1
// and 2, SOLID, 3DFACE, SPLINE, POLYLINE, ATTDEF and INSERT with its ATTRIBs; the others report
// the change as unsupported (roadmap M1-75) rather than dropping it.

import type { AttributeBase, Vertex } from '@node-projects/acad-ts';
import {
  Arc,
  AttributeDefinition,
  AttributeEntity,
  BlockRecord,
  Circle,
  Color as AcadColor,
  Ellipse,
  Face3D,
  Insert,
  KnotParametrization,
  Layer,
  Line,
  LineType,
  LwPolyline,
  LwPolylineVertex,
  Material,
  MText,
  Point,
  Polyline,
  Polyline2D,
  Polyline3D,
  Ray,
  Seqend,
  SmoothSurfaceType,
  Solid,
  Spline,
  SplineFlags,
  TextColumnData,
  TextEntity,
  TextStyle,
  Transparency as AcadTransparency,
  Vertex2D,
  Vertex3D,
  VertexFlags,
  XLine,
  XY,
  XYZ,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import type {
  ArcGeometry,
  AttdefGeometry,
  AttributeFields,
  CircleGeometry,
  Color,
  EllipseGeometry,
  Entity,
  EntityGeometry,
  EntityProps,
  EntityType,
  Face3dGeometry,
  InsertAttribute,
  InsertGeometry,
  KnotParameterization,
  LineGeometry,
  LinetypeRef,
  Lineweight,
  LwPolylineGeometry,
  MTextGeometry,
  ObjectCommon,
  PointGeometry,
  PolylineGeometry,
  RayGeometry,
  SolidGeometry,
  SplineGeometry,
  TextFields,
  TextGeometry,
  Transparency,
  Vec2,
  Vec3,
  XlineGeometry,
} from '@triya/engine';
import type { PassthroughStore } from './passthrough';

const TWO_PI = 2 * Math.PI;
const norm = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/** Structural equality of plain Triya values (frozen objects, arrays, primitives). */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => v === b[i]);
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** The plan-view side an ±Z extrusion puts an entity on; anything else has no exact writer. */
type Plane = 'up' | 'down' | 'tilted';
function plane(n: Vec3 | undefined): Plane {
  if (!n) return 'up';
  if (Math.hypot(n.x, n.y) > 1e-9 * Math.hypot(n.x, n.y, n.z)) return 'tilted';
  return n.z < 0 ? 'down' : 'up';
}
const xyz = (n: Vec3 | undefined): XYZ => (n ? new XYZ(n.x, n.y, n.z) : new XYZ(0, 0, 1));
/** WCS plan-view X to OCS X: −Z mirrors X (DEC-039). Never −0, which DXF would print. */
const ocsX = (x: number, pl: Plane): number => (pl === 'down' ? -x + 0 : x);
/** WCS elevation to the OCS Z of the entity's plane. */
const ocsZ = (elevation: number | undefined, pl: Plane): number =>
  pl === 'down' ? -(elevation ?? 0) + 0 : (elevation ?? 0);

/** What a writer needs from the drawing: handles to the acad-ts objects they name. */
export interface Resolver {
  readonly store: PassthroughStore;
  /** acad-ts's own `ByLayer`/`ByBlock` linetype records of the drawing. */
  readonly byLayer: LineType;
  readonly byBlock: LineType;
  /**
   * A fresh handle for an object the save creates that the engine does not model on its own
   * (a polyline's VERTEX and SEQEND entities): above `$HANDSEED` and every handle the engine
   * handed out, so it never meets one (CLAUDE.md: handles are never renumbered).
   */
  readonly allocate: () => number;
}

function resolve<T>(
  r: Resolver,
  handle: string,
  type: abstract new (...args: never[]) => T,
): T | undefined {
  const o = r.store.original(handle);
  return o instanceof type ? o : undefined;
}

// ── Common properties ──────────────────────────────────────────────────────────────────────

function acadColor(c: Color): AcadColor {
  if (c.kind === 'byLayer') return AcadColor.byLayer;
  if (c.kind === 'byBlock') return AcadColor.byBlock;
  if (c.kind === 'aci') return new AcadColor(c.index);
  return new AcadColor(c.r, c.g, c.b);
}

function acadLineweight(w: Lineweight): number {
  if (w === 'ByLayer') return -1;
  if (w === 'ByBlock') return -2;
  if (w === 'Default') return -3;
  return w;
}

/** Triya keeps alpha 0–255; acad-ts the DXF 440 percentage (0 opaque – 90). */
function acadTransparency(t: Transparency): AcadTransparency {
  if (t === 'ByLayer') return AcadTransparency.byLayer;
  if (t === 'ByBlock') return AcadTransparency.byBlock;
  const percent = Math.round(100 - (t.alpha * 100) / 255);
  return new AcadTransparency(Math.min(90, Math.max(0, percent)));
}

function linetype(r: Resolver, ref: LinetypeRef): LineType | undefined {
  if (ref === 'ByLayer') return r.byLayer;
  if (ref === 'ByBlock') return r.byBlock;
  return resolve(r, ref, LineType);
}

const hasBook = (c: Color): boolean => c.kind === 'rgb' && c.bookName !== undefined;

/** Properties whose changes no writer handles yet. */
const UNSUPPORTED_PROPS = ['xdata', 'reactors', 'extDict', 'plotStyle', 'annotative'] as const;

/** The AcDbEntity properties of an entity, and of an ATTRIB folded into its INSERT. */
type Props = EntityProps & ObjectCommon;

/** Why the property change from `before` (undefined: a new object) to `after` cannot be written. */
function propProblems(
  r: Resolver,
  what: string,
  before: Props | undefined,
  after: Props,
): string[] {
  const out: string[] = [];
  const changed = (k: keyof Props): boolean =>
    before === undefined ? after[k] !== undefined : !same(before[k], after[k]);
  for (const k of UNSUPPORTED_PROPS) if (changed(k)) out.push(`${what}: ${k} changes`);
  if (changed('layer') && !resolve(r, after.layer, Layer)) {
    out.push(`${what}: layer ${after.layer} does not exist`);
  }
  if (changed('linetype') && !linetype(r, after.linetype)) {
    out.push(`${what}: linetype ${after.linetype} does not exist`);
  }
  if (changed('material') && after.material && !resolve(r, after.material, Material)) {
    out.push(`${what}: material ${after.material} does not exist`);
  }
  if (changed('color') && hasBook(after.color)) out.push(`${what}: colour-book colours`);
  return out;
}

/** Why the change from `before` (undefined: a new entity) to `after` cannot be written. */
export function entityProblems(r: Resolver, before: Entity | undefined, after: Entity): string[] {
  const what = `${after.type} ${after.handle}`;
  const out = propProblems(r, what, before, after);
  if (after.geom.kind === 'INSERT' && after.geom.block === after.owner) {
    out.push(`${what}: a block inserted into itself`);
  }
  if (!before || !same(before.geom, after.geom)) {
    const writer = WRITERS[after.type] as Writer<EntityGeometry> | undefined;
    if (!writer) out.push(`${what}: ${before ? 'geometry changes' : 'new entities'}`);
    else out.push(...writer.problems(r, before?.geom, after.geom).map((p) => `${what}: ${p}`));
  }
  return out;
}

/** Writes the AcDbEntity properties of `after` that differ from `before`. */
function writeProps(r: Resolver, e: AcadEntity, before: Props | undefined, after: Props): void {
  const changed = (k: keyof Props): boolean => !before || !same(before[k], after[k]);
  if (changed('layer')) e.layer = resolve(r, after.layer, Layer)!;
  if (changed('color')) {
    e.color = acadColor(after.color);
    if (e.bookColor && !hasBook(after.color)) e.bookColor = null;
  }
  if (changed('linetype')) e.lineType = linetype(r, after.linetype)!;
  if (changed('lineweight')) e.lineWeight = acadLineweight(after.lineweight);
  if (changed('transparency')) e.transparency = acadTransparency(after.transparency);
  if (changed('ltScale')) e.lineTypeScale = after.ltScale;
  if (changed('visible')) e.isInvisible = !after.visible;
  if (changed('material')) {
    e.material = after.material ? resolve(r, after.material, Material)! : null;
  }
  // AutoCAD keeps a polyline's VERTEX and SEQEND entities on the polyline's layer.
  if (changed('layer') && e instanceof Polyline) {
    for (const v of e.vertices) v.layer = e.layer;
    if (e.vertices.seqend) e.vertices.seqend.layer = e.layer;
  }
  // An INSERT's SEQEND goes with the INSERT too; its ATTRIBs have layers of their own.
  if (changed('layer') && e instanceof Insert && e.attributes.seqend) {
    e.attributes.seqend.layer = e.layer;
  }
}

// ── Geometry ───────────────────────────────────────────────────────────────────────────────

interface Writer<G extends EntityGeometry> {
  create(): AcadEntity;
  problems(r: Resolver, before: G | undefined, after: G): string[];
  /** `before` undefined writes every field. */
  write(r: Resolver, e: AcadEntity, before: G | undefined, after: G): void;
}

/** A field-change test; a new entity, or one moved to another plane, writes everything. */
function differ<G extends object>(
  before: G | undefined,
  after: G,
): (...keys: (keyof G)[]) => boolean {
  const b =
    before && same((before as { normal?: Vec3 }).normal, (after as { normal?: Vec3 }).normal)
      ? before
      : undefined;
  return (...keys) => !b || keys.some((k) => !same(b[k], after[k]));
}

const planeProblems = (g: { normal?: Vec3 }): string[] =>
  plane(g.normal) === 'tilted' ? ['a plane that is not ±Z'] : [];

const lineWriter: Writer<LineGeometry> = {
  create: () => new Line(),
  problems: () => [],
  write(_r, e, before, g) {
    const l = e as Line;
    const d = differ(before, g);
    // The mapping keeps one elevation; a line whose ends differ in Z keeps its Zs until the
    // elevation itself is edited.
    const elevation = d('elevation');
    if (d('start') || elevation) {
      l.startPoint = new XYZ(g.start.x, g.start.y, elevation ? (g.elevation ?? 0) : l.startPoint.z);
    }
    if (d('end') || elevation) {
      l.endPoint = new XYZ(g.end.x, g.end.y, elevation ? (g.elevation ?? 0) : l.endPoint.z);
    }
    if (d('thickness')) l.thickness = g.thickness ?? 0;
    if (d('normal')) l.normal = xyz(g.normal);
  },
};

function xlineWriter(kind: 'XLINE' | 'RAY'): Writer<XlineGeometry | RayGeometry> {
  return {
    create: () => (kind === 'XLINE' ? new XLine() : new Ray()),
    problems: () => [],
    write(_r, e, before, g) {
      const d = differ(before, g);
      const x = e as XLine | Ray;
      const base = x instanceof XLine ? x.firstPoint : x.startPoint;
      if (d('base')) {
        const p = new XYZ(g.base.x, g.base.y, base.z);
        if (x instanceof XLine) x.firstPoint = p;
        else x.startPoint = p;
      }
      if (d('direction')) x.direction = new XYZ(g.direction.x, g.direction.y, 0);
    },
  };
}

/** CIRCLE and ARC share these fields (acad-ts's Arc extends Circle). */
interface CircleLike {
  center: XYZ;
  radius: number;
  thickness: number;
  normal: XYZ;
}

function writeCircle<G extends CircleGeometry | ArcGeometry>(
  c: CircleLike,
  before: G | undefined,
  g: G,
): void {
  const d = differ(before, g);
  const pl = plane(g.normal);
  if (d('center', 'elevation')) {
    c.center = new XYZ(ocsX(g.center.x, pl), g.center.y, ocsZ(g.elevation, pl));
  }
  if (d('radius')) c.radius = g.radius;
  if (d('thickness')) c.thickness = g.thickness ?? 0;
  if (d('normal')) c.normal = xyz(g.normal);
}

const circleWriter: Writer<CircleGeometry> = {
  create: () => new Circle(),
  problems: (_r, _b, g) => planeProblems(g),
  write: (_r, e, before, g) => writeCircle(e as Circle, before, g),
};

const arcWriter: Writer<ArcGeometry> = {
  create: () => new Arc(),
  problems: (_r, _b, g) => planeProblems(g),
  write(_r, e, before, g) {
    const a = e as Arc;
    writeCircle(a, before, g);
    if (differ(before, g)('startAngle', 'endAngle')) {
      // Mirroring X maps θ to π − θ and reverses the sweep (map/entities.ts).
      const down = plane(g.normal) === 'down';
      a.startAngle = down ? norm(Math.PI - g.endAngle) : g.startAngle;
      a.endAngle = down ? norm(Math.PI - g.startAngle) : g.endAngle;
    }
  },
};

const ellipseWriter: Writer<EllipseGeometry> = {
  create: () => new Ellipse(),
  problems: (_r, _b, g) => planeProblems(g),
  write(_r, e, before, g) {
    const el = e as Ellipse;
    const d = differ(before, g);
    if (d('center', 'elevation')) el.center = new XYZ(g.center.x, g.center.y, g.elevation ?? 0);
    if (d('majorAxis')) el.majorAxisEndPoint = new XYZ(g.majorAxis.x, g.majorAxis.y, 0);
    if (d('ratio')) el.radiusRatio = g.ratio;
    if (d('startParam', 'endParam')) {
      const full = g.startParam === 0 && g.endParam === TWO_PI;
      // Under −Z the minor axis runs clockwise: kernel parameter t is the file's −t.
      const down = plane(g.normal) === 'down';
      el.startParameter = full ? 0 : down ? norm(-g.endParam) : g.startParam;
      el.endParameter = full ? TWO_PI : down ? norm(-g.startParam) : g.endParam;
    }
    if (d('thickness')) el.thickness = g.thickness ?? 0;
    if (d('normal')) el.normal = xyz(g.normal);
  },
};

const pointWriter: Writer<PointGeometry> = {
  create: () => new Point(),
  problems: () => [],
  write(_r, e, before, g) {
    const p = e as Point;
    const d = differ(before, g);
    if (d('position', 'elevation')) {
      p.location = new XYZ(g.position.x, g.position.y, g.elevation ?? 0);
    }
    if (d('xAxisAngle')) p.rotation = g.xAxisAngle ?? 0;
    if (d('thickness')) p.thickness = g.thickness ?? 0;
    if (d('normal')) p.normal = xyz(g.normal);
  },
};

const lwPolylineWriter: Writer<LwPolylineGeometry> = {
  create: () => new LwPolyline(),
  problems: (_r, _b, g) => planeProblems(g),
  write(_r, e, before, g) {
    const p = e as LwPolyline;
    const d = differ(before, g);
    const pl = plane(g.normal);
    if (d('vertices')) {
      // Vertices are edited in place, so what Triya does not model (vertex ids, flags) stays.
      const vs = g.vertices.map((v, i) => {
        const out = p.vertices[i] ?? new LwPolylineVertex();
        out.location = new XY(ocsX(v.x, pl), v.y);
        out.bulge = pl === 'down' ? -v.bulge + 0 : v.bulge;
        out.startWidth = v.startWidth ?? 0;
        out.endWidth = v.endWidth ?? 0;
        return out;
      });
      p.vertices = vs;
    }
    const flags = p.flags as number;
    if (d('closed')) p.flags = g.closed ? flags | 1 : flags & ~1;
    if (d('plinegen'))
      p.flags = g.plinegen ? (p.flags as number) | 128 : (p.flags as number) & ~128;
    if (d('constantWidth')) p.constantWidth = g.constantWidth ?? 0;
    if (d('elevation')) p.elevation = ocsZ(g.elevation, pl);
    if (d('thickness')) p.thickness = g.thickness ?? 0;
    if (d('normal')) p.normal = xyz(g.normal);
  },
};

const styleProblems = (r: Resolver, style: string): string[] =>
  resolve(r, style, TextStyle) ? [] : [`text style ${style} does not exist`];

const textProblems = (r: Resolver, b: TextFields | undefined, g: TextFields): string[] => [
  ...planeProblems(g),
  ...(!b || b.style !== g.style ? styleProblems(r, g.style) : []),
];

const textWriter: Writer<TextGeometry> = {
  create: () => new TextEntity(),
  problems: textProblems,
  write: (r, e, before, g) => writeTextFields(r, e as TextEntity, before, g),
};

/** The text frame TEXT, ATTDEF and ATTRIB share (the inverse of map/entities.ts `textFields`). */
function writeTextFields(
  r: Resolver,
  t: TextEntity,
  before: TextFields | undefined,
  g: TextFields,
): void {
  const d = differ(before, g);
  const pl = plane(g.normal);
  const elevation = d('elevation');
  const z = (old: number): number => (elevation ? ocsZ(g.elevation, pl) : old);
  if (d('value')) t.value = g.value;
  if (d('style')) t.style = resolve(r, g.style, TextStyle)!;
  if (d('position') || elevation) {
    t.insertPoint = new XYZ(ocsX(g.position.x, pl), g.position.y, z(t.insertPoint.z));
  }
  if ((d('alignmentPoint') || elevation) && g.alignmentPoint) {
    const a = g.alignmentPoint;
    t.alignmentPoint = new XYZ(ocsX(a.x, pl), a.y, z(t.alignmentPoint.z));
  }
  if (d('height')) t.height = g.height;
  if (d('rotation')) t.rotation = pl === 'down' ? norm(Math.PI - g.rotation) : g.rotation;
  if (d('widthFactor')) t.widthFactor = g.widthFactor;
  if (d('oblique')) t.obliqueAngle = g.oblique;
  if (d('halign')) t.horizontalAlignment = g.halign;
  if (d('valign')) t.verticalAlignment = g.valign;
  if (d('backward', 'upsideDown')) {
    // Under −Z the text's own Y flips, so the file's upside-down bit is the opposite.
    const upsideDown = g.upsideDown !== (pl === 'down');
    const other = (t.mirror as number) & ~6;
    t.mirror = other | (g.backward ? 2 : 0) | (upsideDown ? 4 : 0);
  }
  if (d('thickness')) t.thickness = g.thickness ?? 0;
  if (d('normal')) t.normal = xyz(g.normal);
}

const mtextWriter: Writer<MTextGeometry> = {
  create: () => new MText(),
  problems: (r, b, g) => [
    ...planeProblems(g),
    ...(!b || b.style !== g.style ? styleProblems(r, g.style) : []),
    // MTEXT's text runs upside down exactly when its extrusion is −Z.
    ...((g.upsideDown === true) !== (plane(g.normal) === 'down')
      ? ['upside-down MTEXT on a +Z plane']
      : []),
  ],
  write(r, e, before, g) {
    const m = e as MText;
    const d = differ(before, g);
    if (d('contents')) m.value = g.contents;
    if (d('style')) m.style = resolve(r, g.style, TextStyle)!;
    if (d('position', 'elevation')) {
      m.insertPoint = new XYZ(g.position.x, g.position.y, g.elevation ?? 0);
    }
    if (d('height')) m.height = g.height;
    if (d('width')) m.rectangleWidth = g.width;
    if (d('definedHeight')) m.rectangleHeight = g.definedHeight ?? 0;
    if (d('rotation')) m.rotation = g.rotation;
    if (d('attachment')) m.attachmentPoint = g.attachment;
    if (d('direction')) m.drawingDirection = g.direction;
    if (d('lineSpacingStyle')) m.lineSpacingStyle = g.lineSpacingStyle;
    if (d('lineSpacing')) m.lineSpacing = g.lineSpacing;
    if (d('background')) {
      const bg = g.background;
      m.backgroundFillFlags = bg?.flags ?? 0;
      if (bg) {
        m.backgroundColor = bg.color ? acadColor(bg.color) : null;
        m.backgroundScale = bg.scale;
        m.backgroundTransparency = bg.transparency ?? 0;
      }
    }
    if (d('columns')) {
      const c = g.columns;
      const data = new TextColumnData();
      if (c) {
        data.columnType = c.type;
        data.columnCount = c.count;
        data.flowReversed = c.flowReversed;
        data.autoHeight = c.autoHeight;
        data.width = c.width;
        data.gutter = c.gutter;
        data.heights = [...c.heights];
      }
      m.columnData = data;
    }
    if (d('normal')) m.normal = xyz(g.normal);
  },
};

// ── SOLID, 3DFACE ──────────────────────────────────────────────────────────────────────────

type Corners = readonly [Vec2, Vec2, Vec2, Vec2];

const solidWriter: Writer<SolidGeometry> = {
  create: () => new Solid(),
  problems: (_r, _b, g) => planeProblems(g),
  write(_r, e, before, g) {
    const s = e as Solid;
    const d = differ(before, g);
    const pl = plane(g.normal);
    // The mapping keeps the first corner's elevation (all four share one OCS Z in AutoCAD's
    // files); a corner keeps its own Z until the elevation itself is edited, as LINE does.
    const elevation = d('elevation');
    if (d('corners') || elevation) {
      const z = (old: XYZ): number => (elevation ? ocsZ(g.elevation, pl) : old.z);
      const c = (p: Vec2, old: XYZ): XYZ => new XYZ(ocsX(p.x, pl), p.y, z(old));
      s.firstCorner = c(g.corners[0], s.firstCorner);
      s.secondCorner = c(g.corners[1], s.secondCorner);
      s.thirdCorner = c(g.corners[2], s.thirdCorner);
      s.fourthCorner = c(g.corners[3], s.fourthCorner);
    }
    if (d('thickness')) s.thickness = g.thickness ?? 0;
    if (d('normal')) s.normal = xyz(g.normal);
  },
};

const face3dWriter: Writer<Face3dGeometry> = {
  create: () => new Face3D(),
  problems: () => [],
  write(_r, e, before, g) {
    const f = e as Face3D;
    const d = differ(before, g);
    // A 3DFACE is mapped as its plan view: each corner keeps its WCS Z (0 on a new face).
    if (d('corners')) {
      const c = (p: Vec2, old: XYZ): XYZ => new XYZ(p.x, p.y, old.z);
      const cs: Corners = g.corners;
      f.firstCorner = c(cs[0], f.firstCorner);
      f.secondCorner = c(cs[1], f.secondCorner);
      f.thirdCorner = c(cs[2], f.thirdCorner);
      f.fourthCorner = c(cs[3], f.fourthCorner);
    }
    if (d('hiddenEdges')) f.flags = g.hiddenEdges;
  },
};

// ── SPLINE ─────────────────────────────────────────────────────────────────────────────────

/**
 * Plan-view points written back over WCS points: a point keeps the Z of the one it replaces;
 * an added one takes the last point's Z (a planar spline stays planar), or 0 on a new entity.
 */
function withZ(points: readonly Vec2[], old: readonly XYZ[]): XYZ[] {
  const last = old.length > 0 ? old[old.length - 1]!.z : 0;
  return points.map((p, i) => new XYZ(p.x, p.y, old[i]?.z ?? last));
}

const KNOT_PARAMETERIZATION: Record<KnotParameterization, KnotParametrization> = {
  chord: KnotParametrization.Chord,
  sqrt: KnotParametrization.SquareRoot,
  uniform: KnotParametrization.Uniform,
};

const splineWriter: Writer<SplineGeometry> = {
  create: () => {
    const s = new Spline();
    // AutoCAD flags every spline it draws in a plane as planar (DXF 70 bit 8).
    s.flags = SplineFlags.Planar;
    return s;
  },
  problems(_r, before, g) {
    const out: string[] = [];
    const counts = (s: SplineGeometry): unknown[] => [
      s.degree,
      s.knots.length,
      s.controlPoints.length,
      s.weights?.length,
    ];
    // A knot vector that does not fit the control points would write a SPLINE AutoCAD cannot
    // read. Checked only when the counts change, so a file's own odd spline still saves.
    if (!before || !same(counts(before), counts(g))) {
      if (g.controlPoints.length > 0 && g.knots.length !== g.controlPoints.length + g.degree + 1) {
        out.push(
          `${g.knots.length} knots for ${g.controlPoints.length} control points of degree ${g.degree}`,
        );
      }
      if (g.weights && g.weights.length !== g.controlPoints.length) {
        out.push(`${g.weights.length} weights for ${g.controlPoints.length} control points`);
      }
    }
    return out;
  },
  write(_r, e, before, g) {
    const s = e as Spline;
    // Splines are mapped in WCS whatever their normal (map/entities.ts), so the normal is only
    // carried; a spline with no normal stated keeps the file's (+Z or the zero vector).
    const d = differ(before, g);
    if (d('degree')) s.degree = g.degree;
    if (d('knots')) s.knots = [...g.knots];
    if (d('controlPoints')) s.controlPoints = withZ(g.controlPoints, s.controlPoints);
    const n = s.controlPoints.length;
    // Weights all 1 map as no weights, so the file's list only changes with the edit's, or
    // when it no longer fits the control points.
    if (d('weights') || (!g.weights && s.weights.length > 0 && s.weights.length !== n)) {
      s.weights = g.weights ? [...g.weights] : [];
      const flags = s.flags as number;
      s.flags = g.weights ? flags | SplineFlags.Rational : flags & ~SplineFlags.Rational;
    }
    if (d('fitPoints')) s.fitPoints = withZ(g.fitPoints ?? [], s.fitPoints);
    const tangent = (t: Vec2 | undefined, old: XYZ): XYZ =>
      t ? new XYZ(t.x, t.y, old.z) : new XYZ(0, 0, 0);
    if (d('startTangent')) s.startTangent = tangent(g.startTangent, s.startTangent);
    if (d('endTangent')) s.endTangent = tangent(g.endTangent, s.endTangent);
    if (d('knotParameterization')) {
      const kp = g.knotParameterization;
      const old = s.knotParametrization as number;
      // Chord and custom both map as no parameterization; a custom one stays custom.
      s.knotParametrization = kp
        ? KNOT_PARAMETERIZATION[kp]
        : old === KnotParametrization.Custom
          ? KnotParametrization.Custom
          : KnotParametrization.Chord;
    }
    if (d('closed')) s.isClosed = g.closed;
    if (d('periodic')) s.isPeriodic = g.periodic;
    if (d('normal') && (before || g.normal)) s.normal = xyz(g.normal);
  },
};

// ── POLYLINE ───────────────────────────────────────────────────────────────────────────────

const FIT_TYPES = {
  quadratic: SmoothSurfaceType.Quadratic,
  cubic: SmoothSurfaceType.Cubic,
  bezier: SmoothSurfaceType.BezierSurface,
} as const;

/** DXF 70 bits the polyline writer owns: closed, curve fit, spline fit, PLINEGEN. */
const POLYLINE_FLAGS = 1 | 2 | 4 | 128;

const polylineWriter: Writer<PolylineGeometry> = {
  create: () => new Polyline2D(),
  problems(_r, before, g) {
    const out = g.is3d ? [] : planeProblems(g);
    // A 2D and a 3D polyline are different objects (POLYLINE_2D / POLYLINE_3D in DWG).
    if (before && before.is3d !== g.is3d) out.push('a change between 2D and 3D');
    if (g.is3d && g.vertices.some((v) => v.bulge !== 0)) out.push('bulges on a 3D polyline');
    if (g.is3d && (g.elevation !== undefined || g.thickness !== undefined || g.normal)) {
      out.push('elevation, thickness or a normal on a 3D polyline');
    }
    return out;
  },
  write(r, e, before, g) {
    const p = e as Polyline;
    const d = differ(before, g);
    const pl = g.is3d ? 'up' : plane(g.normal);
    if (d('vertices', 'frame', 'fit', 'elevation')) writeVertices(r, p, g, pl, d('elevation'));
    // Bit 8 (3D) stays as read: is3d cannot change (above), and acad-ts sets it for Polyline3D.
    let flags = (p.flags as number) & ~POLYLINE_FLAGS;
    if (g.closed) flags |= 1;
    if (g.fit === 'curve') flags |= 2;
    else if (g.fit) flags |= 4;
    if (g.plinegen) flags |= 128;
    if (d('closed', 'fit', 'plinegen')) p.flags = flags;
    if (d('fit')) {
      p.smoothSurface = g.fit && g.fit !== 'curve' ? FIT_TYPES[g.fit] : SmoothSurfaceType.NoSmooth;
    }
    if (d('startWidth')) p.startWidth = g.startWidth ?? 0;
    if (d('endWidth')) p.endWidth = g.endWidth ?? 0;
    if (d('elevation') && !g.is3d) p.elevation = ocsZ(g.elevation, pl);
    if (d('thickness')) p.thickness = g.thickness ?? 0;
    if (d('normal') && !g.is3d) p.normal = xyz(g.normal);
  },
};

/**
 * Writes the drawn vertices and the spline frame (VERTEX flag 16) onto the polyline's own
 * VERTEX entities, the i-th of each kind in place, so a vertex keeps its handle and all Triya
 * does not model (its flags, tangent, id). Vertices a polyline gains are new VERTEX entities
 * under fresh handles (`Resolver.allocate`); a polyline that loses some just drops them.
 */
function writeVertices(
  r: Resolver,
  p: Polyline,
  g: PolylineGeometry,
  pl: Plane,
  elevationChanged: boolean,
): void {
  const old = [...p.vertices] as Vertex[];
  const isFrame = (v: Vertex): boolean =>
    ((v.flags as number) & VertexFlags.SplineFrameControlPoint) !== 0;
  const oldDrawn = old.filter((v) => !isFrame(v));
  const oldFrame = old.filter(isFrame);
  const base = g.is3d ? VertexFlags.PolylineVertex3D : 0;
  const lastZ = old.length > 0 ? old[old.length - 1]!.location.z : 0;
  // A 2D vertex's Z is the OCS elevation (AutoCAD writes it there too); a 3D one keeps its WCS
  // Z, and one added takes the last vertex's.
  const z = (v: Vertex | undefined): number =>
    g.is3d
      ? (v?.location.z ?? lastZ)
      : elevationChanged || !v
        ? ocsZ(g.elevation, pl)
        : v.location.z;
  const vertex = (v: Vertex | undefined, flags: number): Vertex => {
    if (v) return v;
    const out = g.is3d ? new Vertex3D() : new Vertex2D();
    out.handle = r.allocate();
    out.flags = flags;
    out.layer = p.layer;
    return out;
  };
  const drawnFlags =
    base | (g.fit && g.fit !== 'curve' ? VertexFlags.SplineVertexFromSplineFitting : 0);
  const drawn = g.vertices.map((src, i) => {
    const v = vertex(oldDrawn[i], drawnFlags);
    v.location = new XYZ(g.is3d ? src.x : ocsX(src.x, pl), src.y, z(oldDrawn[i]));
    v.bulge = g.is3d || pl !== 'down' ? src.bulge : -src.bulge + 0;
    v.startWidth = src.startWidth ?? 0;
    v.endWidth = src.endWidth ?? 0;
    return v;
  });
  const frame = (g.frame ?? []).map((src, i) => {
    const v = vertex(oldFrame[i], base | VertexFlags.SplineFrameControlPoint);
    v.location = new XYZ(g.is3d ? src.x : ocsX(src.x, pl), src.y, z(oldFrame[i]));
    return v;
  });
  const sameCounts = drawn.length === oldDrawn.length && frame.length === oldFrame.length;
  // Same counts keep the file's interleaving; otherwise frame first, as AutoCAD writes it.
  const next = sameCounts ? old : [...frame, ...drawn];
  const seqend = p.vertices.seqend;
  p.vertices.length = 0;
  p.vertices.push(...next);
  if (p.document) for (const v of next) if (v.document == null) v.assignDocument(p.document);
  if (!seqend) {
    const s = new Seqend(p);
    s.handle = r.allocate();
    s.layer = p.layer;
    p.vertices.seqend = s;
    if (p.document) s.assignDocument(p.document);
  }
  for (const v of next) v.owner = p;
}

// ── ATTDEF, INSERT and its ATTRIBs ─────────────────────────────────────────────────────────

/**
 * What an ATTDEF and an ATTRIB have beyond their text frame. A multiline attribute's embedded
 * MTEXT is edited in place; making a single-line attribute multiline or back is refused, because
 * DXF before R2018 keeps that text in an extension-dictionary XRECORD Triya does not write.
 */
function attributeProblems(
  r: Resolver,
  before: AttributeFields | undefined,
  g: AttributeFields,
): string[] {
  const out = textProblems(r, before, g);
  if ((before?.mtext !== undefined) !== (g.mtext !== undefined)) {
    out.push(
      g.mtext ? 'a single-line attribute made multiline' : 'a multiline attribute made single-line',
    );
  } else if (before?.mtext && g.mtext) {
    out.push(...mtextWriter.problems(r, before.mtext, g.mtext));
  }
  return out;
}

function writeAttributeFields(
  r: Resolver,
  a: AttributeBase,
  before: AttributeFields | undefined,
  g: AttributeFields,
): void {
  writeTextFields(r, a, before, g);
  const d = differ(before, g);
  if (d('tag')) a.tag = g.tag;
  if (d('flags')) a.flags = g.flags;
  if (d('lockPosition')) a.isReallyLocked = g.lockPosition === true;
  if (before?.mtext && g.mtext && a.mText && !same(before.mtext, g.mtext)) {
    mtextWriter.write(r, a.mText, before.mtext, g.mtext);
  }
}

const attdefWriter: Writer<AttdefGeometry> = {
  create: () => new AttributeDefinition(),
  problems: attributeProblems,
  write(r, e, before, g) {
    const a = e as AttributeDefinition;
    writeAttributeFields(r, a, before, g);
    if (differ(before, g)('prompt')) a.prompt = g.prompt;
  },
};

/** A block an INSERT may name: not a layout's own block (`*Model_Space`, `*Paper_Space…`). */
function insertable(r: Resolver, handle: string): BlockRecord | undefined {
  const b = resolve(r, handle, BlockRecord);
  return b && !/^\*(model|paper)_space/i.test(b.name) ? b : undefined;
}

const insertWriter: Writer<InsertGeometry> = {
  create: () => new Insert(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if ((!before || before.block !== g.block) && !insertable(r, g.block)) {
      out.push(`block ${g.block} cannot be inserted`);
    }
    const old = new Map((before?.attributes ?? []).map((a) => [a.handle, a]));
    const seen = new Set<string>();
    for (const a of g.attributes) {
      const what = `ATTRIB ${a.handle}`;
      const b = old.get(a.handle);
      if (seen.has(a.handle)) out.push(`${what}: listed twice`);
      seen.add(a.handle);
      // An ATTRIB the INSERT gains keeps the handle the engine gave it, which must be free:
      // one held by another object (another INSERT's ATTRIB, say) would be renumbered or lost.
      if (!b && (!/^[0-9A-F]+$/.test(a.handle) || r.store.original(a.handle))) {
        out.push(`${what}: the handle is already used`);
      }
      out.push(...propProblems(r, what, b, a));
      if (!b || !same(b, a)) {
        out.push(...attributeProblems(r, b, a).map((p) => `${what}: ${p}`));
      }
    }
    return out;
  },
  write(r, e, before, g) {
    const ins = e as Insert;
    const d = differ(before, g);
    const pl = plane(g.normal);
    const down = pl === 'down';
    if (d('block')) ins.block = insertable(r, g.block)!;
    if (d('position', 'elevation')) {
      ins.insertPoint = new XYZ(ocsX(g.position.x, pl), g.position.y, ocsZ(g.elevation, pl));
    }
    // −Z folds into the placement as rotation −θ and scale (−sx, sy, −sz) (map/entities.ts).
    if (d('scale')) {
      ins.xScale = down ? -g.scale.x + 0 : g.scale.x;
      ins.yScale = g.scale.y;
      ins.zScale = down ? -g.scale.z + 0 : g.scale.z;
    }
    if (d('rotation')) ins.rotation = down ? norm(-g.rotation) : g.rotation;
    if (d('array')) {
      const a = g.array;
      ins.columnCount = a?.columns ?? 1;
      ins.rowCount = a?.rows ?? 1;
      // Columns run along the rotated X axis, which the mirror reverses.
      ins.columnSpacing = a ? (down ? -a.columnSpacing + 0 : a.columnSpacing) : 0;
      ins.rowSpacing = a?.rowSpacing ?? 0;
    }
    if (d('normal')) ins.normal = xyz(g.normal);
    if (!before || !same(before.attributes, g.attributes)) {
      writeAttributes(r, ins, before?.attributes ?? [], g.attributes);
    }
  },
};

/**
 * Writes the ATTRIBs onto the INSERT's own, by handle, so an ATTRIB keeps everything Triya does
 * not model; one the INSERT gains is created under its engine handle, and one it loses is
 * dropped. The SEQEND that ends them keeps its handle, is created under a fresh one
 * (`Resolver.allocate`) when the first ATTRIB arrives, and goes with the last, as AutoCAD writes
 * an INSERT without attributes (DXF 66 = 0, no SEQEND).
 */
function writeAttributes(
  r: Resolver,
  ins: Insert,
  before: readonly InsertAttribute[],
  after: readonly InsertAttribute[],
): void {
  const old = new Map(before.map((a) => [a.handle, a]));
  const acad = new Map<string, AttributeEntity>();
  for (const a of ins.attributes) acad.set(a.handle.toString(16).toUpperCase(), a);
  const written = after.map((g) => {
    const kept = old.has(g.handle) ? acad.get(g.handle) : undefined;
    const a = kept ?? new AttributeEntity();
    if (!kept) a.handle = Number.parseInt(g.handle, 16);
    const b = kept ? old.get(g.handle) : undefined;
    writeProps(r, a, b, g);
    writeAttributeFields(r, a, b, g);
    return a;
  });
  // An ATTRIB Triya could not map (a tilted one) stays in its slot, untouched (§6.2 rule 4).
  const next: AttributeEntity[] = [];
  for (const a of ins.attributes) {
    if (!old.has(a.handle.toString(16).toUpperCase())) next.push(a);
    else if (written.length > 0) next.push(written.shift()!);
  }
  next.push(...written);
  ins.attributes.length = 0;
  ins.attributes.push(...next);
  for (const a of next) {
    a.owner = ins;
    if (ins.document && a.document == null) a.assignDocument(ins.document);
  }
  if (next.length === 0) {
    ins.attributes.seqend = null;
  } else if (!ins.attributes.seqend) {
    const s = new Seqend(ins);
    s.handle = r.allocate();
    s.layer = ins.layer;
    ins.attributes.seqend = s;
    if (ins.document) s.assignDocument(ins.document);
  }
}

const WRITERS: Partial<Record<EntityType, Writer<never>>> = {
  LINE: lineWriter,
  XLINE: xlineWriter('XLINE'),
  RAY: xlineWriter('RAY'),
  CIRCLE: circleWriter,
  ARC: arcWriter,
  ELLIPSE: ellipseWriter,
  POINT: pointWriter,
  LWPOLYLINE: lwPolylineWriter,
  TEXT: textWriter,
  MTEXT: mtextWriter,
  SOLID: solidWriter,
  '3DFACE': face3dWriter,
  SPLINE: splineWriter,
  POLYLINE: polylineWriter,
  ATTDEF: attdefWriter,
  INSERT: insertWriter,
} as Partial<Record<EntityType, Writer<never>>>;

/** The entity types whose geometry Triya can write (the rest: roadmap M1-75). */
export const WRITABLE_TYPES: readonly EntityType[] = Object.keys(WRITERS) as EntityType[];

/** A new acad-ts entity for `geom`, or undefined when no writer exists. */
export function createAcadEntity(geom: EntityGeometry): AcadEntity | undefined {
  // A 3D polyline is its own acad-ts class (POLYLINE_3D in DWG), which `create` cannot pick.
  if (geom.kind === 'POLYLINE' && geom.is3d) return new Polyline3D();
  return WRITERS[geom.kind]?.create();
}

/**
 * Writes `after` onto `e`: every field when `before` is undefined, otherwise only what differs
 * from `before`. Callers check `entityProblems` first.
 */
export function writeEntity(
  r: Resolver,
  e: AcadEntity,
  before: Entity | undefined,
  after: Entity,
): void {
  writeProps(r, e, before, after);
  if (before && same(before.geom, after.geom)) return;
  const writer = WRITERS[after.type] as Writer<EntityGeometry> | undefined;
  writer!.write(r, e, before?.geom, after.geom);
}

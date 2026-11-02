// TriyaToAcad for entities (M1-05, ARCHITECTURE.md §6.1): writes a Triya entity's properties
// and geometry onto an acad-ts entity, the inverse of `map/entities.ts`. On an update only the
// fields that differ from the entity as it was mapped are written, so everything Triya does not
// model (and every unchanged value, to the bit) stays as the file had it (§6.2 rule 2).
//
// Geometry writers exist for the types markup creates and edits first; the others report the
// change as unsupported (roadmap M1-75) rather than dropping it.

import {
  Arc,
  Circle,
  Color as AcadColor,
  Ellipse,
  Layer,
  Line,
  LineType,
  LwPolyline,
  LwPolylineVertex,
  Material,
  MText,
  Point,
  Ray,
  TextColumnData,
  TextEntity,
  TextStyle,
  Transparency as AcadTransparency,
  XLine,
  XY,
  XYZ,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import type {
  ArcGeometry,
  CircleGeometry,
  Color,
  EllipseGeometry,
  Entity,
  EntityGeometry,
  EntityType,
  LineGeometry,
  LinetypeRef,
  Lineweight,
  LwPolylineGeometry,
  MTextGeometry,
  PointGeometry,
  RayGeometry,
  TextGeometry,
  Transparency,
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

/** Why the change from `before` (undefined: a new entity) to `after` cannot be written. */
export function entityProblems(r: Resolver, before: Entity | undefined, after: Entity): string[] {
  const out: string[] = [];
  const what = `${after.type} ${after.handle}`;
  const changed = (k: keyof Entity): boolean =>
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
  if (!before || !same(before.geom, after.geom)) {
    const writer = WRITERS[after.type] as Writer<EntityGeometry> | undefined;
    if (!writer) out.push(`${what}: ${before ? 'geometry changes' : 'new entities'}`);
    else out.push(...writer.problems(r, before?.geom, after.geom).map((p) => `${what}: ${p}`));
  }
  return out;
}

/** Writes the AcDbEntity properties of `after` that differ from `before`. */
function writeProps(r: Resolver, e: AcadEntity, before: Entity | undefined, after: Entity): void {
  const changed = (k: keyof Entity): boolean => !before || !same(before[k], after[k]);
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

const textWriter: Writer<TextGeometry> = {
  create: () => new TextEntity(),
  problems: (r, b, g) => [
    ...planeProblems(g),
    ...(!b || b.style !== g.style ? styleProblems(r, g.style) : []),
  ],
  write(r, e, before, g) {
    const t = e as TextEntity;
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
  },
};

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
} as Partial<Record<EntityType, Writer<never>>>;

/** The entity types whose geometry Triya can write (the rest: roadmap M1-75). */
export const WRITABLE_TYPES: readonly EntityType[] = Object.keys(WRITERS) as EntityType[];

/** A new acad-ts entity for `type`, or undefined when no writer exists. */
export function createAcadEntity(type: EntityType): AcadEntity | undefined {
  return WRITERS[type]?.create();
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

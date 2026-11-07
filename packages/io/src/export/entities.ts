// TriyaToAcad for entities (M1-05, ARCHITECTURE.md §6.1): writes a Triya entity's properties
// and geometry onto an acad-ts entity, the inverse of `map/entities.ts`. On an update only the
// fields that differ from the entity as it was mapped are written, so everything Triya does not
// model (and every unchanged value, to the bit) stays as the file had it (§6.2 rule 2).
//
// Geometry writers exist for the types markup creates and edits first and, since M1-75 parts 1
// to 5, SOLID, TRACE, 3DFACE, SPLINE, POLYLINE, ATTDEF, INSERT with its ATTRIBs, every
// dimension, LEADER, TOLERANCE, HATCH, IMAGE, WIPEOUT, PDFUNDERLAY, MLINE, MULTILEADER and
// VIEWPORT; the others report the change as unsupported (roadmap M1-75) rather than dropping it.

import type {
  AttributeBase,
  CadWipeoutBase,
  HatchBoundaryPathEdge,
  Vertex,
} from '@node-projects/acad-ts';
import {
  ACadVersion,
  EntityPlotStyleType,
  Arc,
  AttributeDefinition,
  CadObject,
  AttributeEntity,
  BlockRecord,
  CadValueType,
  CellContent,
  CellType,
  Circle,
  ClipMode,
  ClipType,
  Color as AcadColor,
  DimensionAligned,
  DimensionAngular2Line,
  DimensionAngular3Pt,
  DimensionArc,
  DimensionDiameter,
  DimensionLinear,
  DimensionOrdinate,
  DimensionRadialLarge,
  DimensionRadius,
  DimensionStyle,
  Ellipse,
  Entity as AcadEntity,
  Face3D,
  GradientColor,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathArc,
  HatchBoundaryPathEllipse,
  HatchBoundaryPathLine,
  HatchBoundaryPathPolyline,
  HatchBoundaryPathSpline,
  HatchPatternLine,
  HookLineDirection,
  ImageDefinition,
  Insert,
  KnotParametrization,
  Layer,
  Leader,
  LeaderLine,
  LeaderPathType,
  LeaderRoot,
  Line,
  LineType,
  LwPolyline,
  LwPolylineVertex,
  Material,
  MLine,
  MLineSegment,
  MLineStyle,
  MLineVertex,
  MText,
  MultiLeader,
  MultiLeaderStyle,
  PdfUnderlay,
  PdfUnderlayDefinition,
  Point,
  Polyline,
  Polyline2D,
  Polyline3D,
  RasterImage,
  Ray,
  Seqend,
  SmoothSurfaceType,
  Solid,
  Spline,
  SplineFlags,
  TableCellContentType,
  TableCellStateFlags,
  TableEntity,
  TableStyle,
  TextColumnData,
  TextEntity,
  TextStyle,
  Tolerance,
  Transparency as AcadTransparency,
  Vertex2D,
  Vertex3D,
  VertexFlags,
  Viewport,
  VisualStyle,
  Wipeout,
  XLine,
  XY,
  XYZ,
  type Dimension,
} from '@node-projects/acad-ts';
import type {
  ArcGeometry,
  AttdefGeometry,
  AttributeFields,
  CircleGeometry,
  Color,
  DimensionGeometry,
  EllipseGeometry,
  Entity,
  EntityGeometry,
  EntityProps,
  EntityType,
  Face3dGeometry,
  Handle,
  HatchEdge,
  HatchGeometry,
  HatchLoop,
  ImageGeometry,
  InsertAttribute,
  InsertGeometry,
  KnotParameterization,
  LeaderGeometry,
  LineGeometry,
  LinetypeRef,
  Lineweight,
  LwPolylineGeometry,
  MLineGeometry,
  MTextGeometry,
  MultiLeaderBlock,
  MultiLeaderGeometry,
  MultiLeaderText,
  ObjectCommon,
  PointGeometry,
  PolylineGeometry,
  RayGeometry,
  SolidGeometry,
  SplineGeometry,
  TableCell,
  TableGeometry,
  TextFields,
  TextGeometry,
  ToleranceGeometry,
  Transparency,
  UnderlayGeometry,
  Vec2,
  Vec3,
  ViewportGeometry,
  XlineGeometry,
} from '@triya/engine';
import type { CadFormat } from '../read';
import type { PassthroughStore } from './passthrough';
import {
  formatFileProblems,
  formatValueProblems,
  mergeProblems,
  mergesChange,
  writeCellFormat,
  writeMerges,
} from './table-cells';
import { buildGrid, newTableProblems, writeTableOverrides } from './table-new';
import {
  alignedBefore,
  formatsBefore,
  originProblems,
  regrid,
  regridded,
  regridProblems,
} from './table-grid';
import { writeXdata, xdataProblems } from './xdata';

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
  /** Table records the save adds (new layers), by handle, before they join the drawing. */
  readonly created: ReadonlyMap<Handle, CadObject>;
  /** The version the drawing is saved in (its own). */
  readonly version?: ACadVersion | undefined;
  /**
   * What an entity may name as its plot style: why none (a colour-dependent drawing, or one before
   * R2000), or the ACAD_PLOTSTYLENAME entries and default.
   */
  readonly plotStyles?: PlotStyleNames;
}

/** The plot style names entities may name in a drawing (`plotStyleNames` in export.ts). */
export type PlotStyleNames =
  | { readonly refusal: string }
  | { readonly names: ReadonlySet<Handle>; readonly refusal?: undefined };

/** The drawing's object `handle` (or one the save adds) when it is a `type`. */
export function resolve<T>(
  r: Resolver,
  handle: string,
  type: abstract new (...args: never[]) => T,
): T | undefined {
  const o = r.store.original(handle) ?? r.created.get(handle);
  return o instanceof type ? o : undefined;
}

// ── Common properties ──────────────────────────────────────────────────────────────────────

export function acadColor(c: Color): AcadColor {
  if (c.kind === 'byLayer') return AcadColor.byLayer;
  if (c.kind === 'byBlock') return AcadColor.byBlock;
  if (c.kind === 'aci') return new AcadColor(c.index);
  return new AcadColor(c.r, c.g, c.b);
}

export function acadLineweight(w: Lineweight): number {
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

/**
 * Properties whose changes no writer handles yet. Xdata (xdata.ts, M1-75 part 19), plot style
 * names and materials (part 21) are written, on entities and ATTRIBs alike.
 */
const UNSUPPORTED_PROPS = ['reactors', 'extDict', 'annotative'] as const;
/**
 * An entity's reactors are written: the only changes accepted are those that keep a LEADER and
 * its annotation, an associative HATCH and its boundary objects, or a VIEWPORT and its clip
 * boundary, pointing at each other
 * (`reactorProblems` in reactors.ts checks them).
 * An ATTRIB's are not.
 */
const UNSUPPORTED_ENTITY_PROPS = UNSUPPORTED_PROPS.filter((k) => k !== 'reactors');

/** The AcDbEntity properties of an entity, and of an ATTRIB folded into its INSERT. */
type Props = EntityProps & ObjectCommon;

/** Why the property change from `before` (undefined: a new object) to `after` cannot be written. */
function propProblems(
  r: Resolver,
  what: string,
  before: Props | undefined,
  after: Props,
  unsupported: readonly (keyof Props)[] = UNSUPPORTED_PROPS,
): string[] {
  const out: string[] = [];
  const changed = (k: keyof Props): boolean =>
    before === undefined ? after[k] !== undefined : !same(before[k], after[k]);
  for (const k of unsupported) if (changed(k)) out.push(`${what}: ${k} changes`);
  if (changed('layer') && !resolve(r, after.layer, Layer)) {
    out.push(`${what}: layer ${after.layer} does not exist`);
  }
  if (changed('linetype') && !linetype(r, after.linetype)) {
    out.push(`${what}: linetype ${after.linetype} does not exist`);
  }
  if (changed('material') && after.material) {
    // AutoCAD 2007 introduced materials; acad-ts writes an entity's from R2007 (DXF 347, DWG).
    if (r.version !== undefined && r.version < ACadVersion.AC1021) {
      out.push(`${what}: ${ACadVersion[r.version]} has no materials (R2007 added them)`);
    } else if (!resolve(r, after.material, Material)) {
      out.push(`${what}: material ${after.material} does not exist`);
    }
  }
  if (changed('plotStyle') && after.plotStyle) {
    // Named plot styles (AutoCAD 2000): an entity names one only in a named-plot-style drawing;
    // a colour-dependent one plots by colour and shows no Plot style property to set.
    const styles = r.plotStyles;
    if (styles?.refusal !== undefined) out.push(`${what}: ${styles.refusal}`);
    else if (styles && !styles.names.has(after.plotStyle)) {
      out.push(`${what}: plot style ${after.plotStyle} is not in ACAD_PLOTSTYLENAME`);
    }
  }
  if (changed('color') && hasBook(after.color)) out.push(`${what}: colour-book colours`);
  if (changed('xdata')) {
    out.push(...xdataProblems(r, before?.xdata, after.xdata).map((p) => `${what}: ${p}`));
  }
  return out;
}

/** Why the change from `before` (undefined: a new entity) to `after` cannot be written. */
export function entityProblems(r: Resolver, before: Entity | undefined, after: Entity): string[] {
  const what = `${after.type} ${after.handle}`;
  const out = propProblems(r, what, before, after, UNSUPPORTED_ENTITY_PROPS);
  if (after.geom.kind === 'INSERT' && after.geom.block === after.owner) {
    out.push(`${what}: a block inserted into itself`);
  }
  // AutoCAD shows a viewport only in a layout's paper space.
  if (after.geom.kind === 'VIEWPORT' && (!before || before.owner !== after.owner)) {
    const block = resolve(r, after.owner, BlockRecord);
    if (!block?.layout || block.name.toUpperCase() === BlockRecord.modelSpaceName.toUpperCase()) {
      out.push(`${what}: a viewport outside a layout's paper space`);
    }
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
  if (changed('plotStyle')) {
    // Taking a name off plots the entity ByLayer, as the Properties palette's ByLayer does.
    e.plotStyleType = after.plotStyle
      ? EntityPlotStyleType.ByObjectId
      : EntityPlotStyleType.ByLayer;
    e.plotStyleName = after.plotStyle ? Number.parseInt(after.plotStyle, 16) : 0;
  }
  if (changed('xdata') && !same(before?.xdata ?? [], after.xdata ?? [])) {
    writeXdata(r, e, before?.xdata, after.xdata);
  }
  if (changed('reactors') && !same(before?.reactors ?? [], after.reactors ?? [])) {
    // In the model's order; each names an object of the drawing or an entity the save adds.
    e.reactors.length = 0;
    for (const h of after.reactors ?? []) e.addReactor(resolve(r, h, CadObject)!);
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

// A TRACE has a SOLID's data (DXF reference, TRACE); only its type tells them apart.
const traceWriter: Writer<SolidGeometry> = {
  ...solidWriter,
  create: () => Object.assign(new Solid(), { isTrace: true }),
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

// ── DIMENSION, ARC_DIMENSION, LARGE_RADIAL_DIMENSION ───────────────────────────────────────

type DimType = DimensionGeometry['dimType'];

/** Each dimension type is its own acad-ts class (and DWG object), so the type cannot change. */
const DIMENSION_CLASSES: Record<DimType, () => Dimension> = {
  linear: () => new DimensionLinear(),
  aligned: () => new DimensionAligned(),
  angular: () => new DimensionAngular2Line(),
  angular3pt: () => new DimensionAngular3Pt(),
  radius: () => new DimensionRadius(),
  diameter: () => new DimensionDiameter(),
  ordinate: () => new DimensionOrdinate(),
  jogged: () => new DimensionRadialLarge(),
  arc: () => new DimensionArc(),
};

const dimStyleProblems = (r: Resolver, style: string): string[] =>
  resolve(r, style, DimensionStyle) ? [] : [`dimension style ${style} does not exist`];

/** An OCS angle (DXF 50–53) under −Z is the WCS angle π − θ, and back (map/entities.ts). */
const ocsAngle = (a: number, pl: Plane): number => (pl === 'down' ? norm(Math.PI - a) : a);

const dimensionWriter: Writer<DimensionGeometry> = {
  // `createAcadEntity` picks the class by type; this is only the fallback the table needs.
  create: () => new DimensionLinear(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if (before && before.dimType !== g.dimType) {
      out.push(`a change from a ${before.dimType} to a ${g.dimType} dimension`);
    }
    if (!before || before.style !== g.style) out.push(...dimStyleProblems(r, g.style));
    if (!before || before.block !== g.block) {
      // AutoCAD draws a dimension from its block and does not make a missing one up, so a
      // dimension without one would show nothing. A new block is the dimension engine's (M3).
      if (g.block === undefined) out.push('a dimension without its block');
      else if (!insertable(r, g.block)) out.push(`block ${g.block} cannot be a dimension's block`);
    }
    return out;
  },
  write(r, e, before, g) {
    const dim = e as Dimension;
    const d = differ(before, g);
    const pl = plane(g.normal);
    // 10 and 13–15 are WCS: moved in plan, a point keeps its Z until the elevation is edited
    // (as LINE does); 11 and 16 are OCS, at the OCS elevation the mapping reads from 11.
    const elevation = d('elevation');
    const wcs = (p: Vec2, old: XYZ): XYZ =>
      new XYZ(p.x, p.y, elevation ? (g.elevation ?? 0) : old.z);
    const ocs = (p: Vec2, old: XYZ): XYZ =>
      new XYZ(ocsX(p.x, pl), p.y, elevation ? ocsZ(g.elevation, pl) : old.z);
    if (d('style')) dim.style = resolve(r, g.style, DimensionStyle)!;
    if (d('block')) dim.block = g.block ? insertable(r, g.block)! : null;
    if (d('definitionPoint') || elevation) {
      dim.definitionPoint = wcs(g.definitionPoint, dim.definitionPoint);
    }
    if (d('textPosition') || elevation)
      dim.textMiddlePoint = ocs(g.textPosition, dim.textMiddlePoint);
    if (d('textUserPositioned')) dim.isTextUserDefinedLocation = g.textUserPositioned;
    if (d('text')) dim.text = g.text;
    if (d('textRotation')) dim.textRotation = ocsAngle(g.textRotation, pl);
    if (d('horizontalDirection')) dim.horizontalDirection = ocsAngle(g.horizontalDirection, pl);
    if (d('attachment')) dim.attachmentPoint = g.attachment;
    if (d('lineSpacingStyle')) dim.lineSpacingStyle = g.lineSpacingStyle;
    if (d('lineSpacing')) dim.lineSpacingFactor = g.lineSpacing;
    if (d('flipArrows')) {
      dim.flipArrow1 = g.flipArrows?.[0] ?? false;
      dim.flipArrow2 = g.flipArrows?.[1] ?? false;
    }
    if (d('normal')) dim.normal = xyz(g.normal);
    writeDimensionPoints(dim, before, g, wcs, ocs, elevation, pl);
  },
};

/** The points and values of each dimension type (the inverse of map/entities.ts). */
function writeDimensionPoints(
  dim: Dimension,
  before: DimensionGeometry | undefined,
  g: DimensionGeometry,
  wcs: (p: Vec2, old: XYZ) => XYZ,
  ocs: (p: Vec2, old: XYZ) => XYZ,
  elevation: boolean,
  pl: Plane,
): void {
  const d = differ(before as typeof g | undefined, g) as (...keys: string[]) => boolean;
  const moved = (k: string): boolean => d(k) || elevation;
  switch (g.dimType) {
    case 'linear':
    case 'aligned': {
      const a = dim as DimensionAligned;
      if (moved('first')) a.firstPoint = wcs(g.first, a.firstPoint);
      if (moved('second')) a.secondPoint = wcs(g.second, a.secondPoint);
      if (d('oblique')) a.extLineRotation = g.oblique === undefined ? 0 : ocsAngle(g.oblique, pl);
      if (a instanceof DimensionLinear && d('rotation')) a.rotation = ocsAngle(g.rotation ?? 0, pl);
      return;
    }
    case 'angular': {
      const a = dim as DimensionAngular2Line;
      if (moved('line1Start')) a.firstPoint = wcs(g.line1Start, a.firstPoint);
      if (moved('line1End')) a.secondPoint = wcs(g.line1End, a.secondPoint);
      if (moved('line2Start')) a.angleVertex = wcs(g.line2Start, a.angleVertex);
      if (moved('arcPoint')) a.dimensionArc = ocs(g.arcPoint, a.dimensionArc);
      return;
    }
    case 'angular3pt': {
      const a = dim as DimensionAngular3Pt;
      if (moved('vertex')) a.angleVertex = wcs(g.vertex, a.angleVertex);
      if (moved('first')) a.firstPoint = wcs(g.first, a.firstPoint);
      if (moved('second')) a.secondPoint = wcs(g.second, a.secondPoint);
      return;
    }
    case 'radius':
    case 'diameter': {
      const a = dim as DimensionRadius | DimensionDiameter;
      if (moved('chordPoint')) a.angleVertex = wcs(g.chordPoint, a.angleVertex);
      if (d('leaderLength')) a.leaderLength = g.leaderLength;
      return;
    }
    case 'ordinate': {
      const a = dim as DimensionOrdinate;
      if (d('axis')) a.isOrdinateTypeX = g.axis === 'x';
      if (moved('feature')) a.featureLocation = wcs(g.feature, a.featureLocation);
      if (moved('leaderEnd')) a.leaderEndpoint = wcs(g.leaderEnd, a.leaderEndpoint);
      return;
    }
    case 'jogged': {
      const a = dim as DimensionRadialLarge;
      if (moved('chordPoint')) a.chordPoint = wcs(g.chordPoint, a.chordPoint);
      if (moved('overrideCenter')) a.overrideCenter = wcs(g.overrideCenter, a.overrideCenter);
      if (moved('jogPoint')) a.jogPoint = wcs(g.jogPoint, a.jogPoint);
      if (d('leaderLength')) a.leaderLength = g.leaderLength;
      return;
    }
    case 'arc': {
      const a = dim as DimensionArc;
      if (moved('first')) a.firstPoint = wcs(g.first, a.firstPoint);
      if (moved('second')) a.secondPoint = wcs(g.second, a.secondPoint);
      if (moved('center')) a.center = wcs(g.center, a.center);
      if (d('startAngle')) a.startAngle = g.startAngle;
      if (d('endAngle')) a.endAngle = g.endAngle;
      if (d('partial')) a.isPartial = g.partial;
      if (moved('leader')) {
        // AutoCAD writes both leader points whether or not 71 says there is a leader; one that
        // goes keeps its last points.
        a.hasLeader = g.leader !== undefined;
        if (g.leader) {
          a.leaderPoint1 = wcs(g.leader[0], a.leaderPoint1);
          a.leaderPoint2 = wcs(g.leader[1], a.leaderPoint2);
        }
      }
      return;
    }
  }
}

// ── LEADER, TOLERANCE ──────────────────────────────────────────────────────────────────────

/**
 * acad-ts has no hook line flag of its own: it writes DXF 75 exactly when the leader has more
 * than one vertex, an annotation type other than none (3) and a horizontal direction.
 */
const writesHookline = (g: LeaderGeometry): boolean =>
  g.vertices.length > 1 &&
  g.creationType !== 3 &&
  Math.hypot(g.horizontalDirection.x, g.horizontalDirection.y) > 0;

const leaderWriter: Writer<LeaderGeometry> = {
  create: () => new Leader(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if (!before || before.style !== g.style) out.push(...dimStyleProblems(r, g.style));
    const d = differ(before, g);
    // The annotation, and its reactor back, are checked with the whole model (reactors.ts).
    if (
      d('vertices', 'creationType', 'hookline', 'horizontalDirection') &&
      (g.hookline !== undefined) !== writesHookline(g)
    ) {
      out.push(g.hookline ? 'a hook line acad-ts cannot write' : 'a leader without its hook line');
    }
    return out;
  },
  write(r, e, before, g) {
    const l = e as Leader;
    const d = differ(before, g);
    // Vertices and 211–213 are WCS and mapped in plan: each keeps its Z (the mapping reads the
    // elevation from the first vertex) until the elevation itself is edited.
    const elevation = d('elevation');
    if (d('vertices') || elevation) {
      l.vertices = elevation
        ? g.vertices.map((p) => new XYZ(p.x, p.y, g.elevation ?? 0))
        : withZ(g.vertices, l.vertices);
    }
    const vector = (v: Vec2, old: XYZ): XYZ => new XYZ(v.x, v.y, old.z);
    if (d('horizontalDirection')) {
      l.horizontalDirection = vector(g.horizontalDirection, l.horizontalDirection);
    }
    if (d('blockOffset')) l.blockOffset = vector(g.blockOffset, l.blockOffset);
    if (d('annotationOffset')) l.annotationOffset = vector(g.annotationOffset, l.annotationOffset);
    if (d('style')) l.style = resolve(r, g.style, DimensionStyle)!;
    if (d('arrowhead')) l.arrowHeadEnabled = g.arrowhead;
    if (d('spline')) {
      l.pathType = g.spline ? LeaderPathType.Spline : LeaderPathType.StraightLineSegments;
    }
    if (d('creationType')) l.creationType = g.creationType;
    if (d('hookline') && g.hookline) {
      l.hookLineDirection = g.hookline.sameDirection
        ? HookLineDirection.Same
        : HookLineDirection.Opposite;
    }
    if (d('textHeight')) l.textHeight = g.textHeight;
    if (d('textWidth')) l.textWidth = g.textWidth;
    if (d('annotation')) {
      // An annotation the same save adds is created before any entity is written.
      l.associatedAnnotation = g.annotation ? resolve(r, g.annotation, AcadEntity)! : null;
    }
    if (d('normal')) l.normal = xyz(g.normal);
  },
};

const toleranceWriter: Writer<ToleranceGeometry> = {
  create: () => new Tolerance(),
  problems: (r, before, g) => [
    ...planeProblems(g),
    ...(!before || before.style !== g.style ? dimStyleProblems(r, g.style) : []),
    // The frame's Y axis is normal × X, so it runs upside down exactly when the normal is −Z.
    ...((g.upsideDown === true) !== (plane(g.normal) === 'down')
      ? ['an upside-down TOLERANCE on a +Z plane']
      : []),
  ],
  write(r, e, before, g) {
    const t = e as Tolerance;
    const d = differ(before, g);
    // 10 and 11 are WCS, as for MTEXT.
    if (d('position', 'elevation')) {
      t.insertionPoint = new XYZ(g.position.x, g.position.y, g.elevation ?? 0);
    }
    if (d('rotation')) t.direction = new XYZ(Math.cos(g.rotation), Math.sin(g.rotation), 0);
    if (d('style')) t.style = resolve(r, g.style, DimensionStyle)!;
    if (d('text')) t.text = g.text;
    if (d('normal')) t.normal = xyz(g.normal);
  },
};

// ── HATCH ──────────────────────────────────────────────────────────────────────────────────

/** The −Z mirror of a hatch edge, the inverse of map/entities.ts `hatchEdge`. */
function acadHatchEdge(e: HatchEdge, pl: Plane): HatchBoundaryPathEdge {
  const down = pl === 'down';
  const p = (v: Vec2): XY => new XY(ocsX(v.x, pl), v.y);
  switch (e.type) {
    case 'line': {
      const l = new HatchBoundaryPathLine();
      l.start = p(e.start);
      l.end = p(e.end);
      return l;
    }
    case 'arc': {
      // Mirrored with the flag flipped, a stored arc angle is the plan angle − π.
      const a = new HatchBoundaryPathArc();
      a.center = p(e.center);
      a.radius = e.radius;
      a.startAngle = down ? norm(e.startAngle - Math.PI) : e.startAngle;
      a.endAngle = down ? norm(e.endAngle - Math.PI) : e.endAngle;
      a.counterClockWise = e.ccw !== down;
      return a;
    }
    case 'ellipse': {
      const el = new HatchBoundaryPathEllipse();
      el.center = p(e.center);
      el.majorAxisEndPoint = p(e.majorAxis);
      el.minorToMajorRatio = e.ratio;
      el.startAngle = e.startAngle;
      el.endAngle = e.endAngle;
      el.counterClockWise = e.ccw !== down;
      return el;
    }
    case 'spline': {
      // acad-ts keeps a rational edge's weights in the control points' Z (DXF 42).
      const s = new HatchBoundaryPathSpline();
      s.degree = e.degree;
      s.knots = [...e.knots];
      s.controlPoints = e.controlPoints.map(
        (c, i) => new XYZ(ocsX(c.x, pl), c.y, e.weights?.[i] ?? 1),
      );
      s.isRational = e.weights !== undefined;
      s.isPeriodic = e.periodic;
      s.fitPoints = (e.fitPoints ?? []).map(p);
      s.startTangent = e.startTangent ? p(e.startTangent) : new XY(0, 0);
      s.endTangent = e.endTangent ? p(e.endTangent) : new XY(0, 0);
      return s;
    }
  }
}

function acadHatchLoopEdges(l: HatchLoop, pl: Plane): HatchBoundaryPathEdge[] {
  if (!l.polyline) return (l.edges ?? []).map((e) => acadHatchEdge(e, pl));
  // A polyline loop keeps each vertex's bulge in its Z.
  const poly = new HatchBoundaryPathPolyline();
  poly.isClosed = l.polyline.closed;
  poly.vertices = l.polyline.vertices.map(
    (v) => new XYZ(ocsX(v.x, pl), v.y, pl === 'down' ? -v.bulge + 0 : v.bulge),
  );
  return [poly];
}

const hatchWriter: Writer<HatchGeometry> = {
  create: () => new Hatch(),
  problems(_r, before, g) {
    const out = planeProblems(g);
    if (g.thickness !== undefined) out.push('a thickness, which a HATCH does not have');
    // A loop's boundary objects, and their reactors back, are checked with the whole model
    // (reactors.ts).
    g.loops.forEach((l, i) => {
      if ((l.polyline === undefined) === (l.edges === undefined)) {
        out.push(`loop ${i}: neither a polyline nor edges, or both`);
      }
      for (const e of l.edges ?? []) {
        if (
          e.type !== 'spline' ||
          same(
            e,
            before?.loops[i]?.edges?.find((x) => same(x, e)),
          )
        ) {
          continue;
        }
        if (e.knots.length !== e.controlPoints.length + e.degree + 1) {
          out.push(
            `loop ${i}: a spline edge with ${e.knots.length} knots for ${e.controlPoints.length} control points of degree ${e.degree}`,
          );
        }
        if (e.weights && e.weights.length !== e.controlPoints.length) {
          out.push(
            `loop ${i}: a spline edge with ${e.weights.length} weights for ${e.controlPoints.length} control points`,
          );
        }
      }
    });
    if (!same(before?.gradient, g.gradient) && g.gradient?.colors.some((c) => hasBook(c.color))) {
      out.push('colour-book gradient colours');
    }
    return out;
  },
  write(r, e, before, g) {
    const h = e as Hatch;
    const d = differ(before, g);
    const pl = plane(g.normal);
    // On the same plane `d` compares with `before`; a loop that did not change stays as read.
    const kept = d('normal') ? undefined : before;
    if (d('loops')) {
      const old = h.paths;
      h.paths = g.loops.map((l, i) => {
        if (kept && old[i] && same(kept.loops[i], l)) return old[i];
        // A loop at the same index is rewritten in place, keeping the boundary objects it was
        // read with unless they change: each names an entity of the drawing or one the same
        // save adds (reactors.ts checks them).
        const path = old[i] ?? new HatchBoundaryPath();
        path.flags = l.flags;
        path.edges = acadHatchLoopEdges(l, pl);
        if (!old[i] || !same(l.sources, before?.loops[i]?.sources)) {
          path.entities = (l.sources ?? []).map((s) => resolve(r, s, AcadEntity)!);
        }
        return path;
      });
    }
    if (d('pattern')) {
      if (h.pattern.name !== g.pattern) h.pattern.name = g.pattern;
    }
    // acad-ts's angle and scale setters rotate and scale the stored pattern lines by the new
    // value (not by the change), but the file's lines are already final: keep them as they are.
    if (d('patternAngle', 'patternScale')) {
      const lines = h.pattern.lines.map((l) => l.clone());
      if (d('patternAngle')) h.patternAngle = ocsAngle(g.patternAngle, pl);
      if (d('patternScale')) h.patternScale = g.patternScale;
      h.pattern.lines = lines;
    }
    if (d('patternLines')) {
      h.pattern.lines = g.patternLines.map((l) => {
        const out = new HatchPatternLine();
        out.angle = ocsAngle(l.angle, pl);
        out.basePoint = new XY(ocsX(l.base.x, pl), l.base.y);
        out.offset = new XY(ocsX(l.offset.x, pl), l.offset.y);
        out.dashLengths = [...l.dashes];
        return out;
      });
    }
    if (d('solid')) h.isSolid = g.solid;
    if (d('associative')) h.isAssociative = g.associative;
    if (d('style')) h.style = g.style;
    if (d('patternType')) h.patternType = g.patternType;
    if (d('double')) h.isDouble = g.double;
    if (d('seedPoints')) h.seedPoints = g.seedPoints.map((p) => new XY(ocsX(p.x, pl), p.y));
    if (d('gradient')) {
      const gr = g.gradient;
      const out = h.gradientColor;
      // A hatch that stops being a gradient keeps its settings, as AutoCAD's 450 = 0 does.
      out.enabled = gr !== undefined;
      if (gr) {
        out.name = gr.name;
        out.angle = ocsAngle(gr.angle, pl);
        out.shift = gr.shift;
        out.isSingleColorGradient = gr.singleColor;
        out.colorTint = gr.tint;
        out.colors = gr.colors.map((c) => {
          const x = new GradientColor();
          x.value = c.value;
          x.color = acadColor(c.color);
          return x;
        });
      }
    }
    if (d('elevation')) h.elevation = ocsZ(g.elevation, pl);
    if (d('normal')) h.normal = xyz(g.normal);
  },
};

// ── IMAGE, WIPEOUT ─────────────────────────────────────────────────────────────────────────

/** Display settings acad-ts only takes between 0 and 100 (DXF 281–283). */
const percentProblems = (values: Record<string, number>): string[] =>
  Object.entries(values)
    .filter(([, v]) => !(v >= 0 && v <= 100))
    .map(([k, v]) => `${k} ${v} is not between 0 and 100`);

function imageWriter(kind: 'IMAGE' | 'WIPEOUT'): Writer<ImageGeometry> {
  return {
    create: () => (kind === 'IMAGE' ? new RasterImage() : new Wipeout()),
    problems(r, before, g) {
      const out: string[] = [];
      // The image plane is u × v (DXF 11, 12); the mapping states it as the normal.
      const cz = g.u.x * g.v.y - g.u.y * g.v.x;
      if (plane(g.normal) === 'tilted') out.push('a plane that is not ±Z');
      else if (!(cz !== 0)) out.push('U and V vectors that span no plane');
      else if (cz < 0 !== (plane(g.normal) === 'down')) {
        out.push('a normal that is not U × V');
      }
      if (g.thickness !== undefined) out.push(`a thickness, which an ${kind} does not have`);
      // A rectangle is stated by two opposite corners (DXF 91 = 2); the DWG writer reads both.
      const n = g.clip.vertices.length;
      if ((!before || !same(before.clip, g.clip)) && g.clip.type === 'rectangle' && n !== 2) {
        out.push(`a rectangular clip with ${n} corners`);
      }
      out.push(
        ...percentProblems({ brightness: g.brightness, contrast: g.contrast, fade: g.fade }),
      );
      if (kind === 'WIPEOUT' && g.definition !== undefined) out.push('a WIPEOUT with an IMAGEDEF');
      if (kind === 'IMAGE' && (!before || before.definition !== g.definition)) {
        // AutoCAD has no image without the IMAGEDEF that names its file.
        if (g.definition === undefined) out.push('an IMAGE without its IMAGEDEF');
        else if (!resolve(r, g.definition, ImageDefinition)) {
          out.push(`IMAGEDEF ${g.definition} does not exist`);
        }
      }
      return out;
    },
    write(r, e, before, g) {
      const im = e as CadWipeoutBase;
      const d = differ(before, g);
      if (d('definition') && g.definition !== undefined) {
        // The IMAGEDEF_REACTOR goes with the image: off the old definition's reactors (the
        // writer adds it to the new one's and makes one for a new image, `updateImageReactors`).
        const reactor = im.definitionReactor;
        const old = im.definition;
        if (reactor && old) {
          const i = old.reactors.indexOf(reactor);
          if (i >= 0) old.reactors.splice(i, 1);
        }
        im.definition = resolve(r, g.definition, ImageDefinition)!;
      }
      // Points and vectors are WCS; the image plane is ±Z, so U and V have no Z.
      if (d('position', 'elevation')) {
        im.insertPoint = new XYZ(g.position.x, g.position.y, g.elevation ?? 0);
      }
      if (d('u')) im.uVector = new XYZ(g.u.x, g.u.y, 0);
      if (d('v')) im.vVector = new XYZ(g.v.x, g.v.y, 0);
      if (d('size')) im.size = new XY(g.size.x, g.size.y);
      if (d('displayFlags')) im.flags = g.displayFlags;
      if (d('clipping')) im.clippingState = g.clipping;
      if (d('brightness')) im.brightness = g.brightness;
      if (d('contrast')) im.contrast = g.contrast;
      if (d('fade')) im.fade = g.fade;
      if (d('clip')) {
        im.clipType = g.clip.type === 'polygon' ? ClipType.Polygonal : ClipType.Rectangular;
        im.clipBoundaryVertices = g.clip.vertices.map((p) => new XY(p.x, p.y));
        im.clipMode = g.clip.inverted ? ClipMode.Inside : ClipMode.Outside;
      }
    },
  };
}

// ── PDFUNDERLAY ────────────────────────────────────────────────────────────────────────────

const underlayWriter: Writer<UnderlayGeometry> = {
  create: () => new PdfUnderlay(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if (g.thickness !== undefined) out.push('a thickness, which a PDFUNDERLAY does not have');
    // Its Y axis is normal × X, so it is reversed exactly on −Z.
    if ((g.upsideDown === true) !== (plane(g.normal) === 'down')) {
      out.push('an upside-down PDFUNDERLAY on a +Z plane');
    }
    if (g.scale.x === 0 || g.scale.y === 0 || g.scale.z === 0) out.push('a zero scale');
    out.push(...percentProblems({ contrast: g.contrast, fade: g.fade }));
    if (
      (!before || before.definition !== g.definition) &&
      g.definition !== undefined &&
      !resolve(r, g.definition, PdfUnderlayDefinition)
    ) {
      out.push(`PDFDEFINITION ${g.definition} does not exist`);
    }
    return out;
  },
  write(r, e, before, g) {
    const u = e as PdfUnderlay;
    const d = differ(before, g);
    const pl = plane(g.normal);
    if (d('definition')) {
      u.definition = g.definition ? resolve(r, g.definition, PdfUnderlayDefinition)! : null;
    }
    // The insertion point is WCS; the rotation is about the normal (map/entities.ts).
    if (d('position', 'elevation')) {
      u.insertPoint = new XYZ(g.position.x, g.position.y, g.elevation ?? 0);
    }
    if (d('scale')) {
      u.xScale = g.scale.x;
      u.yScale = g.scale.y;
      u.zScale = g.scale.z;
    }
    if (d('rotation')) u.rotation = ocsAngle(g.rotation, pl);
    if (d('flags')) u.flags = g.flags;
    if (d('contrast')) u.contrast = g.contrast;
    if (d('fade')) u.fade = g.fade;
    if (d('clip')) u.clipBoundaryVertices = g.clip.map((p) => new XY(p.x, p.y));
    if (d('normal')) u.normal = xyz(g.normal);
  },
};

// ── MLINE ──────────────────────────────────────────────────────────────────────────────────

const mlineWriter: Writer<MLineGeometry> = {
  create: () => new MLine(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if (g.thickness !== undefined) out.push('a thickness, which an MLINE does not have');
    const d = differ(before, g);
    if (d('style')) {
      if (g.style === undefined) out.push('an MLINE without its MLINESTYLE');
      else if (!resolve(r, g.style, MLineStyle)) out.push(`MLINESTYLE ${g.style} does not exist`);
    }
    // DXF 73 is the style's element count, and each vertex states one parameter list per
    // element (DXF reference, MLINE); a mismatch writes an MLINE AutoCAD cannot read.
    const style = g.style ? resolve(r, g.style, MLineStyle) : undefined;
    if (style && d('style', 'vertices')) {
      const n = style.elements.length;
      if (g.vertices.some((v) => v.elements.length !== n)) {
        out.push(`vertices whose element count is not the ${n} of MLINESTYLE ${g.style}`);
      }
    }
    return out;
  },
  write(r, e, before, g) {
    const m = e as MLine;
    const d = differ(before, g);
    if (d('style')) m.style = resolve(r, g.style!, MLineStyle)!;
    if (d('scale')) m.scaleFactor = g.scale;
    if (d('justification')) m.justification = g.justification;
    if (d('flags')) m.flags = g.flags;
    // Points and vectors are WCS (the mapping reads the elevation from the start point): a
    // vertex keeps its Z until the elevation is edited, and one added takes the start's.
    const elevation = d('elevation');
    if (d('start') || elevation) {
      m.startPoint = new XYZ(g.start.x, g.start.y, elevation ? (g.elevation ?? 0) : m.startPoint.z);
    }
    if (d('vertices') || elevation) {
      const old = m.vertices;
      const z = (i: number): number => (elevation || !old[i] ? m.startPoint.z : old[i]!.position.z);
      const vector = (v: Vec2, o: XYZ | undefined): XYZ => new XYZ(v.x, v.y, o?.z ?? 0);
      m.vertices = g.vertices.map((src, i) => {
        const v = new MLineVertex();
        v.position = new XYZ(src.position.x, src.position.y, z(i));
        v.direction = vector(src.direction, old[i]?.direction);
        v.miter = vector(src.miter, old[i]?.miter);
        v.segments = src.elements.map((el) => {
          const s = new MLineSegment();
          s.parameters = [...el.parameters];
          s.areaFillParameters = [...el.fillParameters];
          return s;
        });
        return v;
      });
    }
    if (d('normal')) m.normal = xyz(g.normal);
  },
};

// ── MULTILEADER ────────────────────────────────────────────────────────────────────────────

/** MLEADER content types (DXF 172) that need content: 1 block, 2 mtext. */
const BLOCK_CONTENT = 1;
const MTEXT_CONTENT = 2;

function multiLeaderProblems(
  r: Resolver,
  before: MultiLeaderGeometry | undefined,
  g: MultiLeaderGeometry,
): string[] {
  const out = planeProblems(g);
  const d = differ(before, g);
  if (g.thickness !== undefined) out.push('a thickness, which a MULTILEADER does not have');
  if (d('style')) {
    if (g.style === undefined) out.push('a MULTILEADER without its MLEADERSTYLE');
    else if (!resolve(r, g.style, MultiLeaderStyle)) {
      out.push(`MLEADERSTYLE ${g.style} does not exist`);
    }
  }
  if (d('linetype') && g.linetype !== undefined && !resolve(r, g.linetype, LineType)) {
    out.push(`linetype ${g.linetype} does not exist`);
  }
  if (d('arrowhead') && g.arrowhead !== undefined && !resolve(r, g.arrowhead, BlockRecord)) {
    out.push(`arrowhead block ${g.arrowhead} does not exist`);
  }
  // An annotative multileader keeps a context data object per annotation scale in its extension
  // dictionary, which Triya does not write yet (M1-75).
  if ((before ? before.annotative : false) !== g.annotative) out.push('annotative changes');
  const colors = [g.lineColor, g.text?.color, g.block?.color];
  if (d('lineColor', 'text', 'block') && colors.some((c) => c && hasBook(c))) {
    out.push('colour-book colours');
  }
  if (d('contentType', 'text') && g.contentType === MTEXT_CONTENT && !g.text) {
    out.push('an mtext MULTILEADER without its text');
  }
  if (d('contentType', 'block') && g.contentType === BLOCK_CONTENT && !g.block?.block) {
    out.push('a block MULTILEADER without its block');
  }
  if (d('text') && g.text) {
    if (!before?.text || before.text.style !== g.text.style) {
      out.push(...styleProblems(r, g.text.style));
    }
  }
  if (d('block') && g.block?.block !== undefined && !resolve(r, g.block.block, BlockRecord)) {
    out.push(`content block ${g.block.block} does not exist`);
  }
  // The text's normal is the leader plane's, so it runs upside down exactly on −Z, as MTEXT.
  if (g.text && (g.text.upsideDown === true) !== (plane(g.normal) === 'down')) {
    out.push('upside-down MULTILEADER text on a +Z plane');
  }
  return out;
}

/** A leader plane's 111/112 axes: X along +X, Y = normal × X (MLEADER context data). */
const leaderAxes = (pl: Plane): [XYZ, XYZ] =>
  pl === 'down' ? [new XYZ(1, 0, 0), new XYZ(0, -1, 0)] : [new XYZ(1, 0, 0), new XYZ(0, 1, 0)];

const multiLeaderWriter: Writer<MultiLeaderGeometry> = {
  create: () => new MultiLeader(),
  problems: multiLeaderProblems,
  write(r, e, before, g) {
    const m = e as MultiLeader;
    const c = m.contextData;
    const d = differ(before, g);
    const pl = plane(g.normal);
    // Every point is WCS and mapped in plan (the elevation is the base point's Z): each keeps its
    // Z until the elevation is edited, and a point the save adds takes the elevation.
    const elevation = d('elevation');
    const z0 = g.elevation ?? 0;
    const at = (p: Vec2, old: XYZ | undefined): XYZ =>
      new XYZ(p.x, p.y, elevation || !old ? z0 : old.z);
    if (elevation) c.basePoint = new XYZ(c.basePoint.x, c.basePoint.y, z0);
    if (d('normal')) {
      [c.baseDirection, c.baseVertical] = leaderAxes(pl);
      c.normalReversed = false;
    }
    if (d('style')) m.style = resolve(r, g.style!, MultiLeaderStyle)!;
    if (d('overrideFlags')) m.propertyOverrideFlags = g.overrideFlags;
    if (d('pathType')) m.pathType = g.pathType;
    if (d('lineColor')) m.lineColor = acadColor(g.lineColor);
    if (d('linetype')) m.leaderLineType = g.linetype ? resolve(r, g.linetype, LineType)! : null;
    if (d('lineweight')) m.leaderLineWeight = acadLineweight(g.lineweight);
    if (d('landing')) m.enableLanding = g.landing;
    if (d('dogleg')) m.enableDogleg = g.dogleg;
    if (d('doglegLength')) m.landingDistance = g.doglegLength;
    if (d('arrowhead')) m.arrowhead = g.arrowhead ? resolve(r, g.arrowhead, BlockRecord)! : null;
    if (d('arrowheadSize')) m.arrowheadSize = g.arrowheadSize;
    if (d('drawnArrowheadSize')) c.arrowheadSize = g.drawnArrowheadSize ?? g.arrowheadSize;
    if (d('contentType')) m.contentType = g.contentType;
    if (d('scale')) m.scaleFactor = g.scale;
    if (d('annotative')) m.enableAnnotationScale = g.annotative;
    // The text attachments and alignment are stated on the entity and again in the context data
    // AutoCAD draws from; the mapping reads the entity's, and a save keeps the two the same.
    if (d('textLeftAttachment')) {
      m.textLeftAttachment = g.textLeftAttachment;
      c.textLeftAttachment = g.textLeftAttachment;
    }
    if (d('textRightAttachment')) {
      m.textRightAttachment = g.textRightAttachment;
      c.textRightAttachment = g.textRightAttachment;
    }
    if (d('textTopAttachment')) {
      m.textTopAttachment = g.textTopAttachment;
      c.textTopAttachment = g.textTopAttachment;
    }
    if (d('textBottomAttachment')) {
      m.textBottomAttachment = g.textBottomAttachment;
      c.textBottomAttachment = g.textBottomAttachment;
    }
    if (d('textAttachmentDirection')) m.textAttachmentDirection = g.textAttachmentDirection;
    if (d('textAngleType')) m.textAngle = g.textAngleType;
    if (d('textAlignment')) {
      m.textAlignment = g.textAlignment;
      c.textAlignment = g.textAlignment;
    }
    if (d('textFrame')) m.textFrame = g.textFrame;
    if (d('contentBase') || elevation) c.contentBasePoint = at(g.contentBase, c.contentBasePoint);
    if (d('landingGap')) c.landingGap = g.landingGap;
    // A new entity, or one moved to another plane, writes all of its content.
    const was = d('normal') ? undefined : before;
    if (d('text') || elevation) writeMultiLeaderText(r, m, was?.text, g, elevation);
    if (d('block') || elevation) writeMultiLeaderBlock(r, m, was?.block, g, elevation);
    if (d('branches') || elevation) {
      const roots = c.leaderRoots;
      c.leaderRoots = g.branches.map((b, i) => {
        // A branch or line keeps what Triya does not map (its breaks, a line's own colour,
        // linetype and arrowhead overrides) by its position in the list.
        const root = roots[i] ?? new LeaderRoot();
        root.leaderIndex = b.index;
        root.connectionPoint = at(b.connection, roots[i]?.connectionPoint);
        root.direction = new XYZ(b.direction.x, b.direction.y, roots[i]?.direction.z ?? 0);
        root.landingDistance = b.doglegLength;
        const lines = root.lines;
        root.lines = b.lines.map((l, j) => {
          const line = lines[j] ?? new LeaderLine();
          line.index = l.index;
          line.points = l.vertices.map((p, k) => at(p, lines[j]?.points[k]));
          return line;
        });
        return root;
      });
    }
  },
};

function writeMultiLeaderText(
  r: Resolver,
  m: MultiLeader,
  before: MultiLeaderText | undefined,
  g: MultiLeaderGeometry,
  elevation: boolean,
): void {
  const c = m.contextData;
  const t = g.text;
  c.hasTextContents = t !== undefined;
  if (!t) return;
  const b = before;
  const d = (...keys: (keyof MultiLeaderText)[]): boolean =>
    !b || keys.some((k) => !same(b[k], t[k]));
  const z = elevation || !b ? (g.elevation ?? 0) : c.textLocation.z;
  if (d('content')) c.textLabel = t.content;
  if (d('style')) {
    c.textStyle = resolve(r, t.style, TextStyle)!;
    m.textStyle = c.textStyle;
  }
  if (d('position') || elevation) c.textLocation = new XYZ(t.position.x, t.position.y, z);
  if (d('rotation', 'upsideDown')) {
    // 13 is the WCS text direction; 42 states the same angle about the text normal (OCS).
    c.direction = new XYZ(Math.cos(t.rotation) + 0, Math.sin(t.rotation) + 0, 0);
    c.textRotation = ocsAngle(t.rotation, t.upsideDown ? 'down' : 'up');
  }
  if (d('upsideDown')) c.textNormal = new XYZ(0, 0, t.upsideDown ? -1 : 1);
  if (d('height')) c.textHeight = t.height;
  if (d('width')) c.boundaryWidth = t.width;
  if (d('boundaryHeight')) c.boundaryHeight = t.boundaryHeight;
  if (d('lineSpacing')) c.lineSpacingFactor = t.lineSpacing;
  if (d('lineSpacingStyle')) c.lineSpacing = t.lineSpacingStyle;
  if (d('attachment')) {
    c.textAttachmentPoint = t.attachment;
    m.textAttachmentPoint = t.attachment;
  }
  if (d('flow')) c.flowDirection = t.flow;
  if (d('color')) {
    c.textColor = acadColor(t.color);
    m.textColor = c.textColor;
  }
}

function writeMultiLeaderBlock(
  r: Resolver,
  m: MultiLeader,
  before: MultiLeaderBlock | undefined,
  g: MultiLeaderGeometry,
  elevation: boolean,
): void {
  const c = m.contextData;
  const k = g.block;
  c.hasContentsBlock = k !== undefined;
  if (!k) return;
  const b = before;
  const d = (...keys: (keyof MultiLeaderBlock)[]): boolean =>
    !b || keys.some((key) => !same(b[key], k[key]));
  // The block's normal (context 14) is the leader plane's; Triya does not map it.
  if (!b) c.blockContentNormal = new XYZ(0, 0, plane(g.normal) === 'down' ? -1 : 1);
  if (d('block')) {
    c.blockContent = k.block ? resolve(r, k.block, BlockRecord)! : null;
    m.blockContentId = c.blockContent;
  }
  if (d('position') || elevation) {
    const z = elevation || !b ? (g.elevation ?? 0) : c.blockContentLocation.z;
    c.blockContentLocation = new XYZ(k.position.x, k.position.y, z);
  }
  if (d('scale')) {
    c.blockContentScale = new XYZ(k.scale.x, k.scale.y, k.scale.z);
    m.blockContentScale = c.blockContentScale;
  }
  if (d('rotation')) {
    c.blockContentRotation = k.rotation;
    m.blockContentRotation = k.rotation;
  }
  if (d('color')) {
    c.blockContentColor = acadColor(k.color);
    m.blockContentColor = c.blockContentColor;
  }
}

// ── VIEWPORT ───────────────────────────────────────────────────────────────────────────────

const viewportWriter: Writer<ViewportGeometry> = {
  create: () => new Viewport(),
  problems(r, before, g) {
    const out: string[] = [];
    const d = differ(before, g);
    // The clip boundary, and its reactor back, are checked with the whole model (reactors.ts).
    if (d('frozenLayers')) {
      for (const l of g.frozenLayers) {
        if (!resolve(r, l, Layer)) out.push(`frozen layer ${l} does not exist`);
      }
    }
    if (
      d('visualStyle') &&
      g.visualStyle !== undefined &&
      !resolve(r, g.visualStyle, VisualStyle)
    ) {
      out.push(`visual style ${g.visualStyle} does not exist`);
    }
    return out;
  },
  write(r, e, before, g) {
    const v = e as Viewport;
    const d = differ(before, g);
    // The frame is in paper space; its centre keeps the Z it had.
    if (d('center')) v.center = new XYZ(g.center.x, g.center.y, v.center.z);
    if (d('width')) v.width = g.width;
    if (d('height')) v.height = g.height;
    if (d('id')) v.id = g.id;
    if (d('status')) v.activeStatus = g.status;
    if (d('flags')) v.status = g.flags as Viewport['status'];
    if (d('viewCenter')) v.viewCenter = new XY(g.viewCenter.x, g.viewCenter.y);
    if (d('viewHeight')) v.viewHeight = g.viewHeight;
    if (d('viewDirection')) {
      v.viewDirection = new XYZ(g.viewDirection.x, g.viewDirection.y, g.viewDirection.z);
    }
    if (d('viewTarget')) v.viewTarget = new XYZ(g.viewTarget.x, g.viewTarget.y, g.viewTarget.z);
    if (d('twist')) v.twistAngle = g.twist;
    if (d('lensLength')) v.lensLength = g.lensLength;
    if (d('frontClip')) v.frontClipPlane = g.frontClip;
    if (d('backClip')) v.backClipPlane = g.backClip;
    if (d('frozenLayers')) v.frozenLayers = g.frozenLayers.map((l) => resolve(r, l, Layer)!);
    if (d('clipBoundary')) {
      // A clip the same save adds (VPCLIP Polygonal) is created before any entity is written.
      v.boundary = g.clipBoundary ? resolve(r, g.clipBoundary, AcadEntity)! : null;
    }
    if (d('plotStyleSheet')) v.styleSheetName = g.plotStyleSheet;
    if (d('renderMode')) v.renderMode = g.renderMode;
    if (d('visualStyle')) {
      v.visualStyle = g.visualStyle ? resolve(r, g.visualStyle, VisualStyle)! : null;
    }
  },
};

// ── ACAD_TABLE ─────────────────────────────────────────────────────────────────────────────

/** Every cell of `after` with its row, column and the cell it was in `before`, if any. */
function* cells(
  before: TableGeometry | undefined,
  after: TableGeometry,
): Generator<[number, number, TableCell | undefined, TableCell]> {
  for (const [i, row] of after.cells.entries()) {
    for (const [j, a] of row.entries()) yield [i, j, before?.cells[i]?.[j], a];
  }
}

/** The grid of `g` is `rows` × `columns`, every row holding a cell per column. */
const gridOf = (g: TableGeometry, rows: number, columns: number): boolean =>
  g.rowHeights.length === rows &&
  g.columnWidths.length === columns &&
  g.cells.length === rows &&
  g.cells.every((r) => r.length === columns);

/**
 * ACAD_TABLE, edited as the table grips and the cell editor edit it (M4-05): placement, row
 * heights and column widths, cell text and blocks, cell rotation, the table style and the `*T`
 * block. The `*T` block, which AutoCAD draws the table from, is written as it is: regenerating it
 * from the new content is the table engine's (M4-05), as a dimension's block is the dimension
 * engine's. Merges and cell formats are written by table-cells.ts (M1-75 part 26). A new table
 * (TABLE, COPY; part 32) comes with the `*T` block the same save adds for it, and is built by
 * table-new.ts with its table-wide overrides. Rows and columns inserted or deleted (part 34) are
 * moved into place by table-grid.ts, from where the table says each came from. An edited table's
 * table-wide overrides are refused for now.
 */
const tableWriter: Writer<TableGeometry> = {
  create: () => new TableEntity(),
  problems(r, before, g) {
    const out = planeProblems(g);
    if (g.thickness) out.push('a table with a thickness');
    if (before?.style !== g.style || !before) {
      if (g.style === undefined) out.push('a table without its table style');
      else if (!resolve(r, g.style, TableStyle)) out.push(`table style ${g.style} does not exist`);
    }
    if (before?.block !== g.block || !before) {
      if (g.block === undefined) out.push('a table without its block');
      else if (!insertable(r, g.block)) out.push(`block ${g.block} cannot be a table's block`);
    }
    if (g.direction.x === 0 && g.direction.y === 0) out.push('no horizontal direction');
    if (!before) out.push(...newTableProblems(r, g));
    else if (!same(before.overrides, g.overrides)) out.push('table overrides change');
    if (before) {
      const origins = originProblems(before, g);
      if (origins.length > 0) return [...out, ...origins];
    }
    const rows = g.rowHeights.length;
    const columns = g.columnWidths.length;
    if (rows === 0 || columns === 0) {
      out.push('no rows or no columns');
      return out;
    }
    if (!gridOf(g, rows, columns)) {
      out.push('a grid that is not rows × columns (a height per row, a cell per column)');
      return out;
    }
    if (g.rowHeights.some((h) => !(h > 0))) out.push('a row height of 0 or less');
    if (g.columnWidths.some((w) => !(w > 0))) out.push('a column width of 0 or less');
    // Each cell against the cell it was, wherever its row and column were.
    const was = before && alignedBefore(before, g);
    if (!was || mergesChange(was, g)) out.push(...mergeProblems(g));
    for (const [i, j, b, a] of cells(was, g)) {
      const at = `cell (${i}, ${j})`;
      out.push(...formatValueProblems(r, a, b).map((p) => `${at}: ${p}`));
      if (b && a.type !== b.type) {
        out.push(`${at}: a change between text and block`);
        continue;
      }
      if (a.type === 'block') {
        if (a.text !== '') out.push(`${at}: text in a block cell`);
        if (a.block === undefined) out.push(`${at}: a block cell without a block`);
        else if (a.block !== b?.block && !insertable(r, a.block)) {
          out.push(`${at}: block ${a.block} cannot be a cell's block`);
        }
      } else if (a.block !== undefined) {
        out.push(`${at}: a block in a text cell`);
      }
    }
    return out;
  },
  write(r, e, before, g) {
    const t = e as TableEntity;
    // Rows and columns inserted or deleted (table-grid.ts): every row, column and cell moves to
    // its new place first, and is then written against what it was.
    const grid = before !== undefined && regridded(g);
    const formats = grid ? formatsBefore(t, before, g) : undefined;
    if (grid) regrid(t, g);
    const was = before && alignedBefore(before, g);
    const d = differ(was, g);
    const pl = plane(g.normal);
    if (d('style')) t.style = resolve(r, g.style!, TableStyle)!;
    if (!before) buildGrid(t, g);
    if (d('block')) t.block = insertable(r, g.block!)!;
    if (d('position', 'elevation')) {
      t.insertPoint = new XYZ(ocsX(g.position.x, pl), g.position.y, ocsZ(g.elevation, pl));
    }
    // DXF 11 is WCS, in the table's plane.
    if (d('direction')) t.horizontalDirection = new XYZ(g.direction.x, g.direction.y, 0);
    if (d('rowHeights')) g.rowHeights.forEach((h, i) => (t.rows[i]!.height = h));
    if (d('columnWidths')) g.columnWidths.forEach((w, j) => (t.columns[j]!.width = w));
    if (d('normal')) t.normal = xyz(g.normal);
    // Cells by their own before, not `differ`'s: a plane change must not rewrite every value.
    for (const [i, j, b, a] of cells(was, g)) {
      const cell = t.rows[i]!.cells[j]!;
      // A new cell nothing was typed into holds no value, as AutoCAD leaves one.
      if (a.type === 'text' && (b ? b.text !== a.text : a.text !== '')) {
        writeCellText(cell, a.text);
      }
      if (a.type === 'block' && (!b || b.block !== a.block)) {
        const block = insertable(r, a.block!)!;
        if (cell.type === CellType.Block || cell.value instanceof BlockRecord) cell.value = block;
        for (const k of cell.contents) {
          if (k.blockRecord || k.contentType & TableCellContentType.Block) k.blockRecord = block;
        }
      }
      if (!b || b.rotation !== a.rotation) cell.rotation = a.rotation;
      const format = formats ? formats[i]![j] : b?.format;
      if (!same(format, a.format)) writeCellFormat(r, cell, format, a.format);
    }
    if (!was || grid || mergesChange(was, g)) writeMerges(t, was, g);
    if (!before && g.overrides) writeTableOverrides(r, t, g.overrides);
  },
};

/**
 * A cell's text, as the cell editor leaves it: a string value, whatever the value was (a number
 * or date cell typed over keeps what was typed; AutoCAD would parse it by the cell's data format,
 * which Triya does not map, so the drafter's text is what is kept). AutoCAD 2007 and later state
 * a value's formatted text beside it; a value that had one gets the new text as its own.
 */
function writeCellText(cell: TableEntity['rows'][number]['cells'][number], text: string): void {
  let content = cell.contents[0];
  if (!content) {
    // A DWG R2010+ cell that was never typed in has no content at all.
    content = new CellContent();
    content.contentType = TableCellContentType.Value;
    cell.contents.push(content);
  }
  const v = content.cadValue;
  const formatted = v.formattedValue !== '';
  v.setValue(text, CadValueType.String);
  v.isEmpty = false;
  v.formattedValue = formatted ? text : '';
}

/**
 * What an edited table's original holds that its writer cannot change, by the cell: a cell with
 * a field (FIELD, M4-10), several contents, locked content or a data link is not typed over (the
 * cell editor refuses a locked one; the link and the field would put their own value back), a
 * block with attribute values keeps them, and a DWG from R2010 keeps a cell's rotation in its
 * content format, which Triya does not map.
 */
export function tableCellProblems(
  acad: TableEntity,
  before: TableGeometry,
  after: TableGeometry,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
): string[] {
  const out: string[] = [];
  const grid = regridded(after);
  if (grid) {
    if (originProblems(before, after).length > 0) return out;
    out.push(...regridProblems(acad, after));
  } else if (!gridOf(after, acad.rows.length, acad.columns.length)) return out;
  const dwgFrom2010 = format === 'dwg' && version !== undefined && version >= ACadVersion.AC1024;
  const was = alignedBefore(before, after);
  // A cell a row or column insert makes is checked against what it maps as where it sits.
  const formats = grid ? formatsBefore(acad, before, after) : undefined;
  for (const [i, j, b, a] of cells(was, after)) {
    const at = `cell (${i}, ${j})`;
    const formatWas = formats ? formats[i]![j] : b?.format;
    out.push(
      ...formatFileProblems(formatWas, a.format, version, format, dwgFrom2010).map(
        (p) => `${at}: ${p}`,
      ),
    );
    if (!b) continue;
    const cell = acad.rows[after.rowOrigins?.[i] ?? i]?.cells[after.columnOrigins?.[j] ?? j];
    if (!cell) continue;
    if (b.text !== a.text || b.block !== a.block) {
      const k = cell.contents[0];
      if (cell.contents.length > 1) out.push(`${at} holds more than one content`);
      if (k && (k.field || k.contentType & TableCellContentType.Field)) {
        out.push(`${at} holds a field (M4-10)`);
      }
      if (cell.stateFlags & TableCellStateFlags.ContentLocked)
        out.push(`${at}: its content is locked`);
      if (cell.hasLinkedData) out.push(`${at} is linked to external data`);
      if (b.block !== a.block && (cell.attributes.length > 0 || (k?.attributes.length ?? 0) > 0)) {
        out.push(`${at}: a block with attribute values`);
      }
    }
    if (b.rotation !== a.rotation && dwgFrom2010) {
      out.push(`${at}: a cell rotation in a DWG from R2010, which keeps it in the content format`);
    }
  }
  return out;
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
  TRACE: traceWriter,
  '3DFACE': face3dWriter,
  SPLINE: splineWriter,
  POLYLINE: polylineWriter,
  ATTDEF: attdefWriter,
  INSERT: insertWriter,
  DIMENSION: dimensionWriter,
  ARC_DIMENSION: dimensionWriter,
  LARGE_RADIAL_DIMENSION: dimensionWriter,
  LEADER: leaderWriter,
  TOLERANCE: toleranceWriter,
  HATCH: hatchWriter,
  IMAGE: imageWriter('IMAGE'),
  WIPEOUT: imageWriter('WIPEOUT'),
  PDFUNDERLAY: underlayWriter,
  MLINE: mlineWriter,
  MULTILEADER: multiLeaderWriter,
  VIEWPORT: viewportWriter,
  ACAD_TABLE: tableWriter,
} as Partial<Record<EntityType, Writer<never>>>;

/** The entity types whose geometry Triya can write (the rest: roadmap M1-75). */
export const WRITABLE_TYPES: readonly EntityType[] = Object.keys(WRITERS) as EntityType[];

/** A new acad-ts entity for `geom`, or undefined when no writer exists. */
export function createAcadEntity(geom: EntityGeometry): AcadEntity | undefined {
  // A 3D polyline is its own acad-ts class (POLYLINE_3D in DWG), which `create` cannot pick.
  if (geom.kind === 'POLYLINE' && geom.is3d) return new Polyline3D();
  // Each dimension type is its own class, which `create` cannot pick either.
  if ('dimType' in geom) return DIMENSION_CLASSES[geom.dimType]();
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

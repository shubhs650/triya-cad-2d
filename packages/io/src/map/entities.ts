// AcadToTriya for entities (M1-04, ARCHITECTURE.md §6.1). Each entity of every block record
// (model space, the paper-space layouts and the block definitions) becomes an `EntityInit` in
// plan view (DEC-039). Types not mapped yet, and entities whose plane is tilted, are reported
// in `unmapped` and stay with the retained original only.

import {
  Arc,
  AttributeDefinition,
  Insert,
  MText,
  TableEntity,
  TextEntity,
  type AttributeBase,
  type AttributeEntity,
  Circle,
  Ellipse,
  Face3D,
  Line,
  LwPolyline,
  Point,
  PolyfaceMesh,
  PolygonMesh,
  Polyline,
  Polyline3D,
  Ray,
  Solid,
  Spline,
  XLine,
  type BlockRecord,
  type CadDocument,
  type Entity,
  type TextStyle,
  type Vertex,
  type XYZ,
} from '@node-projects/acad-ts';
import type {
  AttributeFields,
  Color,
  EntityGeometry,
  EntityInit,
  EntityProps,
  InsertAttribute,
  LinetypeRef,
  MTextGeometry,
  ObjectCommon,
  PlanarProps,
  TextFields,
  PolylineVertex,
  Transparency,
  Vec2,
} from '@triya/engine';
import { common, hex, mapColor, mapLineweight, ref } from './common';

export interface UnmappedEntity {
  readonly handle: string;
  /** DXF type name. */
  readonly type: string;
  readonly reason: 'not mapped yet' | 'tilted plane' | 'no plan view' | 'missing block';
}

export interface MappedEntities {
  /** In block order: every block record's entities in file (draw) order. */
  readonly entities: EntityInit[];
  readonly unmapped: UnmappedEntity[];
}

const TWO_PI = 2 * Math.PI;
const norm = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/**
 * An extrusion along ±Z has an exact plan view. AutoCAD's arbitrary-axis algorithm gives
 * −Z the OCS X axis (−1, 0, 0) and Y axis (0, 1, 0), so OCS (x, y, z) is WCS (−x, y, −z).
 */
type Plane = 'up' | 'down' | 'tilted';
function plane(n: XYZ): Plane {
  const len = Math.hypot(n.x, n.y, n.z);
  if (len === 0) return 'up'; // no extrusion stated: AutoCAD's default +Z
  if (Math.hypot(n.x, n.y) > 1e-9 * len) return 'tilted';
  return n.z > 0 ? 'up' : 'down';
}

/** OCS point to WCS plan view for an ±Z extrusion. */
const planOf = (p: { x: number; y: number }, pl: Plane): Vec2 =>
  pl === 'down' ? { x: -p.x, y: p.y } : { x: p.x, y: p.y };
const xy = (p: { x: number; y: number }): Vec2 => ({ x: p.x, y: p.y });

function planar(pl: Plane, n: XYZ, elevation: number, thickness: number): PlanarProps {
  // The OCS elevation of a −Z entity lies at WCS Z = −elevation.
  const z = pl === 'down' ? -elevation : elevation;
  return {
    ...(z !== 0 ? { elevation: z } : {}),
    ...(thickness !== 0 ? { thickness } : {}),
    ...(pl !== 'up' ? { normal: { x: n.x, y: n.y, z: n.z } } : {}),
  };
}

function entityColor(e: Entity): Color {
  const c = mapColor(e.color);
  const book = e.bookColor;
  if (c.kind === 'rgb' && book?.colorName) {
    return { ...c, bookName: book.bookName, colorName: book.colorName };
  }
  return c;
}

function linetypeRef(e: Entity): LinetypeRef {
  const name = e.lineType.name.toUpperCase();
  if (name === 'BYLAYER') return 'ByLayer';
  if (name === 'BYBLOCK') return 'ByBlock';
  return hex(e.lineType.handle);
}

/** acad-ts keeps DXF 440 as a percentage (0 opaque – 90); Triya keeps alpha 0–255. */
function transparency(e: Entity): Transparency {
  const t = e.transparency;
  if (t.isByLayer) return 'ByLayer';
  if (t.isByBlock) return 'ByBlock';
  return { alpha: Math.round((255 * (100 - t.value)) / 100) };
}

function vertex(
  v: { x: number; y: number },
  bulge: number,
  sw: number,
  ew: number,
): PolylineVertex {
  return {
    x: v.x,
    y: v.y,
    bulge,
    ...(sw !== 0 ? { startWidth: sw } : {}),
    ...(ew !== 0 ? { endWidth: ew } : {}),
  };
}

/** Mirroring X reverses every arc, so bulges change sign. */
function lwVertices(
  vs: readonly {
    location: { x: number; y: number };
    bulge: number;
    startWidth: number;
    endWidth: number;
  }[],
  pl: Plane,
): PolylineVertex[] {
  return vs.map((v) =>
    vertex(planOf(v.location, pl), pl === 'down' ? -v.bulge : v.bulge, v.startWidth, v.endWidth),
  );
}

const FIT: Record<number, 'quadratic' | 'cubic' | 'bezier'> = {
  5: 'quadratic',
  6: 'cubic',
  8: 'bezier',
};

function polyline(p: Polyline): EntityGeometry | UnmappedEntity['reason'] {
  const flags = p.flags as number;
  const is3d = p instanceof Polyline3D || (flags & 8) !== 0;
  const pl = is3d ? 'up' : plane(p.normal);
  if (pl === 'tilted') return 'tilted plane';
  const vertices = [...p.vertices] as unknown as Vertex[];
  const vflags = (v: Vertex): number => v.flags as number;
  // Spline-fit polylines carry their frame (flag 16) beside the fitted vertices (flag 8).
  const drawn = vertices.filter((v) => (vflags(v) & 16) === 0);
  const frame = vertices.filter((v) => (vflags(v) & 16) !== 0);
  const fit =
    (flags & 4) !== 0
      ? (FIT[p.smoothSurface as number] ?? 'cubic')
      : (flags & 2) !== 0
        ? ('curve' as const)
        : undefined;
  const sign = pl === 'down' ? -1 : 1;
  return {
    kind: 'POLYLINE',
    vertices: drawn.map((v) =>
      vertex(
        is3d ? xy(v.location) : planOf(v.location, pl),
        is3d ? 0 : sign * v.bulge,
        v.startWidth,
        v.endWidth,
      ),
    ),
    closed: (flags & 1) !== 0,
    is3d,
    ...(fit ? { fit } : {}),
    ...(frame.length > 0
      ? { frame: frame.map((v) => (is3d ? xy(v.location) : planOf(v.location, pl))) }
      : {}),
    ...(p.startWidth !== 0 ? { startWidth: p.startWidth } : {}),
    ...(p.endWidth !== 0 ? { endWidth: p.endWidth } : {}),
    ...((flags & 128) !== 0 ? { plinegen: true } : {}),
    ...(is3d ? {} : planar(pl, p.normal, p.elevation, p.thickness)),
  };
}

/**
 * The text frame of TEXT, ATTDEF and ATTRIB. Their 10/11 points, rotation and elevation are
 * OCS. Under −Z the frame R(θ)·mirror becomes X·R(θ)·mirror = R(π − θ)·Y·mirror, so the
 * baseline turns to π − θ and the text's own Y flips: `upsideDown` toggles (DEC-039).
 */
function textFields(t: TextEntity, pl: Plane, ctx: Ctx): TextFields {
  const mirror = t.mirror as number;
  const halign = t.horizontalAlignment as number;
  const valign = t.verticalAlignment as number;
  const down = pl === 'down';
  return {
    value: t.value,
    style: ctx.style(t.style),
    position: planOf(t.insertPoint, pl),
    // AutoCAD ignores 11 for left-baseline text and does not write it.
    ...(halign !== 0 || valign !== 0 ? { alignmentPoint: planOf(t.alignmentPoint, pl) } : {}),
    height: t.height,
    rotation: down ? norm(Math.PI - t.rotation) : t.rotation,
    widthFactor: t.widthFactor,
    oblique: t.obliqueAngle,
    halign,
    valign,
    backward: (mirror & 2) !== 0,
    upsideDown: ((mirror & 4) !== 0) !== down,
    ...planar(pl, t.normal, t.insertPoint.z, t.thickness),
  };
}

function attributeFields(a: AttributeBase, pl: Plane, ctx: Ctx): AttributeFields {
  const multiline = (a.attributeType as number) !== 1 && a.mText !== null;
  const mtext = multiline ? mtextGeometry(a.mText!, ctx) : undefined;
  return {
    ...textFields(a, pl, ctx),
    tag: a.tag,
    flags: a.flags as number,
    ...(a.isReallyLocked ? { lockPosition: true } : {}),
    ...(typeof mtext === 'object' ? { mtext } : {}),
  };
}

/**
 * MTEXT's 10 and 11 are WCS, so they need no conversion; a −Z extrusion only reverses the
 * text's Y axis (normal × X), which `upsideDown` records.
 */
function mtextGeometry(m: MText, ctx: Ctx): MTextGeometry | UnmappedEntity['reason'] {
  const pl = plane(m.normal);
  if (pl === 'tilted') return 'tilted plane';
  // No 11 or 50 in the file leaves the direction zero: the text runs along the OCS X axis,
  // which is WCS −X under a −Z extrusion.
  const d = m.alignmentPoint;
  const dir = d.x === 0 && d.y === 0 ? { x: pl === 'down' ? -1 : 1, y: 0 } : d;
  const bg = m.backgroundFillFlags as number;
  const cols = m.columnData;
  return {
    kind: 'MTEXT',
    contents: m.value,
    style: ctx.style(m.style),
    position: xy(m.insertPoint),
    height: m.height,
    width: m.rectangleWidth,
    ...(m.rectangleHeight !== 0 ? { definedHeight: m.rectangleHeight } : {}),
    rotation: norm(Math.atan2(dir.y, dir.x)),
    ...(pl === 'down' ? { upsideDown: true } : {}),
    attachment: m.attachmentPoint as number,
    direction: m.drawingDirection as number,
    lineSpacingStyle: m.lineSpacingStyle as number,
    lineSpacing: m.lineSpacing,
    ...(bg !== 0
      ? {
          background: {
            flags: bg,
            ...(m.backgroundColor ? { color: mapColor(m.backgroundColor) } : {}),
            scale: m.backgroundScale,
            ...(m.backgroundTransparency !== 0 ? { transparency: m.backgroundTransparency } : {}),
          },
        }
      : {}),
    ...(m.hasColumns && cols
      ? {
          columns: {
            type: cols.columnType as number,
            count: cols.columnCount,
            flowReversed: cols.flowReversed,
            autoHeight: cols.autoHeight,
            width: cols.width,
            gutter: cols.gutter,
            heights: [...cols.heights],
          },
        }
      : {}),
    ...(m.insertPoint.z !== 0 ? { elevation: m.insertPoint.z } : {}),
    ...(pl !== 'up' ? { normal: { x: m.normal.x, y: m.normal.y, z: m.normal.z } } : {}),
  };
}

/**
 * The block lands at OCS insert + R(θ)·S·q. Under −Z, OCS (x, y, z) is WCS (−x, y, −z), and
 * that mirror commutes R(θ) to R(−θ) and S to diag(−sx, sy, −sz): an ordinary +Z placement.
 */
function insertGeometry(e: Insert, ctx: Ctx): EntityGeometry | UnmappedEntity['reason'] {
  if (!e.block) return 'missing block';
  const pl = plane(e.normal);
  if (pl === 'tilted') return 'tilted plane';
  const down = pl === 'down';
  const attributes: InsertAttribute[] = [];
  for (const a of e.attributes as unknown as AttributeEntity[]) {
    const apl = plane(a.normal);
    if (apl === 'tilted')
      ctx.report({ handle: hex(a.handle), type: a.objectName, reason: 'tilted plane' });
    else attributes.push({ ...entityProps(a), ...attributeFields(a, apl, ctx) });
  }
  const multiple = e.columnCount > 1 || e.rowCount > 1;
  return {
    kind: 'INSERT',
    block: hex(e.block.handle),
    position: planOf(e.insertPoint, pl),
    scale: down
      ? { x: -e.xScale, y: e.yScale, z: -e.zScale }
      : { x: e.xScale, y: e.yScale, z: e.zScale },
    rotation: down ? norm(-e.rotation) : e.rotation,
    ...(multiple
      ? {
          array: {
            columns: e.columnCount,
            rows: e.rowCount,
            // Columns run along the rotated X axis, which the mirror reverses.
            columnSpacing: down ? -e.columnSpacing : e.columnSpacing,
            rowSpacing: e.rowSpacing,
          },
        }
      : {}),
    attributes,
    ...planar(pl, e.normal, e.insertPoint.z, 0),
  };
}

/** Plan-view geometry of an entity, or why it has none in Triya yet. */
function geometry(e: Entity, ctx: Ctx): EntityGeometry | UnmappedEntity['reason'] {
  if (e instanceof Line) {
    const z = e.startPoint.z === e.endPoint.z ? e.startPoint.z : 0;
    const pl = plane(e.normal);
    return {
      kind: 'LINE',
      start: xy(e.startPoint),
      end: xy(e.endPoint),
      ...(z !== 0 ? { elevation: z } : {}),
      ...(e.thickness !== 0 ? { thickness: e.thickness } : {}),
      ...(pl !== 'up' ? { normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z } } : {}),
    };
  }
  if (e instanceof XLine || e instanceof Ray) {
    const base = e instanceof XLine ? e.firstPoint : e.startPoint;
    const len = Math.hypot(e.direction.x, e.direction.y);
    if (len === 0) return 'no plan view';
    return {
      kind: e instanceof XLine ? 'XLINE' : 'RAY',
      base: xy(base),
      direction: { x: e.direction.x / len, y: e.direction.y / len },
    };
  }
  // Arc extends Circle in acad-ts, so it is tested first.
  if (e instanceof Arc) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    // Mirroring X maps angle θ to π − θ and turns the CCW sweep s→e into π − e → π − s.
    const [s, t] =
      pl === 'down' ? [Math.PI - e.endAngle, Math.PI - e.startAngle] : [e.startAngle, e.endAngle];
    return {
      kind: 'ARC',
      center: planOf(e.center, pl),
      radius: e.radius,
      startAngle: norm(s),
      endAngle: norm(t),
      ...planar(pl, e.normal, e.center.z, e.thickness),
    };
  }
  if (e instanceof Circle) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    return {
      kind: 'CIRCLE',
      center: planOf(e.center, pl),
      radius: e.radius,
      ...planar(pl, e.normal, e.center.z, e.thickness),
    };
  }
  if (e instanceof Ellipse) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    // ELLIPSE is in WCS, but its minor axis is normal × major: under −Z it runs clockwise,
    // so parameter t is the kernel's −t and the CCW range s→e becomes −e → −s.
    const [s, t] =
      pl === 'down' ? [-e.endParameter, -e.startParameter] : [e.startParameter, e.endParameter];
    const full = Math.abs(e.endParameter - e.startParameter - TWO_PI) < 1e-12;
    return {
      kind: 'ELLIPSE',
      center: xy(e.center),
      majorAxis: xy(e.majorAxisEndPoint),
      ratio: e.radiusRatio,
      startParam: full ? 0 : norm(s),
      endParam: full ? TWO_PI : norm(t),
      ...(e.center.z !== 0 ? { elevation: e.center.z } : {}),
      ...(pl !== 'up' ? { normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z } } : {}),
    };
  }
  if (e instanceof Point) {
    const pl = plane(e.normal);
    return {
      kind: 'POINT',
      position: xy(e.location),
      ...(e.rotation !== 0 ? { xAxisAngle: e.rotation } : {}),
      ...(e.location.z !== 0 ? { elevation: e.location.z } : {}),
      ...(e.thickness !== 0 ? { thickness: e.thickness } : {}),
      ...(pl !== 'up' ? { normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z } } : {}),
    };
  }
  if (e instanceof LwPolyline) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    const flags = e.flags as number;
    return {
      kind: 'LWPOLYLINE',
      vertices: lwVertices(e.vertices, pl),
      closed: (flags & 1) !== 0,
      ...(e.constantWidth !== 0 ? { constantWidth: e.constantWidth } : {}),
      ...((flags & 128) !== 0 ? { plinegen: true } : {}),
      ...planar(pl, e.normal, e.elevation, e.thickness),
    };
  }
  if (e instanceof PolyfaceMesh || e instanceof PolygonMesh) return 'not mapped yet';
  if (e instanceof Polyline) return polyline(e);
  if (e instanceof Spline) {
    // Control and fit points are WCS; dropping Z is the plan view of any spline, planar or not.
    const rational = e.weights.length > 0 && e.weights.some((w) => w !== 1);
    const tangent = (t: XYZ) => (t.x !== 0 || t.y !== 0 ? xy(t) : undefined);
    const st = tangent(e.startTangent);
    const et = tangent(e.endTangent);
    const pl = plane(e.normal);
    return {
      kind: 'SPLINE',
      degree: e.degree,
      knots: [...e.knots],
      controlPoints: e.controlPoints.map(xy),
      ...(rational ? { weights: [...e.weights] } : {}),
      ...(e.fitPoints.length > 0 ? { fitPoints: e.fitPoints.map(xy) } : {}),
      ...(st ? { startTangent: st } : {}),
      ...(et ? { endTangent: et } : {}),
      closed: e.isClosed,
      periodic: e.isPeriodic,
      ...(pl !== 'up' && Math.hypot(e.normal.x, e.normal.y, e.normal.z) > 0
        ? { normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z } }
        : {}),
    };
  }
  if (e instanceof Solid) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    const c = [e.firstCorner, e.secondCorner, e.thirdCorner, e.fourthCorner].map((p) =>
      planOf(p, pl),
    );
    return {
      // acad-ts reads TRACE as SOLID (M1-32), so every one is a SOLID here.
      kind: 'SOLID',
      corners: [c[0]!, c[1]!, c[2]!, c[3]!],
      ...planar(pl, e.normal, e.firstCorner.z, e.thickness),
    };
  }
  if (e instanceof Face3D) {
    const c = [e.firstCorner, e.secondCorner, e.thirdCorner, e.fourthCorner].map(xy);
    return {
      kind: '3DFACE',
      corners: [c[0]!, c[1]!, c[2]!, c[3]!],
      hiddenEdges: e.flags as number,
    };
  }
  // AttributeDefinition extends TextEntity, so it is tested first.
  if (e instanceof AttributeDefinition) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    return { kind: 'ATTDEF', ...attributeFields(e, pl, ctx), prompt: e.prompt };
  }
  if (e instanceof TextEntity) {
    const pl = plane(e.normal);
    if (pl === 'tilted') return 'tilted plane';
    return { kind: 'TEXT', ...textFields(e, pl, ctx) };
  }
  if (e instanceof MText) return mtextGeometry(e, ctx);
  // TableEntity extends Insert in acad-ts; tables are mapped with the annotations.
  if (e instanceof TableEntity) return 'not mapped yet';
  if (e instanceof Insert) return insertGeometry(e, ctx);
  return 'not mapped yet';
}

interface Ctx {
  readonly report: (u: UnmappedEntity) => void;
  /** STYLE handle of a text style reference. */
  readonly style: (s: TextStyle) => string;
}

/** The AcDbEntity properties, shared by entities and the ATTRIBs folded into an INSERT. */
function entityProps(e: Entity): EntityProps & ObjectCommon {
  const material = ref(e.material);
  return {
    ...common(e),
    layer: hex(e.layer.handle),
    color: entityColor(e),
    linetype: linetypeRef(e),
    lineweight: mapLineweight(e.lineWeight as number),
    transparency: transparency(e),
    ltScale: e.lineTypeScale,
    visible: !e.isInvisible,
    ...(material ? { material } : {}),
  };
}

function entity(e: Entity, owner: BlockRecord, ctx: Ctx): EntityInit | UnmappedEntity {
  const geom = geometry(e, ctx);
  if (typeof geom === 'string') return { handle: hex(e.handle), type: e.objectName, reason: geom };
  return { ...entityProps(e), type: geom.kind, owner: hex(owner.handle), geom };
}

/** Every entity of every block record, mapped or reported. */
export function mapEntities(doc: CadDocument): MappedEntities {
  const entities: EntityInit[] = [];
  const unmapped: UnmappedEntity[] = [];
  const byName = new Map([...(doc.textStyles ?? [])].map((s) => [s.name.toUpperCase(), s]));
  const ctx: Ctx = {
    report: (u) => unmapped.push(u),
    // acad-ts leaves an ATTRIB that names no style (R12 omits 7 for STANDARD) on its detached
    // default style, whose handle is 0; resolve it by name.
    style: (s) => hex(s.handle !== 0 ? s.handle : (byName.get(s.name.toUpperCase())?.handle ?? 0)),
  };
  for (const block of doc.blockRecords ?? []) {
    for (const e of block.entities) {
      const m = entity(e, block, ctx);
      if ('geom' in m) entities.push(m);
      else unmapped.push(m);
    }
  }
  return { entities, unmapped };
}

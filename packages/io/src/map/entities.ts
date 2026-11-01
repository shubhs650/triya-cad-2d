// AcadToTriya for entities (M1-04, ARCHITECTURE.md §6.1). Each entity of every block record
// (model space, the paper-space layouts and the block definitions) becomes an `EntityInit` in
// plan view (DEC-039). Types not mapped yet, and entities whose plane is tilted, are reported
// in `unmapped` and stay with the retained original only.

import {
  Arc,
  Hatch,
  HatchBoundaryPathArc,
  HatchBoundaryPathEllipse,
  HatchBoundaryPathLine,
  HatchBoundaryPathPolyline,
  HatchBoundaryPathSpline,
  type HatchBoundaryPath,
  type HatchBoundaryPathEdge,
  DimensionAligned,
  DimensionAngular2Line,
  DimensionAngular3Pt,
  DimensionArc,
  DimensionDiameter,
  DimensionLinear,
  DimensionOrdinate,
  DimensionRadius,
  Leader,
  MultiLeader,
  Tolerance,
  type Dimension,
  type DimensionStyle,
  AttributeDefinition,
  Insert,
  MText,
  TableEntity,
  type TableEntityCell,
  CadWipeoutBase,
  PdfUnderlay,
  MLine,
  Region,
  Viewport,
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
  BlockRecord,
  type CadDocument,
  type Entity,
  type TextStyle,
  type Vertex,
  type XYZ,
} from '@node-projects/acad-ts';
import type {
  AttributeFields,
  HatchEdge,
  HatchLoop,
  DimensionFields,
  Color,
  EntityGeometry,
  EntityInit,
  EntityProps,
  InsertAttribute,
  LinetypeRef,
  MTextGeometry,
  MultiLeaderGeometry,
  ObjectCommon,
  TableCell,
  TableGeometry,
  ImageGeometry,
  UnderlayGeometry,
  MLineGeometry,
  RegionGeometry,
  ViewportGeometry,
  PlanarProps,
  TextFields,
  PolylineVertex,
  Transparency,
  Vec2,
} from '@triya/engine';
import { regionBoundary } from '../acis/region';
import { readSab, readSat } from '../acis/records';
import { common, hex, mapColor, mapEntityColor, mapLineweight, ref } from './common';

export interface UnmappedEntity {
  readonly handle: string;
  /** DXF type name. */
  readonly type: string;
  readonly reason:
    | 'not mapped yet'
    | 'tilted plane'
    | 'no plan view'
    | 'missing block'
    /** ACIS data Triya cannot read as a planar boundary (spline edges, missing records). */
    | 'unsupported boundary';
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

/**
 * The AcDbDimension fields. Per the DXF reference 10 and 13–15 are WCS, while 11, 12 and 16
 * and the angles 50–53 are in the OCS; under −Z an OCS angle θ is the WCS angle π − θ.
 */
function dimFields(d: Dimension, pl: Plane, ctx: Ctx): DimensionFields {
  const flags = d.flags as number;
  const block = ref(d.block);
  return {
    style: ctx.dimStyle(d.style),
    ...(block ? { block } : {}),
    definitionPoint: xy(d.definitionPoint),
    textPosition: planOf(d.textMiddlePoint, pl),
    textUserPositioned: (flags & 128) !== 0,
    text: d.text,
    textRotation: ocsAngle(d.textRotation, pl),
    horizontalDirection: ocsAngle(d.horizontalDirection, pl),
    attachment: d.attachmentPoint as number,
    lineSpacingStyle: d.lineSpacingStyle as number,
    lineSpacing: d.lineSpacingFactor,
    ...(d.flipArrow1 || d.flipArrow2 ? { flipArrows: [d.flipArrow1, d.flipArrow2] as const } : {}),
    ...planar(pl, d.normal, d.textMiddlePoint.z, 0),
  };
}

const ocsAngle = (a: number, pl: Plane): number => (pl === 'down' ? norm(Math.PI - a) : a);

function dimensionGeometry(d: Dimension, ctx: Ctx): EntityGeometry | UnmappedEntity['reason'] {
  const pl = plane(d.normal);
  if (pl === 'tilted') return 'tilted plane';
  const f = dimFields(d, pl, ctx);
  // DimensionLinear extends DimensionAligned, so it is tested first.
  if (d instanceof DimensionLinear || d instanceof DimensionAligned) {
    const linear = d instanceof DimensionLinear;
    return {
      ...f,
      kind: 'DIMENSION',
      dimType: linear ? 'linear' : 'aligned',
      first: xy(d.firstPoint),
      second: xy(d.secondPoint),
      ...(linear ? { rotation: ocsAngle(d.rotation, pl) } : {}),
      ...(d.extLineRotation !== 0 ? { oblique: ocsAngle(d.extLineRotation, pl) } : {}),
    };
  }
  if (d instanceof DimensionAngular2Line) {
    return {
      ...f,
      kind: 'DIMENSION',
      dimType: 'angular',
      line1Start: xy(d.firstPoint),
      line1End: xy(d.secondPoint),
      line2Start: xy(d.angleVertex),
      arcPoint: planOf(d.dimensionArc, pl),
    };
  }
  if (d instanceof DimensionAngular3Pt) {
    return {
      ...f,
      kind: 'DIMENSION',
      dimType: 'angular3pt',
      vertex: xy(d.angleVertex),
      first: xy(d.firstPoint),
      second: xy(d.secondPoint),
    };
  }
  if (d instanceof DimensionRadius || d instanceof DimensionDiameter) {
    return {
      ...f,
      kind: 'DIMENSION',
      dimType: d instanceof DimensionRadius ? 'radius' : 'diameter',
      chordPoint: xy(d.angleVertex),
      leaderLength: d.leaderLength,
    };
  }
  if (d instanceof DimensionOrdinate) {
    return {
      ...f,
      kind: 'DIMENSION',
      dimType: 'ordinate',
      axis: d.isOrdinateTypeX ? 'x' : 'y',
      feature: xy(d.featureLocation),
      leaderEnd: xy(d.leaderEndpoint),
    };
  }
  if (d instanceof DimensionArc) {
    return {
      ...f,
      kind: 'ARC_DIMENSION',
      dimType: 'arc',
      first: xy(d.firstPoint),
      second: xy(d.secondPoint),
      center: xy(d.center),
      startAngle: d.startAngle,
      endAngle: d.endAngle,
      partial: d.isPartial,
      ...(d.hasLeader ? { leader: [xy(d.leaderPoint1), xy(d.leaderPoint2)] as const } : {}),
    };
  }
  return 'not mapped yet';
}

/** LEADER vertices and its 211–213 vectors are WCS, so the plan view drops Z. */
function leaderGeometry(l: Leader, ctx: Ctx): EntityGeometry | UnmappedEntity['reason'] {
  const pl = plane(l.normal);
  if (pl === 'tilted') return 'tilted plane';
  const annotation = ref(l.associatedAnnotation);
  const z = l.vertices[0]?.z ?? 0;
  return {
    kind: 'LEADER',
    style: ctx.dimStyle(l.style),
    vertices: l.vertices.map(xy),
    arrowhead: l.arrowHeadEnabled,
    spline: (l.pathType as number) === 1,
    creationType: l.creationType as number,
    ...(l.hasHookline
      ? { hookline: { sameDirection: (l.hookLineDirection as number) === 1 } }
      : {}),
    textHeight: l.textHeight,
    textWidth: l.textWidth,
    ...(annotation ? { annotation } : {}),
    horizontalDirection: xy(l.horizontalDirection),
    blockOffset: xy(l.blockOffset),
    annotationOffset: xy(l.annotationOffset),
    ...(z !== 0 ? { elevation: z } : {}),
    ...(pl !== 'up' ? { normal: { x: l.normal.x, y: l.normal.y, z: l.normal.z } } : {}),
  };
}

/**
 * MULTILEADER points are WCS (DXF reference, MLEADER), so the plan view drops Z. The leader
 * plane is the context data's 110 origin with 111/112 axes; its normal must be ±Z.
 */
function multiLeaderGeometry(
  m: MultiLeader,
  ctx: Ctx,
): MultiLeaderGeometry | UnmappedEntity['reason'] {
  const c = m.contextData;
  const a = c.baseDirection;
  const b = c.baseVertical;
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const pl = plane(n as XYZ);
  if (pl === 'tilted') return 'tilted plane';
  const textPl = plane(c.textNormal);
  const d = c.direction;
  // A zero text direction runs along the OCS X axis of the text normal, as for MTEXT.
  const dir = d.x === 0 && d.y === 0 ? { x: textPl === 'down' ? -1 : 1, y: 0 } : d;
  const style = ref(m.style);
  const linetype = ref(m.leaderLineType);
  const arrowhead = ref(m.arrowhead);
  const block = ref(c.blockContent);
  const z = c.basePoint.z;
  return {
    kind: 'MULTILEADER',
    ...(style ? { style } : {}),
    overrideFlags: m.propertyOverrideFlags as number,
    pathType: m.pathType as number,
    lineColor: mapEntityColor(m.lineColor),
    ...(linetype ? { linetype } : {}),
    lineweight: mapLineweight(m.leaderLineWeight as number),
    landing: m.enableLanding,
    dogleg: m.enableDogleg,
    doglegLength: m.landingDistance,
    ...(arrowhead ? { arrowhead } : {}),
    arrowheadSize: m.arrowheadSize,
    contentType: m.contentType as number,
    scale: m.scaleFactor,
    annotative: m.enableAnnotationScale,
    textLeftAttachment: m.textLeftAttachment as number,
    textRightAttachment: m.textRightAttachment as number,
    textTopAttachment: m.textTopAttachment as number,
    textBottomAttachment: m.textBottomAttachment as number,
    textAttachmentDirection: m.textAttachmentDirection as number,
    textAngleType: m.textAngle as number,
    textAlignment: m.textAlignment as number,
    textFrame: m.textFrame,
    contentBase: xy(c.contentBasePoint),
    landingGap: c.landingGap,
    ...(c.hasTextContents
      ? {
          text: {
            content: c.textLabel,
            style: c.textStyle ? ctx.style(c.textStyle) : '0',
            position: xy(c.textLocation),
            rotation: norm(Math.atan2(dir.y, dir.x)),
            ...(textPl === 'down' ? { upsideDown: true } : {}),
            height: c.textHeight,
            width: c.boundaryWidth,
            boundaryHeight: c.boundaryHeight,
            lineSpacing: c.lineSpacingFactor,
            lineSpacingStyle: c.lineSpacing,
            attachment: c.textAttachmentPoint,
            flow: c.flowDirection,
            color: mapEntityColor(c.textColor),
          },
        }
      : {}),
    ...(c.hasContentsBlock
      ? {
          block: {
            ...(block ? { block } : {}),
            position: xy(c.blockContentLocation),
            scale: { x: c.blockContentScale.x, y: c.blockContentScale.y, z: c.blockContentScale.z },
            rotation: c.blockContentRotation,
            color: mapEntityColor(c.blockContentColor),
          },
        }
      : {}),
    branches: c.leaderRoots.map((r) => ({
      index: r.leaderIndex,
      connection: xy(r.connectionPoint),
      direction: xy(r.direction),
      doglegLength: r.landingDistance,
      lines: r.lines.map((l) => ({ index: l.index, vertices: l.points.map(xy) })),
    })),
    ...(z !== 0 ? { elevation: z } : {}),
    ...(pl !== 'up' ? { normal: { x: n.x, y: n.y, z: n.z } } : {}),
  };
}

/** A cell's value as AutoCAD displays it: the string, else its formatted form. */
function cellText(c: TableEntityCell): string {
  const v = c.content?.cadValue;
  if (!v) return '';
  if (typeof v.value === 'string') return v.value;
  return v.formattedValue || (v.value == null ? '' : String(v.value));
}

/**
 * ACAD_TABLE: the insertion point is OCS (AcDbBlockReference), the horizontal direction WCS.
 * DXF states merges per cell (175/176 spans, 173 merged); DWG states the merged ranges, so the
 * spans are derived from those when there are any.
 */
function tableGeometry(t: TableEntity): TableGeometry | UnmappedEntity['reason'] {
  const pl = plane(t.normal);
  if (pl === 'tilted') return 'tilted plane';
  const head = new Map<string, { rows: number; columns: number }>();
  const covered = new Set<string>();
  for (const r of t.mergedCellRanges) {
    head.set(`${r.topRowIndex},${r.leftColumnIndex}`, {
      rows: r.bottomRowIndex - r.topRowIndex + 1,
      columns: r.rightColumnIndex - r.leftColumnIndex + 1,
    });
    for (let i = r.topRowIndex; i <= r.bottomRowIndex; i++)
      for (let j = r.leftColumnIndex; j <= r.rightColumnIndex; j++)
        if (i !== r.topRowIndex || j !== r.leftColumnIndex) covered.add(`${i},${j}`);
  }
  const ranges = t.mergedCellRanges.length > 0;
  const cells = t.rows.map((row, i) =>
    row.cells.map((c, j): TableCell => {
      const span = head.get(`${i},${j}`);
      // A block cell: DXF states cell type 2 with the block as the cell value (340); DWG
      // states a block content (TableCellContentType 4) holding the block record.
      const k = c.content;
      const isBlock = (c.type as number) === 2 || ((k?.contentType as number) & 4) !== 0;
      const record = k?.blockRecord ?? (c.value instanceof BlockRecord ? c.value : null);
      const block = isBlock ? ref(record) : undefined;
      return {
        type: isBlock ? 'block' : 'text',
        text: isBlock ? '' : cellText(c),
        ...(block ? { block } : {}),
        rowSpan: ranges ? (span?.rows ?? 1) : Math.max(1, c.borderHeight),
        columnSpan: ranges ? (span?.columns ?? 1) : Math.max(1, c.borderWidth),
        merged: ranges ? covered.has(`${i},${j}`) : c.mergedValue !== 0,
        rotation: c.rotation,
      };
    }),
  );
  const style = ref(t.style);
  const block = ref(t.block);
  return {
    kind: 'ACAD_TABLE',
    ...(style ? { style } : {}),
    ...(block ? { block } : {}),
    position: planOf(t.insertPoint, pl),
    direction: xy(t.horizontalDirection),
    rowHeights: t.rows.map((r) => r.height),
    columnWidths: t.columns.map((c) => c.width),
    cells,
    ...planar(pl, t.normal, t.insertPoint.z, 0),
  };
}

/** IMAGE and WIPEOUT points and vectors are WCS; the image plane is u × v. */
function imageGeometry(im: CadWipeoutBase): ImageGeometry | UnmappedEntity['reason'] {
  const a = im.uVector;
  const b = im.vVector;
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const pl = plane(n as XYZ);
  if (pl === 'tilted') return 'tilted plane';
  const definition = ref(im.definition);
  const z = im.insertPoint.z;
  return {
    kind: im.objectName === 'WIPEOUT' ? 'WIPEOUT' : 'IMAGE',
    ...(definition ? { definition } : {}),
    position: xy(im.insertPoint),
    u: xy(a),
    v: xy(b),
    size: xy(im.size),
    displayFlags: im.flags as number,
    clipping: im.clippingState,
    brightness: im.brightness,
    contrast: im.contrast,
    fade: im.fade,
    clip: {
      // acad-ts skips DXF 71 on read (M1-32), but a rectangular boundary always states two
      // corners (DXF reference, IMAGE), so more vertices mean a polygon.
      type:
        (im.clipType as number) === 2 || im.clipBoundaryVertices.length > 2
          ? 'polygon'
          : 'rectangle',
      vertices: im.clipBoundaryVertices.map(xy),
      inverted: (im.clipMode as number) === 1,
    },
    ...(z !== 0 ? { elevation: z } : {}),
    ...(pl !== 'up' ? { normal: { x: n.x, y: n.y, z: n.z } } : {}),
  };
}

/**
 * PDFUNDERLAY: the insertion point is WCS and the rotation is about the normal, so a −Z
 * underlay's X axis lies at π − θ and its Y axis (normal × X) is reversed.
 */
function underlayGeometry(u: PdfUnderlay): UnderlayGeometry | UnmappedEntity['reason'] {
  const pl = plane(u.normal);
  if (pl === 'tilted') return 'tilted plane';
  const definition = ref(u.definition);
  const z = u.insertPoint.z;
  return {
    kind: 'PDFUNDERLAY',
    ...(definition ? { definition } : {}),
    position: xy(u.insertPoint),
    scale: { x: u.xScale, y: u.yScale, z: u.zScale },
    rotation: ocsAngle(u.rotation, pl),
    ...(pl === 'down' ? { upsideDown: true } : {}),
    flags: u.flags as number,
    contrast: u.contrast,
    fade: u.fade,
    clip: u.clipBoundaryVertices.map(xy),
    ...(z !== 0 ? { elevation: z } : {}),
    ...(pl !== 'up' ? { normal: { x: u.normal.x, y: u.normal.y, z: u.normal.z } } : {}),
  };
}

/** MLINE points and directions are WCS (DXF reference, MLINE), so the plan view drops Z. */
function mlineGeometry(m: MLine): MLineGeometry | UnmappedEntity['reason'] {
  const pl = plane(m.normal);
  if (pl === 'tilted') return 'tilted plane';
  const style = ref(m.style);
  const z = m.startPoint.z;
  return {
    kind: 'MLINE',
    ...(style ? { style } : {}),
    scale: m.scaleFactor,
    justification: m.justification as number,
    flags: m.flags as number,
    start: xy(m.startPoint),
    vertices: m.vertices.map((v) => ({
      position: xy(v.position),
      direction: xy(v.direction),
      miter: xy(v.miter),
      elements: v.segments.map((s) => ({
        parameters: [...s.parameters],
        fillParameters: [...s.areaFillParameters],
      })),
    })),
    ...(z !== 0 ? { elevation: z } : {}),
    ...(pl !== 'up' ? { normal: { x: m.normal.x, y: m.normal.y, z: m.normal.z } } : {}),
  };
}

/** REGION: the plan-view boundary of its planar ACIS body (SAT text or SAB binary). */
function regionGeometry(r: Region): RegionGeometry | UnmappedEntity['reason'] {
  let model;
  try {
    const text = r.getAcisText();
    model = text !== null ? readSat(text) : readSab(r.binaryData);
  } catch {
    return 'unsupported boundary';
  }
  const b = regionBoundary(model);
  if (typeof b === 'string') return b;
  return {
    kind: 'REGION',
    loops: b.loops,
    ...(b.elevation !== 0 ? { elevation: b.elevation } : {}),
    ...(b.down ? { normal: { x: 0, y: 0, z: -1 } } : {}),
  };
}

/** VIEWPORT: a paper-space frame and the model-space view it shows (DXF AcDbViewport). */
function viewportGeometry(v: Viewport): ViewportGeometry {
  const clipBoundary = ref(v.boundary);
  const visualStyle = ref(v.visualStyle);
  return {
    kind: 'VIEWPORT',
    center: xy(v.center),
    width: v.width,
    height: v.height,
    id: v.id,
    status: v.activeStatus as number,
    flags: v.status as number,
    viewCenter: xy(v.viewCenter),
    viewHeight: v.viewHeight,
    viewDirection: { x: v.viewDirection.x, y: v.viewDirection.y, z: v.viewDirection.z },
    viewTarget: { x: v.viewTarget.x, y: v.viewTarget.y, z: v.viewTarget.z },
    twist: v.twistAngle,
    lensLength: v.lensLength,
    frontClip: v.frontClipPlane,
    backClip: v.backClipPlane,
    ...(clipBoundary ? { clipBoundary } : {}),
    frozenLayers: v.frozenLayers.map((l) => hex(l.handle)),
    plotStyleSheet: v.styleSheetName,
    renderMode: v.renderMode,
    ...(visualStyle ? { visualStyle } : {}),
  };
}

/** TOLERANCE's 10 and 11 are WCS, so it converts like MTEXT. */
function toleranceGeometry(t: Tolerance, ctx: Ctx): EntityGeometry | UnmappedEntity['reason'] {
  const pl = plane(t.normal);
  if (pl === 'tilted') return 'tilted plane';
  const d = t.direction;
  const dir = d.x === 0 && d.y === 0 ? { x: pl === 'down' ? -1 : 1, y: 0 } : d;
  return {
    kind: 'TOLERANCE',
    style: ctx.dimStyle(t.style),
    position: xy(t.insertionPoint),
    rotation: norm(Math.atan2(dir.y, dir.x)),
    ...(pl === 'down' ? { upsideDown: true } : {}),
    text: t.text,
    ...(t.insertionPoint.z !== 0 ? { elevation: t.insertionPoint.z } : {}),
    ...(pl !== 'up' ? { normal: { x: t.normal.x, y: t.normal.y, z: t.normal.z } } : {}),
  };
}

/**
 * A HATCH boundary edge in plan view. Edges are in the OCS, and AutoCAD stores a clockwise
 * edge's angles negated (DXF 73 = 0). A −Z plane mirrors X: an actual arc angle a becomes
 * π − a and an ellipse parameter t becomes −t, and the edge's direction reverses. With the
 * flag flipped, the stored arc angle becomes a + π and the ellipse parameters stay as they
 * are, for clockwise and counter-clockwise edges alike.
 */
function hatchEdge(e: HatchBoundaryPathEdge, pl: Plane): HatchEdge | undefined {
  const down = pl === 'down';
  const p = (v: { x: number; y: number }) => planOf(v, pl);
  if (e instanceof HatchBoundaryPathLine) return { type: 'line', start: p(e.start), end: p(e.end) };
  if (e instanceof HatchBoundaryPathArc) {
    return {
      type: 'arc',
      center: p(e.center),
      radius: e.radius,
      startAngle: down ? norm(Math.PI + e.startAngle) : e.startAngle,
      endAngle: down ? norm(Math.PI + e.endAngle) : e.endAngle,
      ccw: e.counterClockWise !== down,
    };
  }
  if (e instanceof HatchBoundaryPathEllipse) {
    return {
      type: 'ellipse',
      center: p(e.center),
      majorAxis: p(e.majorAxisEndPoint),
      ratio: e.minorToMajorRatio,
      startAngle: e.startAngle,
      endAngle: e.endAngle,
      ccw: e.counterClockWise !== down,
    };
  }
  if (e instanceof HatchBoundaryPathSpline) {
    const weights = e.controlPoints.map((c) => c.z);
    const tangent = (t: { x: number; y: number }) => (t.x !== 0 || t.y !== 0 ? p(t) : undefined);
    const st = tangent(e.startTangent);
    const et = tangent(e.endTangent);
    return {
      type: 'spline',
      degree: e.degree,
      knots: [...e.knots],
      controlPoints: e.controlPoints.map(p),
      ...(e.isRational ? { weights } : {}),
      periodic: e.isPeriodic,
      ...(e.fitPoints.length > 0 ? { fitPoints: e.fitPoints.map(p) } : {}),
      ...(st ? { startTangent: st } : {}),
      ...(et ? { endTangent: et } : {}),
    };
  }
  return undefined;
}

function hatchLoop(path: HatchBoundaryPath, pl: Plane): HatchLoop {
  const sources = path.entities.map((x) => hex(x.handle));
  const poly = path.edges.find((x) => x instanceof HatchBoundaryPathPolyline);
  const base = {
    flags: path.flags as number,
    ...(sources.length > 0 ? { sources } : {}),
  };
  if (poly) {
    // Polyline loop vertices carry their bulge in Z.
    const vs = poly.vertices.map((v) => ({
      location: v,
      bulge: v.z,
      startWidth: 0,
      endWidth: 0,
    }));
    return { ...base, polyline: { vertices: lwVertices(vs, pl), closed: poly.isClosed } };
  }
  return {
    ...base,
    edges: path.edges.map((x) => hatchEdge(x, pl)).filter((x): x is HatchEdge => x !== undefined),
  };
}

function hatchGeometry(h: Hatch): EntityGeometry | UnmappedEntity['reason'] {
  const pl = plane(h.normal);
  if (pl === 'tilted') return 'tilted plane';
  const g = h.gradientColor;
  return {
    kind: 'HATCH',
    pattern: h.pattern.name,
    solid: h.isSolid,
    associative: h.isAssociative,
    style: h.style as number,
    patternType: h.patternType as number,
    patternAngle: ocsAngle(h.patternAngle, pl),
    patternScale: h.patternScale,
    double: h.isDouble,
    loops: h.paths.map((x) => hatchLoop(x, pl)),
    // The file's pattern lines are already rotated and scaled; mirroring them is exact.
    patternLines: h.pattern.lines.map((l) => ({
      angle: ocsAngle(l.angle, pl),
      base: planOf(l.basePoint, pl),
      offset: planOf(l.offset, pl),
      dashes: [...l.dashLengths],
    })),
    seedPoints: h.seedPoints.map((x) => planOf(x, pl)),
    ...(g.enabled
      ? {
          gradient: {
            name: g.name,
            angle: ocsAngle(g.angle, pl),
            shift: g.shift,
            singleColor: g.isSingleColorGradient,
            tint: g.colorTint,
            colors: g.colors.map((c) => ({ value: c.value, color: mapColor(c.color) })),
          },
        }
      : {}),
    ...planar(pl, h.normal, h.elevation, 0),
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
  // TableEntity extends Insert in acad-ts, so it is tested first.
  if (e instanceof TableEntity) return tableGeometry(e);
  if (e instanceof Insert) return insertGeometry(e, ctx);
  if (
    e instanceof DimensionAligned ||
    e instanceof DimensionAngular2Line ||
    e instanceof DimensionAngular3Pt ||
    e instanceof DimensionRadius ||
    e instanceof DimensionDiameter ||
    e instanceof DimensionOrdinate ||
    e instanceof DimensionArc
  )
    return dimensionGeometry(e, ctx);
  if (e instanceof Leader) return leaderGeometry(e, ctx);
  if (e instanceof MultiLeader) return multiLeaderGeometry(e, ctx);
  if (e instanceof Tolerance) return toleranceGeometry(e, ctx);
  if (e instanceof Hatch) return hatchGeometry(e);
  if (e instanceof CadWipeoutBase) return imageGeometry(e);
  if (e instanceof PdfUnderlay) return underlayGeometry(e);
  if (e instanceof MLine) return mlineGeometry(e);
  if (e instanceof Viewport) return viewportGeometry(e);
  if (e instanceof Region) return regionGeometry(e);
  return 'not mapped yet';
}

interface Ctx {
  readonly report: (u: UnmappedEntity) => void;
  /** STYLE handle of a text style reference. */
  readonly style: (s: TextStyle) => string;
  /** DIMSTYLE handle of a dimension style reference. */
  readonly dimStyle: (s: DimensionStyle) => string;
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
  const dimByName = new Map([...(doc.dimensionStyles ?? [])].map((s) => [s.name.toUpperCase(), s]));
  const ctx: Ctx = {
    report: (u) => unmapped.push(u),
    // acad-ts leaves an ATTRIB that names no style (R12 omits 7 for STANDARD) on its detached
    // default style, whose handle is 0; resolve it by name.
    style: (s) => hex(s.handle !== 0 ? s.handle : (byName.get(s.name.toUpperCase())?.handle ?? 0)),
    dimStyle: (s) =>
      hex(s.handle !== 0 ? s.handle : (dimByName.get(s.name.toUpperCase())?.handle ?? 0)),
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

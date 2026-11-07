// Triya document model types (ARCHITECTURE.md §4.1).
//
// Everything here is an immutable value: entities, records and objects are replaced, never
// edited in place, so a `ChangeSet` can hold the before and after versions by reference and
// undo is exact. `DocumentModel` (document.ts) is the container that owns them.
//
// This file fixes the shapes later tasks fill in. M1-03 maps the table records and header vars
// from acad-ts, M1-04 the entity geometry (adding the remaining `EntityGeometry` members), and
// M1-05 the passthrough store. Fields are added there, not guessed here.

import type {
  Arc,
  Circle,
  Ellipse,
  Line,
  Polyline,
  BulgeVertex as CurveVertex,
  Ray,
  Spline,
  Xline,
} from '../geom/curves';
import type { Vec2, Vec3 } from '../geom/types';
import type { KnotParameterization } from '../geom/fit';
import type { EntityId } from './entity-ids';
import type { Handle } from './handle';

// ── Properties shared by entities ──────────────────────────────────────────────────────────

/**
 * Entity or layer colour. ACI 0 is ByBlock and 256 ByLayer in DXF group 62; they get their own
 * kinds here so code cannot mistake them for real indices. `rgb` covers true colour (420) and
 * colour-book colours (430), which carry their book and colour name for round-trip.
 */
export type Color =
  | { readonly kind: 'byLayer' }
  | { readonly kind: 'byBlock' }
  | { readonly kind: 'aci'; readonly index: number }
  | {
      readonly kind: 'rgb';
      readonly r: number;
      readonly g: number;
      readonly b: number;
      readonly bookName?: string;
      readonly colorName?: string;
    };

/** Hundredths of a millimetre (DXF 370: 0–211), or the three special values -1/-2/-3. */
export type Lineweight = number | 'ByLayer' | 'ByBlock' | 'Default';

/** DXF 440: alpha 0 (clear) – 255 (opaque), or ByLayer/ByBlock. */
export type Transparency = 'ByLayer' | 'ByBlock' | { readonly alpha: number };

/** Linetype reference: a LTYPE record handle, or ByLayer/ByBlock. */
export type LinetypeRef = Handle | 'ByLayer' | 'ByBlock';

/** One extended-data item (DXF 1000–1071), kept with its group code so it writes back as read. */
export interface XdataValue {
  readonly code: number;
  readonly value: string | number | bigint | Vec3 | Uint8Array;
}

/** Xdata for one registered application (APPID record handle). Order is preserved. */
export interface XdataApp {
  readonly appId: Handle;
  readonly values: readonly XdataValue[];
}

export type Xdata = readonly XdataApp[];

/** Annotative scale representations; M4 (annotation) refines this. */
export interface AnnotativeData {
  /** Handles of the SCALE objects this object has a representation for. */
  readonly scales: readonly Handle[];
}

/**
 * Link from a mapped object to its untouched acad-ts original, which stays in the I/O worker
 * (ARCHITECTURE.md §6.2 rule 2). The engine treats it as opaque.
 */
export interface PassthroughRef {
  readonly handle: Handle;
}

/** What every handle-bearing record may carry verbatim from the file. */
export interface ObjectCommon {
  readonly handle: Handle;
  readonly xdata?: Xdata;
  readonly reactors?: readonly Handle[];
  readonly extDict?: Handle;
  readonly raw?: PassthroughRef;
}

// ── Entity geometry ────────────────────────────────────────────────────────────────────────
//
// Curve entities are a kernel curve (geom/curves.ts) plus what the file carries beyond the
// plane, so their `entity.geom` goes straight into kernel functions. POINT, POLYLINE, SOLID,
// TRACE, 3DFACE, the text entities, INSERT and the annotations have shapes of their own.

/**
 * Out-of-plane data, carried so the plan view can say where an entity sat in 3D. Geometry is
 * always the entity's plan view in WCS XY (DEC-039): OCS entities whose extrusion is ±Z are
 * converted exactly (−Z mirrors X), WCS entities drop Z. `elevation` is the WCS Z of the
 * entity's plane when it is not 0, `normal` the extrusion when it is not +Z.
 */
export interface PlanarProps {
  readonly elevation?: number;
  readonly thickness?: number;
  readonly normal?: Vec3;
}

export interface LineGeometry extends Line, PlanarProps {}
export type XlineGeometry = Xline;
export type RayGeometry = Ray;
export interface CircleGeometry extends Circle, PlanarProps {}
export interface ArcGeometry extends Arc, PlanarProps {}
export interface EllipseGeometry extends Ellipse, PlanarProps {}

export interface PointGeometry extends PlanarProps {
  readonly kind: 'POINT';
  readonly position: Vec2;
  /** DXF 50: angle of the X axis of the UCS in effect when the point was drawn (for PDMODE). */
  readonly xAxisAngle?: number;
}

export interface PolylineVertex extends CurveVertex {
  readonly startWidth?: number;
  readonly endWidth?: number;
}

export interface LwPolylineGeometry extends Polyline, PlanarProps {
  readonly vertices: readonly PolylineVertex[];
  readonly constantWidth?: number;
  /** DXF 70 bit 128: linetype generated continuously around vertices. */
  readonly plinegen?: boolean;
}

/** NURBS as stored by AutoCAD; fit data is retained so SPLINEDIT-style edits can use it. */
export interface SplineGeometry extends Spline {
  readonly fitPoints?: readonly Vec2[];
  readonly startTangent?: Vec2;
  readonly endTangent?: Vec2;
  /** How fit points are spaced along the curve (DWG R2013+ knot parameterization); chord when absent. */
  readonly knotParameterization?: KnotParameterization;
  readonly closed: boolean;
  readonly periodic: boolean;
  readonly normal?: Vec3;
}

/**
 * A heavyweight POLYLINE (2D or 3D) with its VERTEX and SEQEND entities folded in; those keep
 * their handles in the retained original. `vertices` are the ones AutoCAD draws: for a
 * spline-fit polyline that is the fitted vertices (VERTEX flag 8), with the frame (flag 16)
 * in `frame`. A 3D polyline is its plan view, with no bulges.
 */
export interface PolylineGeometry extends PlanarProps {
  readonly kind: 'POLYLINE';
  readonly vertices: readonly PolylineVertex[];
  readonly closed: boolean;
  readonly is3d: boolean;
  /** DXF 70 bit 2 (curve fit) or bit 4 with 75 = 5/6/8 (quadratic, cubic, Bezier spline fit). */
  readonly fit?: 'curve' | 'quadratic' | 'cubic' | 'bezier';
  readonly frame?: readonly Vec2[];
  /** DXF 40/41 defaults for vertices that state no width. */
  readonly startWidth?: number;
  readonly endWidth?: number;
  readonly plinegen?: boolean;
}

/**
 * SOLID or TRACE: a filled quadrilateral (a triangle when the third and fourth corners
 * coincide). Corners keep DXF order, so the outline is 1–2–4–3.
 */
export interface SolidGeometry extends PlanarProps {
  readonly kind: 'SOLID' | 'TRACE';
  readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
}

/** 3DFACE in plan view, drawn as its outline; DXF 70 bits 1/2/4/8 hide edges 1–4. */
export interface Face3dGeometry {
  readonly kind: '3DFACE';
  readonly corners: readonly [Vec2, Vec2, Vec2, Vec2];
  readonly hiddenEdges: number;
}

/**
 * The text frame shared by TEXT, ATTDEF and ATTRIB. `rotation` is the WCS angle of the
 * baseline; glyphs are laid out in the frame `rotation · mirror` around the anchor, so a −Z
 * extrusion (which mirrors the OCS in X) shows as the baseline turned to π − θ with
 * `upsideDown` toggled (DEC-039). `halign`/`valign` are DXF 72/73 (74 for ATTDEF) as stored.
 */
export interface TextFields extends PlanarProps {
  readonly value: string;
  /** STYLE record handle. */
  readonly style: Handle;
  /** DXF 10: the first alignment point (the baseline start for left-baseline text). */
  readonly position: Vec2;
  /** DXF 11: the second alignment point, present when the text is not left-baseline. */
  readonly alignmentPoint?: Vec2;
  readonly height: number;
  readonly rotation: number;
  readonly widthFactor: number;
  /** DXF 51, radians. */
  readonly oblique: number;
  /** DXF 72: 0 left, 1 centre, 2 right, 3 aligned, 4 middle, 5 fit. */
  readonly halign: number;
  /** DXF 73: 0 baseline, 1 bottom, 2 middle, 3 top. */
  readonly valign: number;
  /** DXF 71 bit 2: mirrored in the text's own X. */
  readonly backward: boolean;
  /** DXF 71 bit 4: mirrored in the text's own Y. */
  readonly upsideDown: boolean;
}

export interface TextGeometry extends TextFields {
  readonly kind: 'TEXT';
}

/** What an attribute definition and an attribute have beyond their text. */
export interface AttributeFields extends TextFields {
  readonly tag: string;
  /** DXF 70: 1 invisible, 2 constant, 4 verify, 8 preset. */
  readonly flags: number;
  /** DXF 280: position locked within the block. */
  readonly lockPosition?: boolean;
  /** A multiline attribute (DXF 71 = 2 or 4) carries its text as an embedded MTEXT. */
  readonly mtext?: MTextGeometry;
}

export interface AttdefGeometry extends AttributeFields {
  readonly kind: 'ATTDEF';
  readonly prompt: string;
}

/**
 * MTEXT. Its insertion point and X direction are WCS in the file, so `position` is the
 * insertion point without Z and `rotation` the WCS angle of the X direction. Under a −Z
 * extrusion the text's Y axis (normal × X) points the other way, which `upsideDown` says;
 * MTEXT has no DXF mirror flag, so it only ever comes from the extrusion.
 */
export interface MTextGeometry extends PlanarProps {
  readonly kind: 'MTEXT';
  /** The contents with their formatting codes, as stored (DXF 1 and 3). */
  readonly contents: string;
  readonly style: Handle;
  readonly position: Vec2;
  readonly height: number;
  /** DXF 41: reference rectangle width (0 = no wrapping). */
  readonly width: number;
  /** DXF 46: defined height, when set. */
  readonly definedHeight?: number;
  readonly rotation: number;
  readonly upsideDown?: boolean;
  /** DXF 71: 1–9, top-left to bottom-right. */
  readonly attachment: number;
  /** DXF 72: 1 left to right, 3 top to bottom, 5 by style. */
  readonly direction: number;
  /** DXF 73: 1 at least, 2 exact. */
  readonly lineSpacingStyle: number;
  /** DXF 44. */
  readonly lineSpacing: number;
  /** DXF 90 flags (1 colour, 2 drawing window colour, 16 frame) with 63/421, 45, 441. */
  readonly background?: {
    readonly flags: number;
    readonly color?: Color;
    readonly scale: number;
    readonly transparency?: number;
  };
  readonly columns?: {
    /** DXF 75: 1 static, 2 dynamic. */
    readonly type: number;
    readonly count: number;
    readonly flowReversed: boolean;
    readonly autoHeight: boolean;
    readonly width: number;
    readonly gutter: number;
    readonly heights: readonly number[];
  };
}

/** An ATTRIB, folded into its INSERT; it keeps its own handle and entity properties. */
export interface InsertAttribute extends AttributeFields, EntityProps, ObjectCommon {}

/**
 * INSERT or MINSERT in plan view: the block's WCS placement is position · rotation · scale.
 * A −Z extrusion is folded in exactly (DEC-039): OCS (x, y, z) is WCS (−x, y, −z), so the
 * placement becomes the mirrored position, rotation −θ and scale (−sx, sy, −sz), and `normal`
 * only records where it came from.
 */
export interface InsertGeometry extends PlanarProps {
  readonly kind: 'INSERT';
  /** BLOCK_RECORD handle. */
  readonly block: Handle;
  readonly position: Vec2;
  readonly scale: Vec3;
  readonly rotation: number;
  /** MINSERT: DXF 70/71 counts and 44/45 spacing, along the rotated (unscaled) axes. */
  readonly array?: {
    readonly columns: number;
    readonly rows: number;
    readonly columnSpacing: number;
    readonly rowSpacing: number;
  };
  /** The ATTRIBs that follow the INSERT, in file order (SEQEND folded in, as for POLYLINE). */
  readonly attributes: readonly InsertAttribute[];
}

/**
 * What every DIMENSION shares (DXF AcDbDimension). Points keep the DXF reference's frames
 * converted to plan view (DEC-039): 10 and 13–15 are WCS, 11, 12 and 16 OCS; angles are WCS
 * angles in plan. DIMSTYLE overrides stay in the entity's ACAD `DSTYLE` xdata as read.
 */
export interface DimensionFields extends PlanarProps {
  /** DIMSTYLE record handle (DXF 3). */
  readonly style: Handle;
  /** BLOCK_RECORD of the anonymous `*D` block holding the dimension's last drawn graphics. */
  readonly block?: Handle;
  /** DXF 10: the dimension line's definition point (meaning per type). */
  readonly definitionPoint: Vec2;
  /** DXF 11: middle of the dimension text. */
  readonly textPosition: Vec2;
  /** DXF 70 bit 128: the text was moved by the user. */
  readonly textUserPositioned: boolean;
  /** DXF 1: '' for the measurement, otherwise the override with `<>` for the measurement. */
  readonly text: string;
  /** DXF 53. */
  readonly textRotation: number;
  /** DXF 51: the dimension's horizontal direction. */
  readonly horizontalDirection: number;
  readonly attachment: number;
  readonly lineSpacingStyle: number;
  readonly lineSpacing: number;
  /** DXF 74/75 (R2007+): arrowheads flipped. */
  readonly flipArrows?: readonly [boolean, boolean];
}

export type DimensionGeometry = DimensionFields &
  (
    | {
        readonly kind: 'DIMENSION';
        /** DXF 70 type 0 (rotated, with `rotation` 50) or 1 (aligned). */
        readonly dimType: 'linear' | 'aligned';
        /** DXF 13 and 14: the extension line origins. */
        readonly first: Vec2;
        readonly second: Vec2;
        readonly rotation?: number;
        /** DXF 52: oblique angle of the extension lines, when set. */
        readonly oblique?: number;
      }
    | {
        readonly kind: 'DIMENSION';
        /** Two-line angular: lines 13→14 and 15→10, arc through 16. */
        readonly dimType: 'angular';
        readonly line1Start: Vec2;
        readonly line1End: Vec2;
        readonly line2Start: Vec2;
        readonly arcPoint: Vec2;
      }
    | {
        readonly kind: 'DIMENSION';
        /** Three-point angular: vertex 15, ends 13 and 14, arc through 10. */
        readonly dimType: 'angular3pt';
        readonly vertex: Vec2;
        readonly first: Vec2;
        readonly second: Vec2;
      }
    | {
        readonly kind: 'DIMENSION';
        /** Radius (10 the centre) or diameter (10 the far chord point); 15 the chord point. */
        readonly dimType: 'radius' | 'diameter';
        readonly chordPoint: Vec2;
        readonly leaderLength: number;
      }
    | {
        readonly kind: 'DIMENSION';
        /** Ordinate: 10 the UCS origin, 13 the feature, 14 the leader end; 70 bit 64 = X. */
        readonly dimType: 'ordinate';
        readonly axis: 'x' | 'y';
        readonly feature: Vec2;
        readonly leaderEnd: Vec2;
      }
    | {
        readonly kind: 'LARGE_RADIAL_DIMENSION';
        /** Jogged radius (M1-34): 10 the centre, 15 the chord point on the arc. */
        readonly dimType: 'jogged';
        readonly chordPoint: Vec2;
        /** DXF 13: the displaced centre the dimension line starts from. */
        readonly overrideCenter: Vec2;
        /** DXF 14: the jog point. */
        readonly jogPoint: Vec2;
        /** DXF 40. */
        readonly leaderLength: number;
      }
    | {
        readonly kind: 'ARC_DIMENSION';
        readonly dimType: 'arc';
        /** DXF 13/14: the arc's ends; 15 its centre. */
        readonly first: Vec2;
        readonly second: Vec2;
        readonly center: Vec2;
        /** DXF 40/41, as stored. */
        readonly startAngle: number;
        readonly endAngle: number;
        readonly partial: boolean;
        /** DXF 71 with 16/17. */
        readonly leader?: readonly [Vec2, Vec2];
      }
  );

/** LEADER (DXF AcDbLeader). Vertices are WCS; their plan view drops Z. */
export interface LeaderGeometry extends PlanarProps {
  readonly kind: 'LEADER';
  /** DIMSTYLE record handle (DXF 3). */
  readonly style: Handle;
  readonly vertices: readonly Vec2[];
  /** DXF 71. */
  readonly arrowhead: boolean;
  /** DXF 72: path drawn as a spline. */
  readonly spline: boolean;
  /** DXF 73: 0 MTEXT, 1 TOLERANCE, 2 block reference, 3 none. */
  readonly creationType: number;
  /** DXF 75/74: a hook line, and whether it runs along the horizontal direction (1). */
  readonly hookline?: { readonly sameDirection: boolean };
  readonly textHeight: number;
  readonly textWidth: number;
  /** DXF 340: the MTEXT, TOLERANCE or INSERT it annotates. */
  readonly annotation?: Handle;
  /** DXF 211, 212, 213. */
  readonly horizontalDirection: Vec2;
  readonly blockOffset: Vec2;
  readonly annotationOffset: Vec2;
}

/** TOLERANCE (feature control frame). 10 and 11 are WCS, as for MTEXT. */
export interface ToleranceGeometry extends PlanarProps {
  readonly kind: 'TOLERANCE';
  /** DIMSTYLE record handle (DXF 3). */
  readonly style: Handle;
  readonly position: Vec2;
  /** WCS angle of the X direction (DXF 11). */
  readonly rotation: number;
  /** Under a −Z extrusion the frame's Y axis (normal × X) is reversed. */
  readonly upsideDown?: boolean;
  /** DXF 1: the frame contents with their `%%v` and font codes. */
  readonly text: string;
}

/** One leader line of a MULTILEADER branch (DXF `LEADER_LINE{`). Points are WCS. */
export interface MultiLeaderLine {
  /** DXF 91. */
  readonly index: number;
  /** DXF 10, from the arrowhead end towards the branch's connection point, which is not repeated. */
  readonly vertices: readonly Vec2[];
}

/** One branch of a MULTILEADER (DXF `LEADER{`): its leader lines and their landing. */
export interface MultiLeaderBranch {
  /** DXF 90. */
  readonly index: number;
  /** DXF 10: where the lines meet the landing (dogleg). */
  readonly connection: Vec2;
  /** DXF 11: the landing's direction, away from the content. */
  readonly direction: Vec2;
  /** DXF 40. */
  readonly doglegLength: number;
  readonly lines: readonly MultiLeaderLine[];
}

/** The MTEXT content of a MULTILEADER (DXF context data). Points are WCS. */
export interface MultiLeaderText {
  /** DXF 304, with MTEXT format codes. */
  readonly content: string;
  /** STYLE record handle (DXF 340 in the context data). */
  readonly style: Handle;
  /** DXF 12. */
  readonly position: Vec2;
  /** WCS angle of the text direction (DXF 13). */
  readonly rotation: number;
  /** The text normal (DXF 11) is −Z: the text's Y axis is reversed, as for MTEXT. */
  readonly upsideDown?: boolean;
  /** DXF 41. */
  readonly height: number;
  /** DXF 43 / 44: 0 means not wrapped. */
  readonly width: number;
  readonly boundaryHeight: number;
  /** DXF 45 / 170: line spacing factor and style (1 at least, 2 exactly). */
  readonly lineSpacing: number;
  readonly lineSpacingStyle: number;
  /** DXF 171: MTEXT attachment point 1–9. */
  readonly attachment: number;
  /** DXF 172: MTEXT drawing direction. */
  readonly flow: number;
  /** DXF 90. */
  readonly color: Color;
}

/** The block content of a MULTILEADER (DXF context data). Points are WCS. */
export interface MultiLeaderBlock {
  /** BLOCK_RECORD handle (DXF 341 in the context data). */
  readonly block?: Handle;
  /** DXF 15. */
  readonly position: Vec2;
  /** DXF 16. */
  readonly scale: Vec3;
  /** DXF 46, radians. */
  readonly rotation: number;
  /** DXF 93. */
  readonly color: Color;
}

/**
 * MULTILEADER (DXF reference, MLEADER). All points are WCS, so the plan view drops Z; the
 * leader plane (context data 110/111/112) must be ±Z. Style-level values the entity
 * overrides are flagged in `overrideFlags` (DXF 90) and stored as the file states them.
 */
export interface MultiLeaderGeometry extends PlanarProps {
  readonly kind: 'MULTILEADER';
  /** MLEADERSTYLE handle (DXF 340). */
  readonly style?: Handle;
  /** DXF 90: which properties override the style. */
  readonly overrideFlags: number;
  /** DXF 170: 0 invisible, 1 straight, 2 spline. */
  readonly pathType: number;
  /** DXF 91 / 341 / 171. */
  readonly lineColor: Color;
  readonly linetype?: Handle;
  readonly lineweight: Lineweight;
  /** DXF 290 / 291 / 41. */
  readonly landing: boolean;
  readonly dogleg: boolean;
  readonly doglegLength: number;
  /** BLOCK_RECORD handle of the arrowhead (DXF 342); none means closed filled. */
  readonly arrowhead?: Handle;
  /** DXF 42. */
  readonly arrowheadSize: number;
  /** Context data DXF 140: the arrowhead size it was last drawn at, overall scale applied. */
  readonly drawnArrowheadSize?: number;
  /** DXF 172: 0 none, 1 block, 2 mtext, 3 tolerance. */
  readonly contentType: number;
  /** DXF 45: overall scale. */
  readonly scale: number;
  /** DXF 293. */
  readonly annotative: boolean;
  /** DXF 173 / 95 / 273 / 272: attachment of the text to the landing. */
  readonly textLeftAttachment: number;
  readonly textRightAttachment: number;
  readonly textTopAttachment: number;
  readonly textBottomAttachment: number;
  /** DXF 271: 0 horizontal, 1 vertical. */
  readonly textAttachmentDirection: number;
  /** DXF 174 / 175. */
  readonly textAngleType: number;
  readonly textAlignment: number;
  /** DXF 292. */
  readonly textFrame: boolean;
  /** DXF 10 in the context data: where the content attaches. */
  readonly contentBase: Vec2;
  /** DXF 145. */
  readonly landingGap: number;
  readonly text?: MultiLeaderText;
  readonly block?: MultiLeaderBlock;
  readonly branches: readonly MultiLeaderBranch[];
}

/**
 * IMAGE or WIPEOUT (DXF AcDbRasterImage / AcDbWipeout). Its points and vectors are WCS, so the
 * plan view drops Z; the image plane (u × v) must be ±Z.
 */
export interface ImageGeometry extends PlanarProps {
  readonly kind: 'IMAGE' | 'WIPEOUT';
  /** IMAGEDEF handle (DXF 340); a WIPEOUT has none. */
  readonly definition?: Handle;
  /** DXF 10: the lower-left corner of the image. */
  readonly position: Vec2;
  /** DXF 11 / 12: one pixel's width and height along the image's U and V axes. */
  readonly u: Vec2;
  readonly v: Vec2;
  /** DXF 13: the image size in pixels. */
  readonly size: Vec2;
  /** DXF 70: 1 show, 2 show unaligned, 4 clip, 8 transparent. */
  readonly displayFlags: number;
  /** DXF 280. */
  readonly clipping: boolean;
  /** DXF 281 / 282 / 283, 0–100. */
  readonly brightness: number;
  readonly contrast: number;
  readonly fade: number;
  /**
   * DXF 71 / 14 / 290: the clip boundary in pixel coordinates; a rectangle states two
   * opposite corners. `inverted` keeps the outside (290 = 1).
   */
  readonly clip: {
    readonly type: 'rectangle' | 'polygon';
    readonly vertices: readonly Vec2[];
    readonly inverted: boolean;
  };
}

/**
 * PDFUNDERLAY (DXF AcDbUnderlayReference). The insertion point is WCS; the rotation is about
 * the normal, so under −Z it becomes π − θ and the underlay's Y axis is reversed.
 */
export interface UnderlayGeometry extends PlanarProps {
  readonly kind: 'PDFUNDERLAY';
  /** PDFDEFINITION handle (DXF 340). */
  readonly definition?: Handle;
  /** DXF 10. */
  readonly position: Vec2;
  /** DXF 41 / 42 / 43. */
  readonly scale: Vec3;
  /** WCS angle of the underlay's X axis (DXF 50 about 210). */
  readonly rotation: number;
  readonly upsideDown?: boolean;
  /** DXF 280: 1 clipping, 2 on, 4 monochrome, 8 adjust for background. */
  readonly flags: number;
  /** DXF 281 / 282. */
  readonly contrast: number;
  readonly fade: number;
  /** DXF 11: clip boundary vertices in the underlay's own coordinates. */
  readonly clip: readonly Vec2[];
}

/** One vertex of an MLINE (DXF 11–13 and its element parameters). Points are WCS. */
export interface MLineVertex {
  readonly position: Vec2;
  /** DXF 12: the direction of the segment that starts here. */
  readonly direction: Vec2;
  /** DXF 13: the miter direction. */
  readonly miter: Vec2;
  /** Per style element (DXF 74/41 and 75/42): its parameters and its area-fill parameters. */
  readonly elements: readonly {
    readonly parameters: readonly number[];
    readonly fillParameters: readonly number[];
  }[];
}

/** MLINE (DXF AcDbMline). All points are WCS, so the plan view drops Z; the plane must be ±Z. */
export interface MLineGeometry extends PlanarProps {
  readonly kind: 'MLINE';
  /** MLINESTYLE handle (DXF 340). */
  readonly style?: Handle;
  /** DXF 40. */
  readonly scale: number;
  /** DXF 70: 0 top, 1 zero, 2 bottom. */
  readonly justification: number;
  /** DXF 71: 1 has vertices, 2 closed, 4 suppress start caps, 8 suppress end caps. */
  readonly flags: number;
  /** DXF 10. */
  readonly start: Vec2;
  readonly vertices: readonly MLineVertex[];
}

/** One boundary loop of a REGION face, in coedge order. */
export interface RegionLoop {
  /** Index of the face the loop bounds, counted over the whole region. */
  readonly face: number;
  /** Arcs and ellipses run counter-clockwise in plan view, as kernel curves do. */
  readonly edges: readonly (Line | Arc | Circle | Ellipse)[];
}

/**
 * REGION: a planar ACIS body (DXF AcDbModelerGeometry), read as the plan-view boundary of
 * its faces. The ACIS data itself stays in the retained original.
 */
export interface RegionGeometry extends PlanarProps {
  readonly kind: 'REGION';
  readonly loops: readonly RegionLoop[];
}

/**
 * OLE2FRAME: an embedded or linked OLE object, drawn as its frame (Triya never runs OLE
 * servers). Corners are WCS (DXF 10 and 11).
 */
export interface OleFrameGeometry extends PlanarProps {
  readonly kind: 'OLE2FRAME';
  readonly upperLeft: Vec2;
  readonly lowerRight: Vec2;
  /** DXF 71: 1 link, 2 embedded, 3 static. */
  readonly oleType: number;
  /** DXF 72: the object lives in paper space. */
  readonly paperSpace: boolean;
  readonly application: string;
}

/**
 * ACAD_PROXY_ENTITY: an object of an application Triya does not have, drawn from the proxy
 * graphics its application saved. Curves are WCS plan view; what has no plan-view curve (text,
 * meshes, shells, circles on tilted planes) is counted in `skipped` and stays in the original.
 */
export interface ProxyGraphicsGeometry {
  readonly kind: 'ACAD_PROXY_ENTITY';
  /** The custom object's DXF class name, when its class is known. */
  readonly className?: string;
  /** The extents the application stated, in plan view. */
  readonly extents?: { readonly min: Vec2; readonly max: Vec2 };
  readonly curves: readonly (Line | Circle | Arc | Polyline)[];
  readonly skipped: number;
}

/**
 * VIEWPORT (DXF AcDbViewport). Its frame lives in its layout's paper space; the view it shows
 * is stated in model space (view direction, target, twist) and display coordinates (center).
 */
export interface ViewportGeometry {
  readonly kind: 'VIEWPORT';
  /** DXF 10 / 40 / 41: the frame in paper space. */
  readonly center: Vec2;
  readonly width: number;
  readonly height: number;
  /** DXF 69: 1 is the layout's own paper-space view. */
  readonly id: number;
  /**
   * DXF 68: 0 not active (off, or in a layout that is not current), −1 on but past MAXACTVP,
   * otherwise on and its stacking order. Whether it is off is the 90 flag (see viewportShowsModel).
   */
  readonly status: number;
  /** DXF 90: viewport status bit flags. */
  readonly flags: number;
  /** DXF 12 (display coordinates) / 45: the view's center and height. */
  readonly viewCenter: Vec2;
  readonly viewHeight: number;
  /** DXF 16 / 17: view direction from the target, and the target, in WCS. */
  readonly viewDirection: Vec3;
  readonly viewTarget: Vec3;
  /** DXF 51, radians. */
  readonly twist: number;
  /** DXF 42 / 43 / 44. */
  readonly lensLength: number;
  readonly frontClip: number;
  readonly backClip: number;
  /** DXF 340: the entity that clips the viewport, when it is not rectangular. */
  readonly clipBoundary?: Handle;
  /** DXF 341: LAYER handles frozen in this viewport. */
  readonly frozenLayers: readonly Handle[];
  /** DXF 1. */
  readonly plotStyleSheet: string;
  /** DXF 281. */
  readonly renderMode: number;
  /** DXF 348. */
  readonly visualStyle?: Handle;
}

/** One cell of an ACAD_TABLE, in row-major order. */
export interface TableCell {
  /** DXF 171: 1 text, 2 block. */
  readonly type: 'text' | 'block';
  /** The cell's value as text (DXF 1 with its 2 chunks), with MTEXT format codes. */
  readonly text: string;
  /** BLOCK_RECORD handle of a block cell (DXF 340). */
  readonly block?: Handle;
  /**
   * Rows and columns the cell spans when it heads a merged range. DXF states them per cell
   * (176 / 175); DWG states the merged ranges, from which they are derived.
   */
  readonly rowSpan: number;
  readonly columnSpan: number;
  /** Covered by a merged range headed by another cell (DXF 173). */
  readonly merged: boolean;
  /** DXF 145, radians. */
  readonly rotation: number;
  /** What the cell overrides of its table style, its row's and column's folded in; absent when nothing. */
  readonly format?: TableCellFormat;
}

/**
 * One edge of a table cell as a cell, row or column override states it. Only overridden
 * properties are present. A visibility override that keeps the edge shown is not kept:
 * AutoCAD sets it beside every colour or lineweight override, and an R2000/R2004 DXF cannot
 * state it for the bottom and left edges (its flag word, 177, is 16-bit).
 */
export interface TableBorderFormat {
  readonly color?: Color;
  /** DXF 27x. */
  readonly lineweight?: Lineweight;
  readonly hidden?: true;
}

/**
 * The formatting a table cell overrides (M1-36), normalised across the two ways files state it:
 * DXF and DWG up to R2007 give one flag word per cell (DXF 177 / 91) with the values in 170,
 * 63, 64, 283, 7, 140 and 27x / 6x, already folded from rows and columns; DWG R2010 and later
 * give cell, row and column cell styles and per-content formats, which the mapper folds the same
 * way (content over cell over row over column). Table-wide overrides are `TableGeometry.overrides`.
 */
export interface TableCellFormat {
  /** 1 top left … 9 bottom right (DXF 170). */
  readonly alignment?: number;
  /** STYLE handle (DXF 7). */
  readonly textStyle?: Handle;
  /** DXF 140. */
  readonly textHeight?: number;
  /** DXF 64. */
  readonly contentColor?: Color;
  /** The background fill colour (DXF 63), or null for no fill (DXF 283 = 1). */
  readonly background?: Color | null;
  readonly borders?: {
    readonly top?: TableBorderFormat;
    readonly right?: TableBorderFormat;
    readonly bottom?: TableBorderFormat;
    readonly left?: TableBorderFormat;
  };
  /**
   * Cell margins (DWG R2010+ only; DXF states margins for the whole table, 40 / 41). A margin
   * equal to the table's own is not an override and is left out.
   */
  readonly margins?: {
    readonly left?: number;
    readonly top?: number;
    readonly right?: number;
    readonly bottom?: number;
  };
}

/** What a table overrides of its style for one row type (title, header or data rows). */
export type TableRowFormat = Pick<
  TableCellFormat,
  'alignment' | 'textStyle' | 'textHeight' | 'contentColor' | 'background'
>;

/**
 * What a table overrides of its table style for the whole table (M1-77), as against one cell
 * (`TableCell.format`). DXF and DWG up to R2007 state a horizontal and a vertical cell margin
 * (DXF 40 / 41, the left and right, top and bottom margins here) and per row type the text
 * style, height, alignment, content colour and fill (93 and the values after it). DWG R2010+
 * states the margins as the table's own cell style and the row-type values as each row's: a
 * value every row of a type overrides alike is that type's. Each row type's values are also
 * in the format of each of its cells, which is what a cell is drawn with. Border overrides
 * (94–96) are not mapped yet (M1-81).
 */
export interface TableOverrides {
  readonly margins?: TableCellFormat['margins'];
  readonly title?: TableRowFormat;
  readonly header?: TableRowFormat;
  readonly data?: TableRowFormat;
}

/**
 * ACAD_TABLE. The anonymous `*T` block it references draws the table as AutoCAD last
 * regenerated it; the rows, columns and cells are its editable content. The insertion point
 * is OCS, as for INSERT; the horizontal direction (DXF 11) is WCS, as for MTEXT.
 */
export interface TableGeometry extends PlanarProps {
  readonly kind: 'ACAD_TABLE';
  /** TABLESTYLE handle (DXF 342). */
  readonly style?: Handle;
  /** BLOCK_RECORD handle of the `*T` block (DXF 343 / 2). */
  readonly block?: Handle;
  /** DXF 10. */
  readonly position: Vec2;
  /** DXF 11. */
  readonly direction: Vec2;
  /** DXF 141 / 142. */
  readonly rowHeights: readonly number[];
  readonly columnWidths: readonly number[];
  /** `cells[row][column]`. */
  readonly cells: readonly (readonly TableCell[])[];
  /** Table-wide overrides of the table style; absent when none. */
  readonly overrides?: TableOverrides;
  /**
   * Where each row came from once rows are inserted or deleted (the table engine's Insert Rows
   * and Delete Rows, M4-05): the index of the row in the table as the file states it, or null
   * for a row inserted since, in increasing order. Absent while the rows are the file's, in
   * order. Rows and cells have no identity in DWG or DXF, so a save needs it to keep what each
   * row and cell holds that Triya does not map (DEC-046); a save re-bases the model, and the
   * table maps without it again.
   */
  readonly rowOrigins?: readonly (number | null)[];
  /** `rowOrigins` for the columns (Insert Columns and Delete Columns). */
  readonly columnOrigins?: readonly (number | null)[];
}

/**
 * One edge of a HATCH boundary loop, in the hatch's plane (plan view, DEC-039). Arc and
 * ellipse angles keep the DXF convention: with `ccw` false AutoCAD stores the clockwise
 * edge's angles negated. A −Z plane reverses every edge, so the mapper flips `ccw`, adds π
 * to arc angles and keeps ellipse parameters.
 */
export type HatchEdge =
  | { readonly type: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | {
      readonly type: 'arc';
      readonly center: Vec2;
      readonly radius: number;
      readonly startAngle: number;
      readonly endAngle: number;
      readonly ccw: boolean;
    }
  | {
      readonly type: 'ellipse';
      readonly center: Vec2;
      /** Major axis end point relative to the centre. */
      readonly majorAxis: Vec2;
      readonly ratio: number;
      readonly startAngle: number;
      readonly endAngle: number;
      readonly ccw: boolean;
    }
  | {
      readonly type: 'spline';
      readonly degree: number;
      readonly knots: readonly number[];
      readonly controlPoints: readonly Vec2[];
      readonly weights?: readonly number[];
      readonly periodic: boolean;
      readonly fitPoints?: readonly Vec2[];
      readonly startTangent?: Vec2;
      readonly endTangent?: Vec2;
    };

/** A HATCH boundary loop: a polyline (flag 2) or a list of edges. */
export interface HatchLoop {
  /** DXF 92: 1 external, 2 polyline, 4 derived, 8 text box, 16 outermost, … */
  readonly flags: number;
  readonly polyline?: { readonly vertices: readonly PolylineVertex[]; readonly closed: boolean };
  readonly edges?: readonly HatchEdge[];
  /** DXF 330: the boundary objects of an associative hatch. */
  readonly sources?: readonly Handle[];
}

/** A pattern definition line, already scaled and rotated as the file stores it (DXF 53–49). */
export interface HatchPatternLine {
  readonly angle: number;
  readonly base: Vec2;
  readonly offset: Vec2;
  readonly dashes: readonly number[];
}

export interface HatchGeometry extends PlanarProps {
  readonly kind: 'HATCH';
  /** DXF 2. */
  readonly pattern: string;
  /** DXF 70. */
  readonly solid: boolean;
  /** DXF 71. */
  readonly associative: boolean;
  /** DXF 75: 0 normal (odd parity), 1 outer, 2 ignore. */
  readonly style: number;
  /** DXF 76: 0 user-defined, 1 predefined, 2 custom. */
  readonly patternType: number;
  readonly patternAngle: number;
  readonly patternScale: number;
  /** DXF 77: user-defined pattern doubled. */
  readonly double: boolean;
  readonly loops: readonly HatchLoop[];
  readonly patternLines: readonly HatchPatternLine[];
  readonly seedPoints: readonly Vec2[];
  /** DXF 450–470, when the hatch is a gradient fill. */
  readonly gradient?: {
    readonly name: string;
    readonly angle: number;
    readonly shift: number;
    readonly singleColor: boolean;
    readonly tint: number;
    readonly colors: readonly { readonly value: number; readonly color: Color }[];
  };
}

export type EntityGeometry =
  | LineGeometry
  | XlineGeometry
  | RayGeometry
  | CircleGeometry
  | ArcGeometry
  | EllipseGeometry
  | PointGeometry
  | LwPolylineGeometry
  | PolylineGeometry
  | SplineGeometry
  | SolidGeometry
  | Face3dGeometry
  | TextGeometry
  | MTextGeometry
  | AttdefGeometry
  | InsertGeometry
  | DimensionGeometry
  | LeaderGeometry
  | ToleranceGeometry
  | MultiLeaderGeometry
  | TableGeometry
  | ImageGeometry
  | UnderlayGeometry
  | MLineGeometry
  | ViewportGeometry
  | RegionGeometry
  | OleFrameGeometry
  | ProxyGraphicsGeometry
  | HatchGeometry;

/** DXF entity type name; always equal to `geom.kind`. */
export type EntityType = EntityGeometry['kind'];

// ── Entities ───────────────────────────────────────────────────────────────────────────────

/** Common entity properties (DXF AcDbEntity). */
export interface EntityProps {
  readonly layer: Handle;
  readonly color: Color;
  readonly linetype: LinetypeRef;
  readonly lineweight: Lineweight;
  readonly transparency: Transparency;
  readonly ltScale: number;
  readonly visible: boolean;
  readonly plotStyle?: Handle;
  readonly material?: Handle;
  readonly annotative?: AnnotativeData;
}

export interface Entity extends EntityProps, ObjectCommon {
  readonly id: EntityId;
  readonly type: EntityType;
  /** BLOCK_RECORD handle of the block (model space, a layout, or a block definition) holding it. */
  readonly owner: Handle;
  readonly geom: EntityGeometry;
}

/** An entity before it has a runtime id (what the importer and `createEntity` take). */
export type EntityInit = Omit<Entity, 'id'>;

// ── Tables ─────────────────────────────────────────────────────────────────────────────────

export interface SymbolTableRecord extends ObjectCommon {
  readonly name: string;
  /** DXF 70 standard flags, kept as read (xref-dependent bits and so on). */
  readonly flags?: number;
}

export interface LayerRecord extends SymbolTableRecord {
  readonly color: Color;
  readonly linetype: Handle;
  readonly lineweight: Lineweight;
  readonly transparency: Transparency;
  readonly plot: boolean;
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly plotStyle?: Handle;
  readonly material?: Handle;
}

/** One dash, gap or dot of a linetype (DXF 49), with its optional shape or text (74–75, 340, 9). */
export interface LinetypeElement {
  /** Dash > 0, gap < 0, dot 0, in drawing units before LTSCALE. */
  readonly length: number;
  /** DXF 74: 1 absolute rotation, 2 text, 4 shape. */
  readonly shapeFlags: number;
  readonly shapeNumber: number;
  /** STYLE record of the shape file or text font. */
  readonly style?: Handle;
  readonly offset: Vec2;
  readonly rotation: number;
  readonly scale: number;
  readonly text?: string;
}

export interface LinetypeRecord extends SymbolTableRecord {
  readonly description: string;
  /** DXF 72, always `A` in AutoCAD. */
  readonly alignment: string;
  readonly patternLength: number;
  readonly elements: readonly LinetypeElement[];
}

export interface TextStyleRecord extends SymbolTableRecord {
  /** Primary font file (DXF 3): an SHX/SHP name or a TrueType file. */
  readonly font: string;
  /** Big font file (DXF 4) for Asian text, if any. */
  readonly bigFont?: string;
  /** Fixed height (DXF 40); 0 means the height is asked for when text is placed. */
  readonly height: number;
  readonly widthFactor: number;
  /** Radians. */
  readonly obliqueAngle: number;
  readonly lastHeight: number;
  /** DXF 71: 2 backward, 4 upside down. */
  readonly generation: number;
  /** TrueType style bits from the `ACAD` xdata (bold, italic, pitch and family). */
  readonly trueTypeFlags: number;
}

export interface BlockTableRecord extends SymbolTableRecord {
  /** LAYOUT object of a `*Model_Space` / `*Paper_Space*` record. */
  readonly layout?: Handle;
  /** `$INSUNITS` code of the block's units (DXF 70 of AcDbBlockTableRecord). */
  readonly units: number;
  readonly explodable: boolean;
  readonly scalable: boolean;
}

/** A coordinate system: origin and axes in WCS (UCS records, and the UCS of views and vports). */
export interface UcsFrame {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly elevation: number;
  /** DXF 71/79: 0 not orthographic, 1–6 top, bottom, front, back, left, right. */
  readonly orthographic: number;
}

export interface UcsRecord extends SymbolTableRecord, UcsFrame {}

/** View parameters shared by VIEW and VPORT records. */
export interface ViewParams {
  readonly center: Vec2;
  readonly height: number;
  readonly direction: Vec3;
  readonly target: Vec3;
  readonly lensLength: number;
  readonly frontClip: number;
  readonly backClip: number;
  /** View twist, radians. */
  readonly twist: number;
  /** DXF 71 view mode bits (perspective, front/back clipping, …). */
  readonly viewMode: number;
  /** DXF 281. */
  readonly renderMode: number;
}

export interface ViewRecord extends SymbolTableRecord, ViewParams {
  readonly width: number;
  /** The UCS saved with the view (DXF 72 = 1). */
  readonly ucs?: UcsFrame;
}

export interface VportRecord extends SymbolTableRecord, ViewParams {
  /** Viewport extent in the display, 0–1 (DXF 10/11). */
  readonly lowerLeft: Vec2;
  readonly upperRight: Vec2;
  readonly aspectRatio: number;
  readonly snapBase: Vec2;
  readonly snapSpacing: Vec2;
  /** Radians. */
  readonly snapRotation: number;
  readonly snapOn: boolean;
  readonly isometricSnap: boolean;
  readonly isometricPlane: number;
  readonly gridSpacing: Vec2;
  readonly gridOn: boolean;
  /** DXF 60 grid display bits. */
  readonly gridFlags: number;
  readonly gridMajor: number;
  readonly circleZoom: number;
  /** DXF 74 UCSICON bits. */
  readonly ucsIcon: number;
  readonly ucs: UcsFrame;
}

/**
 * A DIMVAR's value as the DIMSTYLE record states it (AutoCAD DXF reference, DIMSTYLE):
 * numbers and enum codes as numbers, on/off variables as booleans, DIMPOST/DIMAPOST as text,
 * DIMDSEP as its character, colours (DIMCLRD/E/T, DIMTFILLCLR) as ACI numbers, DIMJOGANG in
 * radians, and references (DIMTXSTY, DIMBLK*, DIMLDRBLK, DIMLTYPE, DIMLTEX*) as handles.
 */
export type DimVarValue = number | string | boolean;

export interface DimStyleRecord extends SymbolTableRecord {
  /**
   * DIMVARs by name (`DIMSCALE`, `DIMBLK`, …). A reference variable that points at nothing
   * (the default arrowhead, ByBlock linetype) is absent.
   */
  readonly vars: Readonly<Record<string, DimVarValue>>;
  /**
   * DIMVAR colours (DIMCLRD/E/T, DIMTFILLCLR) that the file holds as true colours, by name: R2004+
   * DWGs store them as AcCmColor. `vars` keeps the ACI AutoCAD writes for each in DXF. Absent when
   * there are none.
   */
  readonly trueColors?: Readonly<Record<string, Color>>;
}

/** An MLEADERSTYLE object (AutoCAD DXF reference, MLEADERSTYLE); enum fields keep DXF codes. */
export interface MLeaderStyleRecord extends SymbolTableRecord {
  readonly description: string;
  /** DXF 170: 0 none, 1 block, 2 mtext, 3 tolerance. */
  readonly contentType: number;
  /** DXF 171 / 172. */
  readonly mleaderDrawOrder: number;
  readonly leaderDrawOrder: number;
  readonly maxLeaderPoints: number;
  /** DXF 40 / 41, as the file states them (every corpus file has 0, so the unit is untested). */
  readonly firstSegmentAngle: number;
  readonly secondSegmentAngle: number;
  /** DXF 173: 0 invisible, 1 straight, 2 spline. */
  readonly pathType: number;
  readonly lineColor: Color;
  readonly linetype?: Handle;
  readonly lineweight: Lineweight;
  readonly landing: boolean;
  readonly landingGap: number;
  readonly dogleg: boolean;
  readonly doglegLength: number;
  readonly arrowhead?: Handle;
  readonly arrowheadSize: number;
  readonly defaultText: string;
  readonly textStyle?: Handle;
  /** DXF 174 / 178 / 273 / 272: attachment of the text to the landing. */
  readonly textLeftAttachment: number;
  readonly textRightAttachment: number;
  readonly textTopAttachment: number;
  readonly textBottomAttachment: number;
  /** DXF 271: 0 horizontal, 1 vertical. */
  readonly textAttachmentDirection: number;
  /** DXF 175 / 176. */
  readonly textAngleType: number;
  readonly textAlignment: number;
  readonly textColor: Color;
  readonly textHeight: number;
  readonly textFrame: boolean;
  readonly textAlignAlwaysLeft: boolean;
  readonly alignSpace: number;
  readonly block?: Handle;
  readonly blockColor: Color;
  readonly blockScale: Vec3;
  readonly blockScaleOn: boolean;
  /** DXF 141, radians. */
  readonly blockRotation: number;
  readonly blockRotationOn: boolean;
  /** DXF 177: 0 extents, 1 base point. */
  readonly blockConnection: number;
  readonly scale: number;
  readonly overwriteProperties: boolean;
  readonly annotative: boolean;
  readonly breakGap: number;
}

/** One edge of a table cell style, in the DXF order top, inside horizontal, bottom, left, inside vertical, right. */
export interface TableCellBorder {
  readonly lineweight: Lineweight;
  readonly visible: boolean;
  readonly color: Color;
}

/** A TABLESTYLE cell style (the Data, Header and Title rows of the DXF record). */
export interface TableCellStyle {
  readonly textStyle?: Handle;
  readonly textHeight: number;
  /** DXF 170: 1 top left … 9 bottom right. */
  readonly alignment: number;
  readonly textColor: Color;
  readonly fillColor: Color;
  readonly fillOn: boolean;
  /** DXF 90 / 91: value data type and unit type. */
  readonly dataType: number;
  readonly unitType: number;
  readonly borders: readonly TableCellBorder[];
}

/** A TABLESTYLE object (AutoCAD DXF reference, TABLESTYLE). */
export interface TableStyleRecord extends SymbolTableRecord {
  readonly description: string;
  /** DXF 70: 0 down, 1 up. */
  readonly flowDirection: number;
  /** DXF 71. */
  readonly styleFlags: number;
  readonly horizontalMargin: number;
  readonly verticalMargin: number;
  readonly suppressTitle: boolean;
  readonly suppressHeader: boolean;
  /** In file order. */
  readonly cellStyles: readonly TableCellStyle[];
}

/** One line of a multiline style (DXF 49, 62 and 6, repeated per element). */
export interface MLineStyleElement {
  /** DXF 49: the offset from the multiline's origin, in drawing units before the MLINE scale. */
  readonly offset: number;
  /** DXF 62 (a DWG CMC colour). */
  readonly color: Color;
  /** DXF 6: the linetype; absent only where acad-ts holds none and the drawing has no ByLayer. */
  readonly linetype?: Handle;
}

/**
 * An MLINESTYLE object (AutoCAD DXF reference, MLINESTYLE; M1-75 part 31). Like a multileader
 * style it is an object named by its `ACAD_MLINESTYLE` entry, so its DXF 70 is `styleFlags`, not
 * the standard flags of a record.
 */
export interface MLineStyleRecord extends SymbolTableRecord {
  /** DXF 3. */
  readonly description: string;
  /**
   * DXF 70: 1 fill on, 2 display miters (joints), 16 start square cap (line), 32 start inner
   * arcs, 64 start round cap (outer arcs), 256 end square cap, 512 end inner arcs, 1024 end round
   * cap.
   */
  readonly styleFlags: number;
  /** DXF 62 before the first element: the fill colour. */
  readonly fillColor: Color;
  /** DXF 51 and 52: the start and end cap angles, radians. */
  readonly startAngle: number;
  readonly endAngle: number;
  /** DXF 71 elements, in file order (AutoCAD keeps them from the highest offset down). */
  readonly elements: readonly MLineStyleElement[];
}

/** The record type of each table and style collection. */
export interface TableRecords {
  layers: LayerRecord;
  linetypes: LinetypeRecord;
  textStyles: TextStyleRecord;
  dimStyles: DimStyleRecord;
  mleaderStyles: MLeaderStyleRecord;
  tableStyles: TableStyleRecord;
  appIds: SymbolTableRecord;
  views: ViewRecord;
  ucs: UcsRecord;
  vports: VportRecord;
  blockRecords: BlockTableRecord;
  /**
   * The styles and definitions PURGE also takes, which the file keeps as entries of a dictionary
   * of the named-object dictionary (M1-75 part 29): MLINESTYLE (`ACAD_MLINESTYLE`), MATERIAL
   * (`ACAD_MATERIAL`), VISUALSTYLE (`ACAD_VISUALSTYLE`) and the plot style names of a
   * named-plot-style drawing (ACDBPLACEHOLDER in `ACAD_PLOTSTYLENAME`). Triya keeps materials,
   * visual styles and plot styles by name only, what they hold staying in the original; MLINE
   * styles are mapped whole (M1-75 part 31). Entities, layers and viewports point at them by
   * handle (MLINE `style`, `material`, `plotStyle`, `visualStyle`).
   */
  mlineStyles: MLineStyleRecord;
  materials: SymbolTableRecord;
  visualStyles: SymbolTableRecord;
  plotStyles: SymbolTableRecord;
}

export type TableName = keyof TableRecords;

export const TABLE_NAMES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'mleaderStyles',
  'tableStyles',
  'appIds',
  'views',
  'ucs',
  'vports',
  'blockRecords',
  'mlineStyles',
  'materials',
  'visualStyles',
  'plotStyles',
];

export type Tables = { readonly [K in TableName]: ReadonlyMap<Handle, TableRecords[K]> };

// ── Blocks, layouts, objects, header ───────────────────────────────────────────────────────

/**
 * A block definition, keyed by its BLOCK_RECORD handle: `*Model_Space`, `*Paper_Space*`, `*D`,
 * `*U`, `*X` and named blocks alike. Its entities and their order live in `DocumentModel`,
 * because they change through `ChangeSet`s while the definition itself rarely does.
 */
export interface BlockDefinition extends ObjectCommon {
  readonly name: string;
  readonly basePoint: Vec2;
  /** Handles of the BLOCK and ENDBLK entities that bracket the definition in the file. */
  readonly beginHandle?: Handle;
  readonly endHandle?: Handle;
  readonly flags?: number;
  /**
   * Set on a dynamic block definition: its extension dictionary holds the `ACAD_ENHANCEDBLOCK`
   * evaluation graph. Triya draws dynamic blocks in their stored state and does not evaluate
   * them (PRD non-goal 2, FR-B3). `name` is what AutoCAD shows: the AcDbDynamicBlockTrueName
   * xdata when there is one (R2000 saves a dynamic block under an anonymous `*U` name),
   * otherwise the block's own name.
   */
  readonly dynamic?: { readonly name: string };
  /**
   * Set on an anonymous `*U` block holding one state of a dynamic block (the geometry a
   * reference with changed parameters draws): the dynamic block's record, from its
   * AcDbBlockRepBTag xdata. `dynamicBlockOf` resolves it.
   */
  readonly dynamicOf?: Handle;
}

export interface Layout extends ObjectCommon {
  readonly name: string;
  /** Tab order; Model is 0. */
  readonly tabOrder: number;
  /** BLOCK_RECORD holding this layout's entities. */
  readonly blockRecord: Handle;
  /** DXF 70: 1 PSLTSCALE (paper-space linetype scaling), 2 LIMCHECK. */
  readonly flags?: number;
  /** DXF 10 / 11: LIMMIN and LIMMAX of the layout, in its drawing units. */
  readonly limits?: { readonly min: Vec2; readonly max: Vec2 };
  /** The page setup the layout's sheet is drawn from (M1-18). */
  readonly plot?: LayoutPlot;
  /**
   * The rest of the layout's space state (M1-75 part 30). While a paper layout is the current one
   * (on `*Paper_Space`) the header's `$P…` variables hold it live, as they hold its limits and
   * flags, and AutoCAD saves it into the LAYOUT too; making another layout current swaps them.
   */
  readonly space?: LayoutSpace;
}

/** DXF 12–17 and 146 of AcDbLayout, with the header variables that hold them for the current layout. */
export interface LayoutSpace {
  /** DXF 12: `$PINSBASE`. */
  readonly insertionBase: Vec3;
  /** DXF 14 / 15: `$PEXTMIN` / `$PEXTMAX`. */
  readonly extents: { readonly min: Vec3; readonly max: Vec3 };
  /** DXF 146: `$PELEVATION`. */
  readonly elevation: number;
  /** DXF 13 / 16 / 17: `$PUCSORG`, `$PUCSXDIR`, `$PUCSYDIR`. */
  readonly ucs: { readonly origin: Vec3; readonly xAxis: Vec3; readonly yAxis: Vec3 };
}

/** DXF 72 plot paper units. */
export type PlotPaperUnits = 'inches' | 'millimeters' | 'pixels';

/**
 * A layout's page setup: the PLOTSETTINGS groups of its LAYOUT object (DXF AcDbPlotSettings).
 * Paper sizes and margins are millimetres on the paper as the device feeds it; `rotation`
 * turns the drawing on it (1 is AutoCAD's Landscape for a portrait sheet).
 */
export interface LayoutPlot {
  /** DXF 4: the canonical media name, e.g. `ISO_A4_(210.00_x_297.00_MM)`. */
  readonly paperSize: string;
  /** DXF 44 / 45. */
  readonly paperWidth: number;
  readonly paperHeight: number;
  /** DXF 40–43: the unprintable margins. */
  readonly margins: {
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
    readonly top: number;
  };
  /** DXF 72. */
  readonly paperUnits: PlotPaperUnits;
  /** DXF 73: 0 none, 1 90° (Landscape), 2 180°, 3 270°. */
  readonly rotation: 0 | 1 | 2 | 3;
  /** DXF 46 / 47: the plot offset from the printable area's corner, millimetres. */
  readonly origin: Vec2;
  /** DXF 142 / 143: `numerator` paper units plot `denominator` drawing units. */
  readonly scale: { readonly numerator: number; readonly denominator: number };
  /** DXF 74: what is plotted (5 is the layout). */
  readonly plotType: number;
  /** DXF 70 plot flags. */
  readonly flags: number;
}

/** A non-graphical object (dictionary, xrecord, layer state, scale, image def, …). */
export interface NonGraphicalObject extends ObjectCommon {
  /** DXF object type name, e.g. `DICTIONARY`. */
  readonly type: string;
  readonly owner: Handle;
}

/**
 * A block's draw order (DXF SORTENTSTABLE, in the block record's `ACAD_SORTENTS` extension
 * dictionary). An entity with an entry is drawn as if its handle were `sort`; the others keep
 * their own. Entries stay in the order stored, as AutoCAD left them.
 */
export interface SortEntsTable extends NonGraphicalObject {
  readonly type: 'SORTENTSTABLE';
  /** BLOCK_RECORD whose entities it orders. */
  readonly block: Handle;
  readonly entries: readonly { readonly entity: Handle; readonly sort: Handle }[];
}

/**
 * A raster image's definition (DXF IMAGEDEF, M1-19): the file an IMAGE shows and the pixel
 * size it was attached at. The pixels themselves are not in the drawing; the app resolves
 * `fileName` to a file (M1-21) and hands the decoded bitmap to the renderer.
 */
export interface ImageDefinition extends NonGraphicalObject {
  readonly type: 'IMAGEDEF';
  /**
   * The image's name: its entry in the `ACAD_IMAGE_DICT` dictionary, which AutoCAD shows in the
   * External References palette and IMAGE prompts for (the file name without its extension
   * unless the user named it otherwise).
   */
  readonly name: string;
  /** DXF 1: the path as saved, often relative (`.\photo.jpg`). */
  readonly fileName: string;
  /** DXF 10: the image size in pixels. */
  readonly size: Vec2;
  /** DXF 11: one pixel's default size in AutoCAD units. */
  readonly pixelSize: Vec2;
  /** DXF 280: whether the image is loaded. */
  readonly loaded: boolean;
  /** DXF 281: resolution units, 0 none, 2 centimetres, 5 inches. */
  readonly units: number;
}

/**
 * The drawing's image display settings (DXF RASTERVARIABLES, `ACAD_IMAGE_VARS`): IMAGEFRAME
 * and IMAGEQUALITY. A drawing without the object uses AutoCAD's initial values, frame on and
 * high quality.
 */
export interface RasterVariables extends NonGraphicalObject {
  readonly type: 'RASTERVARIABLES';
  /** DXF 70: image frames shown. */
  readonly frame: boolean;
  /** DXF 71. */
  readonly quality: 'draft' | 'high';
  /** DXF 72: insertion units, 0 none, 1 millimetres, … 5 inches. */
  readonly units: number;
}

/** WIPEOUTFRAME (DXF WIPEOUTVARIABLES, `ACAD_WIPEOUT_VARS`); without it frames show. */
export interface WipeoutVariables extends NonGraphicalObject {
  readonly type: 'WIPEOUTVARIABLES';
  /** DXF 70: wipeout frames shown. */
  readonly frame: boolean;
}

/**
 * A group (DXF GROUP, an entry of the `ACAD_GROUP` dictionary; M1-75 part 23): a named or
 * unnamed set of entities that GROUP makes and selects together while it is selectable. Each
 * member lists the group in its reactors, as AutoCAD links them both ways.
 */
export interface Group extends NonGraphicalObject {
  readonly type: 'GROUP';
  /**
   * Its `ACAD_GROUP` entry. AutoCAD names an unnamed group (DXF 70 1) `*A` and a number, so a
   * name starting with `*` is an unnamed group's.
   */
  readonly name: string;
  /** DXF 300. */
  readonly description: string;
  /** DXF 71: picking one member selects the whole group. */
  readonly selectable: boolean;
  /** DXF 340: the members, in the group's order (GROUPEDIT and the Object Grouping dialog's Reorder). */
  readonly entities: readonly Handle[];
}

/** A header variable value as read: string, number, point, or handle (as a string). */
export type HeaderValue = string | number | boolean | Vec2 | Vec3;

export interface DocumentMeta {
  /** `$ACADVER` of the file it came from, e.g. `AC1032`. */
  readonly sourceVersion: string;
  readonly sourcePath?: string;
  /** `$DWGCODEPAGE`. */
  readonly codePage: string;
  /** `$INSUNITS`. */
  readonly insUnits: number;
  /** `$MEASUREMENT`. */
  readonly measurement: 'imperial' | 'metric';
}

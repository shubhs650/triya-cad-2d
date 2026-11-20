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

/**
 * An annotative object's representations, one per annotation scale: the context data objects in
 * the `ACDB_ANNOTATIONSCALES` dictionary of its extension dictionary's `AcDbContextDataManager`,
 * in dictionary order. Saves write a TEXT's representations by handle (M1-75 part 37); adding
 * or removing one (OBJECTSCALE) is annotative creation, a PRD non-goal (DEC-013).
 */
export interface AnnotativeData {
  readonly representations: readonly AnnotationRepresentation[];
}

/** One representation of an annotative object (one context data object). */
export interface AnnotationRepresentation {
  /** Handle of the context data object. */
  readonly handle: Handle;
  /** SCALE object handle (DXF 340); absent for a context data object Triya does not read. */
  readonly scale?: Handle;
  /** DXF 290: the default representation. */
  readonly isDefault?: boolean;
  /** A TEXT's or single-line attribute's placement at this scale (ACDB_TEXTOBJECTCONTEXTDATA_CLASS). */
  readonly text?: TextRepresentation;
}

/**
 * Where a TEXT draws at one annotation scale: the values its context data holds, in the plan
 * coordinates of the text's own `position`, `alignmentPoint`, `rotation` and `halign`.
 */
export interface TextRepresentation {
  /** DXF 10. */
  readonly position: Vec2;
  /** DXF 11 (0,0 in AutoCAD's files for left-baseline text, which has none). */
  readonly alignmentPoint: Vec2;
  /** DXF 50, radians. */
  readonly rotation: number;
  /** DXF 70 after the scale: the horizontal alignment (the text's DXF 72). */
  readonly halign: number;
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

export interface LineGeometry extends Line, PlanarProps {
  /**
   * A sloped LINE's WCS Z at its start and end (DEC-063), stated only when they differ; a level
   * line's height is its `elevation`. The plan view stays what is drawn, measured and snapped to.
   */
  readonly heights?: readonly [number, number];
}
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
  /**
   * A heavyweight 2D POLYLINE vertex's curve-fit tangent (VERTEX flag 2, DXF 50), radians in the
   * plan: the direction PEDIT's Edit vertex Tangent gave it, which Fit uses (M3-16). An
   * LWPOLYLINE has nowhere to save one, so on its vertices it lasts only until the drawing closes.
   */
  readonly tangent?: number;
  /** A 3D POLYLINE vertex's WCS Z when it is not 0 (DEC-062); never on other polylines. */
  readonly z?: number;
}

/** A spline-fit POLYLINE's frame point (VERTEX flag 16), with a 3D polyline's Z (DEC-062). */
export interface PolylineFramePoint extends Vec2 {
  readonly z?: number;
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
  /**
   * DXF 44: how far a spline drawn by fit points may pass from them (SPLINE toLerance, M3-01
   * part 5); absent for 0 or AutoCAD's 1e-10 default. SPLINE and SPLINEDIT's fit edits
   * approximate within it (`fitSpline`, M3-16); the curve drawn is the NURBS stored beside the
   * fit points.
   */
  readonly fitTolerance?: number;
  readonly closed: boolean;
  readonly periodic: boolean;
  readonly normal?: Vec3;
}

/**
 * A heavyweight POLYLINE (2D or 3D) with its VERTEX and SEQEND entities folded in; those keep
 * their handles in the retained original. `vertices` are the ones AutoCAD draws: for a
 * spline-fit polyline that is the fitted vertices (VERTEX flag 8), with the frame (flag 16)
 * in `frame`. A 3D polyline is its plan view, with no bulges; its vertices' heights ride along
 * in `z` (DEC-062).
 */
export interface PolylineGeometry extends PlanarProps {
  readonly kind: 'POLYLINE';
  readonly vertices: readonly PolylineVertex[];
  readonly closed: boolean;
  readonly is3d: boolean;
  /** DXF 70 bit 2 (curve fit) or bit 4 with 75 = 5/6/8 (quadratic, cubic, Bezier spline fit). */
  readonly fit?: 'curve' | 'quadratic' | 'cubic' | 'bezier';
  readonly frame?: readonly PolylineFramePoint[];
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
/**
 * A FIELD object (M4-10): a text's fields as AutoCAD keeps them, in the `TEXT` entry of the
 * `ACAD_FIELD` dictionary in the text's extension dictionary. The root's evaluator is `_text`
 * and its code the text with `%<\_FldIdx n>%` where child n's value goes; a child's code is
 * the field itself (`\AcVar Date \f "M/d/yyyy"`), with `%<\_ObjIdx n>%` naming `objects[n]`.
 * The text's own value or contents stay as the file has them: the field values as last
 * evaluated, which is what draws.
 */
export interface DrawingField {
  /** DXF 1: the evaluator (`_text`, `AcVar`, `AcObjProp`, `AcExpr`, `AcDiesel`, …). */
  readonly evaluator: string;
  /** DXF 2 and 3: the field code. */
  readonly code: string;
  /** DXF 360: the child fields, in `\_FldIdx` order. */
  readonly children: readonly DrawingField[];
  /** DXF 331: the objects the code names by `\_ObjIdx`. */
  readonly objects: readonly Handle[];
  /** DXF 301: the value as last evaluated and shown; absent when the file holds none. */
  readonly value?: string;
  /** A date value's time (ms since the epoch), kept with `value` for the FIELD's date data. */
  readonly time?: number;
  /**
   * DXF 91, when AutoCAD may evaluate it (AcFdEval options): 1 on open, 2 on save, 4 on plot,
   * 8 on eTransmit, 16 on regeneration, 32 on demand (UPDATEFIELD); absent is 63, all of them.
   * FIELDEVAL decides which of these the drawing allows (M4-10 part 3, edit/field-eval.ts).
   */
  readonly options?: number;
}

export interface TextFields extends PlanarProps {
  readonly value: string;
  /** The text's fields (M4-10), when its extension dictionary holds them. */
  readonly field?: DrawingField;
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
  /** The text's fields (M4-10), when its extension dictionary holds them. */
  readonly field?: DrawingField;
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
    /**
     * The frame's own border scale where it is not the fill's: a multileader's frame sits a
     * landing gap outside its text, its mask by its own scale (M2-44). Never read from a file.
     */
    readonly frameScale?: number;
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
  /** The line's own properties, when DXF 93 flags any (M1-111); absent means the MULTILEADER's. */
  readonly overrides?: MultiLeaderLineOverrides;
}

/**
 * A leader line's own properties (R2010+ LEADER_LINE: ODA DWG specification; DXF 170, 92, 340,
 * 171, 40, 341 with the flags in 93). Only the flagged ones are mapped: the others are what the
 * file happens to store and AutoCAD does not draw them.
 */
export interface MultiLeaderLineOverrides {
  /** DXF 93: 1 path type, 2 colour, 4 linetype, 8 lineweight, 16 arrowhead size, 32 arrowhead. */
  readonly flags: number;
  /** DXF 170: 0 invisible, 1 straight, 2 spline. */
  readonly pathType?: number;
  /** DXF 92. */
  readonly color?: Color;
  /** LTYPE handle (DXF 340). */
  readonly linetype?: Handle;
  /** DXF 171. */
  readonly lineweight?: Lineweight;
  /** DXF 40, before the MULTILEADER's overall scale. */
  readonly arrowheadSize?: number;
  /** BLOCK_RECORD handle of the arrowhead (DXF 341); flag 32 without one is closed filled. */
  readonly arrowhead?: Handle;
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
  /**
   * The text's fields (M4-23), when the multileader's extension dictionary holds them: its
   * `ACAD_FIELD` dictionary's `TEXT` entry, as an MTEXT's. `content` shows their values.
   */
  readonly field?: DrawingField;
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
  /**
   * The background mask (context data 292 on, M2-44): its fill colour (91), none for the
   * drawing window colour (291 on, or 91 stating the window colour), its border scale (141) and
   * transparency (92, when not 0). Absent when the mask is off, whatever else is stored.
   */
  readonly mask?: MultiLeaderMask;
}

/** A MULTILEADER's background mask, as MTEXT's (DXF 90 bits 1 and 2, 63, 45, 441). */
export interface MultiLeaderMask {
  readonly color?: Color;
  readonly scale: number;
  readonly transparency?: number;
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
  /**
   * The values of the block's attributes, stated on the MULTILEADER (DXF 330/177/44/302), not as
   * ATTRIBs. Absent when it states none.
   */
  readonly attributes?: readonly MultiLeaderAttribute[];
}

/** One attribute value of a MULTILEADER's block content. */
export interface MultiLeaderAttribute {
  /** The ATTDEF in the content block (DXF 330). */
  readonly definition?: Handle;
  /** DXF 177. */
  readonly index: number;
  /** DXF 44. */
  readonly width: number;
  /** DXF 302. */
  readonly value: string;
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
  /**
   * DXF 295 (R2013): the landing runs to the text line rather than the text box's edge (M4-14).
   * Absent when off.
   */
  readonly extendLeaderToText?: boolean;
  /** DXF 10 in the context data: where the content attaches. */
  readonly contentBase: Vec2;
  /** DXF 145. */
  readonly landingGap: number;
  /**
   * DXF 176: how block content meets its landings, 0 by the centre of its extents, 1 by its
   * insertion point (M2-35 part 25). Absent: its style's.
   */
  readonly blockConnection?: number;
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
  /**
   * The PDF layers (optional content group names) this underlay turns off, AutoCAD's ULAYERS
   * (M2-38 part 2): read from its `AdeskUnderlayLayerOverrideData` xdata, which stays the
   * record a save writes (passthrough); absent when it turns none off.
   */
  readonly layersOff?: readonly string[];
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
  /**
   * DXF 71 (UCSVP, M3-15): the viewport keeps its own UCS, `ucs`, rather than showing model
   * space's current one. Absent is 0.
   */
  readonly ucsPerViewport?: boolean;
  /**
   * DXF 110/111/112, 146 and 79: the UCS the viewport keeps, in WCS. Absent is the WCS. Triya
   * draws in plan, so one whose XY plane is not the world's reads as the WCS (`viewportUcs`).
   */
  readonly ucs?: UcsFrame;
}

/**
 * The cell style a table's rows and cells are drawn with: one of the three every table style
 * holds (AutoCAD 2024 Help, "Table Style Dialog Box": Title, Header and Data "are always contained
 * within any table style"), or a cell style of the drafter's own by its id in the table style
 * (`TableUserCellStyle.id`, 101 and up; M4-16 part 9), as the file names it.
 */
export type TableCellStyleName = 'title' | 'header' | 'data' | number;

/** One cell of an ACAD_TABLE, in row-major order. */
export interface TableCell {
  /** DXF 171: 1 text, 2 block. */
  readonly type: 'text' | 'block';
  /** The cell's value as text (DXF 1 with its 2 chunks), with MTEXT format codes. */
  readonly text: string;
  /** BLOCK_RECORD handle of a block cell (DXF 340). */
  readonly block?: Handle;
  /**
   * A block cell's block scale (DXF 144): what the block is drawn at unless `autoFit`, when
   * AutoCAD states the scale it fitted the block at. Absent on a text cell.
   */
  readonly blockScale?: number;
  /**
   * A block cell's AutoFit (DXF 174): the block scaled to fit in the cell, as TINSERT's AutoFit
   * sets it. Absent on a text cell; a block cell that states neither field fits its block.
   */
  readonly autoFit?: boolean;
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
  /**
   * The value's format string (DXF 300 in the cell's CELL_VALUE, e.g. `%tc1`), as AutoCAD's
   * Data Format sets it; absent when none. A number, date or angle value is mapped as its
   * formatted text already; a string value is drawn through its text case (`tableCellShown`).
   */
  readonly valueFormat?: string;
  /**
   * The cell's value when it is not text (DXF 90 in its CELL_VALUE: 1 a whole number, 2 a
   * number, 8 a date, 0x10 / 0x20 a point), as AutoCAD's Data Format makes it (M4-16); absent
   * for a text value. `text` holds it as shown (DXF 302), formatted by `valueFormat`.
   */
  readonly value?: TableCellValue;
  /**
   * A text cell's fields (M4-23), as an MTEXT's (`MTextGeometry.field`): the root `_text` FIELD
   * the cell's content names (DXF 344 in its ACAD_TABLE codes, its TABLECONTENT field content),
   * `text` holding the values shown. Absent when the cell holds no field.
   */
  readonly field?: DrawingField;
  /** What the cell overrides of its table style, its row's and column's folded in; absent when nothing. */
  readonly format?: TableCellFormat;
  /**
   * The cell style of the cell's own (M4-16 part 5: the Table Cell menu's Cell Style), when it
   * is not its row's (`TableGeometry.rowStyles`). DXF states it only in the table's AutoCAD 2008
   * data (TABLECONTENT, a cell's 90), DWG from R2010 in the table.
   */
  readonly cellStyle?: TableCellStyleName;
  /**
   * What of the cell is locked (M4-16 part 6: AutoCAD's Cell Locking): its content (text, value,
   * block, fields), its format (fill, alignment, borders, text height, data format, cell style)
   * or both; absent when unlocked. DXF states it only in the table's AutoCAD 2008 data
   * (TABLECONTENT, a cell's state flags 0x1 and 0x10), DWG from R2010 in the table.
   */
  readonly locked?: TableCellLock;
}

/** A table cell's lock (`TableCell.locked`). */
export type TableCellLock = 'content' | 'format' | 'both';

/**
 * A table cell's value other than text (`TableCell.value`). A number states its unit type
 * (DXF 94: 2 an angle, in radians; 16 a currency; 32 a percentage, 35 for 35 %; 0 none), as
 * AutoCAD's Angle, Currency, Percentage and Decimal Number data types store it; a date is its
 * local time in milliseconds (DXF 310, a SYSTEMTIME).
 */
export type TableCellValue =
  | { readonly kind: 'long'; readonly n: number }
  | { readonly kind: 'double'; readonly n: number; readonly units: number }
  | { readonly kind: 'date'; readonly time: number }
  | {
      readonly kind: 'point';
      readonly point: readonly [number, number, number];
      /** DXF 90 0x10 a 2D point, 0x20 a 3D one. */
      readonly dimensions: 2 | 3;
    };

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
  /**
   * The border's linetype (M4-16 part 7); never ByBlock, which is what an edge is drawn in
   * without one. Only a DWG from R2010 and a DXF table's TABLECONTENT state it.
   */
  readonly linetype?: LinetypeRef;
  /** A double-line border (border type 2), stated where `linetype` is. */
  readonly double?: true;
  /** The spacing of a double line; kept only on a double border. */
  readonly spacing?: number;
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
   * Each row's cell style (M4-16 part 5), when the rows are not the title and header rows the
   * table style gives by their place, then data rows (`tableRowTypes`): a title or header row
   * inserted, deleted or set another style, or Insert Table's First and Second row cell style.
   * DXF states it only in the table's AutoCAD 2008 data (TABLECONTENT, a row's 90), DWG from
   * R2010 in the table. Absent when the rows are by their place.
   */
  readonly rowStyles?: readonly TableCellStyleName[];
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
  /**
   * The table's break settings (M4-16 part 10): the Properties palette's Table Breaks and the
   * table breaking grip. Absent when the file states none (a DWG's has-break-data 0, a DXF
   * round-trip record laid out as version 2).
   */
  readonly breaks?: TableBreaks;
}

/**
 * How a table breaks into parts (M4-16 part 10, AutoCAD 2024 Help "Table Breaks" in the
 * Properties palette): with `enabled`, the rows go into parts no higher than `height`, laid out
 * `direction` from the first, `spacing` apart, the title and header rows repeated at the top of
 * each part (`repeatTop`; `repeatBottom` in a table that flows up, whose labels are at the
 * bottom). AcDbTable's break option flags, flow direction, spacing and break heights (ODA spec
 * TABLE, R2010+).
 */
export interface TableBreaks {
  readonly enabled: boolean;
  readonly direction: 'right' | 'left' | 'down';
  readonly repeatTop: boolean;
  readonly repeatBottom: boolean;
  /** Each part after the first may be moved on its own (its `parts[k].offset`). */
  readonly manualPositions: boolean;
  /** Each part after the first may have a height of its own (its `parts[k].height`). */
  readonly manualHeights: boolean;
  /** The break height: the most a part holds (the first part's, and every part's by default). */
  readonly height: number;
  readonly spacing: number;
  /**
   * The parts' own settings, by part (index 0 the first part, which has none of its own): the
   * offset of its origin from the insertion point (block coordinates) and its height. Kept while
   * Manual positions or Manual heights is off, as AutoCAD keeps them.
   */
  readonly parts?: readonly (TableBreakPart | null)[];
}

/** A table part's own position and height (`TableBreaks.parts`). */
export interface TableBreakPart {
  readonly offset?: Vec2;
  readonly height?: number;
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
  /**
   * A pattern hatch's background colour, AutoCAD's HPBACKGROUNDCOLOR (M4-07 part 3): read from
   * its `HATCHBACKGROUNDCOLOR` xdata (1071, an AcCmEntityColor), which stays the record a save
   * writes (edit/hatch-background.ts keeps the two together); absent for none.
   */
  readonly background?: Color;
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
  /**
   * What the Layer Properties Manager shows as Description (M1-104). Not a DXF group: AutoCAD
   * files it as `AcAecLayerStandard` xdata, an empty 1000 string and then the text; absent when
   * the layer has none (no entry, or an empty or missing second string).
   */
  readonly description?: string;
  /**
   * Viewport layer overrides (M1-62), one per layout viewport that overrides any of this layer's
   * colour, linetype, lineweight or transparency (VPLAYER, the Layer Properties Manager's "VP"
   * columns). Not DXF groups: AutoCAD files them as the `ADSK_XREC_LAYER_COLOR_OVR`,
   * `_LINETYPE_OVR`, `_LINEWT_OVR` and `_ALPHA_OVR` XRECORDs of the layer's extension
   * dictionary. Absent when the layer has none.
   */
  readonly viewportOverrides?: readonly LayerViewportOverride[];
  /**
   * A new layer nobody has reviewed yet (M5-19, LAYEREVAL): one an xref load brought in since
   * the layer list was last evaluated, until the drafter reconciles it (-LAYER rEconcile). Not a DXF
   * group: AutoCAD files it as the `ADSK_XREC_LAYER_RECONCILED` XRECORD of the layer's extension
   * dictionary, 290 0 here and 290 1 once reconciled. Absent when the layer is reconciled or the
   * file has no record for it.
   */
  readonly unreconciled?: true;
}

/** What one viewport shows a layer with instead of its own values (M1-62). */
export interface LayerViewportOverride {
  /** The VIEWPORT entity's handle (XRECORD group 335). */
  readonly viewport: Handle;
  /** XRECORD group 420: an ACI or true colour, never ByLayer or ByBlock. */
  readonly color?: Color;
  /** XRECORD group 343: the LTYPE record. */
  readonly linetype?: Handle;
  /** XRECORD group 91: hundredths of a millimetre, or Default. */
  readonly lineweight?: Lineweight;
  /** XRECORD group 440. */
  readonly transparency?: Transparency;
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
  /**
   * The View Manager's Category (M2-70): DXF 300 of the `ADSK_XREC_VTRVIEWINFO` XRECORD in the
   * view's extension dictionary. Absent for `<None>`, which AutoCAD writes when it has none.
   */
  readonly category?: string;
  /**
   * The view's layer snapshot (M5-07 part 7): the name of the layer state, hidden from the Layer
   * States Manager and named `ACAD_VIEWS_<view>`, that restoring the view restores. DXF 302 of the
   * same XRECORD. Absent when the view was saved without one.
   */
  readonly layerState?: string;
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
  /**
   * DXF 90: the most points a leader line takes; 0 is no limit (the dialog's Maximum leader
   * points unchecked, M4-14; ODA's OdDbMLeaderStyle::setMaxLeaderSegmentsPoints).
   */
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
  /**
   * DXF 298 (R2013): the Content tab's Extend leader to text (M4-14). acad-ts and ezdxf name it
   * an unknown flag; it is stored next to MULTILEADER's DXF 295 in the same R2013 DWG section,
   * as ObjectARX gives both objects `extendLeaderToText`.
   */
  readonly extendLeaderToText: boolean;
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
  /**
   * The border's linetype (M4-16 part 8); never ByBlock, which is what a border without one is
   * drawn in. Only a named cell style states it: a DWG's from R2010 and a CELLSTYLEMAP's.
   */
  readonly linetype?: LinetypeRef;
  /** A double-line border (border type 2), stated where `linetype` is. */
  readonly double?: true;
  /** The spacing of a double line; kept only on a double border. */
  readonly spacing?: number;
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

/**
 * A cell style of the drafter's own in a table style (M4-16 part 9: Create a New Cell Style,
 * Manage Cell Styles): kept, as AutoCAD keeps it, among the named cell styles of a DXF's
 * CELLSTYLEMAP or a DWG's from R2010, where its id (101 and up) is what a table's rows and cells
 * name it by.
 */
export interface TableUserCellStyle extends TableCellStyle {
  readonly id: number;
  readonly name: string;
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
  /** The cell styles of the drafter's own, in file order (M4-16 part 9); absent when none. */
  readonly userCellStyles?: readonly TableUserCellStyle[];
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
  /** The Block Definition dialog's Description: the BLOCK entity's DXF 4 (M5-01 part 2). */
  readonly description?: string;
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
  /**
   * An external reference's block (its record has the DXF 70 xref bit 4, overlay 8): the path
   * the BLOCK's DXF 1 saves, as written (often relative). M1-21.
   */
  readonly xrefPath?: string;
  /**
   * Set while the xref's drawing is loaded (M1-21, `xrefLoadChange`): every handle the load
   * added to the host, its `name|symbol` records, its blocks, its model space's entities (owned
   * by this block) and the objects they need. None of them is saved: AutoCAD keeps an xref's
   * contents in its own file, and the save leaves them out (`withoutXrefContent`).
   */
  readonly xrefLoaded?: readonly Handle[];
  /**
   * With `xrefLoaded`: each object of the xref's content as the host holds it, with the handle it
   * has in the xref's own file (M5-02 part 6), `[host, file]`: what REFCLOSE writes back to that
   * file when the xref is edited in place. Session state, never saved, as `xrefLoaded`.
   */
  readonly xrefHandles?: readonly (readonly [Handle, Handle])[];
  /**
   * Set on an xref the user unloaded (XREF Unload, M5-04): its file is not loaded again until
   * the xref is reloaded, and the References palette lists it as Unloaded. Session state: the
   * DXF has no group for it (the BLOCK's 70 bit 32 "resolved" is ignored on input), so a save
   * leaves it out and the drawing opens with the xref waiting for its file again.
   */
  readonly xrefUnloaded?: true;
  /**
   * Set while the xref waits to be loaded again after a reload or a new path (M5-19): the layers
   * the last load brought in, by upper-case name, true for those still unreconciled. The next
   * load evaluates the xref's layers against it (LAYEREVAL): a layer it does not name is new.
   * Session state, never saved, as `xrefLoaded`.
   */
  readonly xrefLayers?: Readonly<Record<string, boolean>>;
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
  /**
   * DXF 75: the standard scale chosen while flag 16 (UseStandardScale) is on; 0 is "Scaled to
   * Fit", 16 is 1:1 (M2-17 part 4). Absent while flag 16 is off, when 142 / 143 are the scale.
   */
  readonly standardScaleType?: number;
  /** DXF 74: what is plotted: 0 display, 1 extents, 2 limits, 3 view, 4 window, 5 the layout. */
  readonly plotType: number;
  /**
   * DXF 48 / 49 and 140 / 141: the Window plot area's corners in the space's drawing units
   * (M2-17 part 4); absent when the page setup stores none (all four 0).
   */
  readonly window?: { readonly min: Vec2; readonly max: Vec2 };
  /**
   * DXF 6: the named view the View plot area plots (M6-04 part 2), a VIEW record's name; absent
   * when the page setup names none (AutoCAD writes '').
   */
  readonly viewName?: string;
  /** DXF 70 plot flags. */
  readonly flags: number;
  /** DXF 7: the plot style table's file name (M2-17 part 3); absent when it names none. */
  readonly styleSheet?: string;
  /**
   * DXF 1 of a LAYOUT (M2-45): the named page setup applied to it, AutoCAD's "current page
   * setup", which the Plot dialog's Name opens on and -PLOT offers; absent when none was (AutoCAD
   * writes ''). A named page setup's own DXF 1 is its name, kept as `NamedPageSetup.name`.
   */
  readonly pageSetupName?: string;
}

/**
 * A named page setup (M2-17 part 6): a PLOTSETTINGS object in the `ACAD_PLOTSETTINGS` dictionary,
 * which AutoCAD's Plot dialog lists under Page setup Name, PUBLISH in its Page Setup column and
 * -PLOT takes by name. DXF 70 flag 1024 (ModelType) makes it model space's; the others are for
 * layouts, as AutoCAD lists them.
 */
export interface NamedPageSetup extends NonGraphicalObject {
  readonly type: 'PLOTSETTINGS';
  /** Its `ACAD_PLOTSETTINGS` entry (DXF 1 holds the same name). */
  readonly name: string;
  /** Flag 1024: a page setup for model space. */
  readonly model: boolean;
  /** The settings, as a layout's page setup holds them. */
  readonly plot: LayoutPlot;
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
 * A PDF underlay's definition (DXF PDFDEFINITION, M1-20): the file and the page a PDFUNDERLAY
 * shows. Like an image's, the page is not in the drawing; the app resolves `fileName` to a
 * file and hands the renderer the page drawn at the resolution the view needs.
 */
export interface PdfDefinition extends NonGraphicalObject {
  readonly type: 'PDFDEFINITION';
  /** Its entry in the `ACAD_PDFDEFINITIONS` dictionary (the External References palette name). */
  readonly name: string;
  /** DXF 1: the path as saved, often relative (`..\plan.pdf`). */
  readonly fileName: string;
  /** DXF 2: the page, as AutoCAD stores it: its number from 1 (or the page label it showed). */
  readonly page: string;
}

/**
 * IMAGEFRAME (AutoCAD 2024 Help, "IMAGEFRAME (System Variable)"): 0 image frames neither shown
 * nor plotted, 1 shown and plotted (AutoCAD's initial value), 2 shown but not plotted.
 */
export type ImageFrame = 0 | 1 | 2;

/**
 * The drawing's image display settings (DXF RASTERVARIABLES, `ACAD_IMAGE_VARS`): IMAGEFRAME
 * and IMAGEQUALITY. A drawing without the object uses AutoCAD's initial values, frame on and
 * high quality.
 */
export interface RasterVariables extends NonGraphicalObject {
  readonly type: 'RASTERVARIABLES';
  /** DXF 70: IMAGEFRAME, as the file holds it (acad-ts patch 0188, M5-04 part 4). */
  readonly frame: ImageFrame;
  /** DXF 71. */
  readonly quality: 'draft' | 'high';
  /** DXF 72: insertion units, 0 none, 1 millimetres, … 5 inches. */
  readonly units: number;
}

/**
 * WIPEOUTFRAME (AutoCAD 2024 Help, "WIPEOUTFRAME (System Variable)"): 0 frames neither shown
 * nor plotted, 1 shown and plotted (AutoCAD's initial value), 2 shown but not plotted.
 */
export type WipeoutFrame = 0 | 1 | 2;

/** WIPEOUTFRAME (DXF WIPEOUTVARIABLES, `ACAD_WIPEOUT_VARS`); without it frames show and plot. */
export interface WipeoutVariables extends NonGraphicalObject {
  readonly type: 'WIPEOUTVARIABLES';
  /** DXF 70. */
  readonly frame: WipeoutFrame;
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

/**
 * Where an associative dimension's definition point sits on geometry (AcDbOsnapPointRef, one of
 * a DIMASSOC's point references): the object snap that placed it on the object, so the
 * dimension follows when the object moves (AutoCAD 2024, DIMASSOC = 2).
 */
export interface DimAssocPoint {
  /** DXF 72: the object snap, 0 none, 1 endpoint, 2 midpoint, 3 centre, … 13 start point. */
  readonly osnap: number;
  /**
   * DXF 331: the object, as a path from the outermost block reference when it is nested in one
   * (a single entity otherwise, as every corpus point reference has).
   */
  readonly geometry: readonly Handle[];
  /** DXF 73: 0 unknown, 1 edge, 2 face. */
  readonly subentType: number;
  /** DXF 91: the subentity's GS marker. */
  readonly gsMarker: number;
  /** DXF 301: xref handles (as text) of an object inside an xref. */
  readonly xrefPaths: readonly string[];
  /** DXF 40: the curve parameter of a Nearest (and endpoint) snap. */
  readonly parameter: number;
  /** DXF 10: the snapped point, in WCS. */
  readonly point: Vec3;
  /** The second object of an intersection or apparent intersection snap (DXF 332, 74, 92, 302). */
  readonly intersection?: {
    readonly geometry: readonly Handle[];
    readonly subentType: number;
    readonly gsMarker: number;
    readonly xrefPaths: readonly string[];
  };
  /** DXF 75 and the reference after it: the point reference this one was before (kept as read). */
  readonly last?: DimAssocPoint;
}

/**
 * An associative dimension's link to the geometry it measures (DXF DIMASSOC, the `ACAD_DIMASSOC`
 * entry of the dimension's extension dictionary; M1-75 part 35). The dimension and each object
 * it is associated with list the DIMASSOC in their reactors, as AutoCAD links them.
 */
export interface DimAssoc extends NonGraphicalObject {
  readonly type: 'DIMASSOC';
  /** DXF 330 after the subclass marker: the dimension. */
  readonly dimension: Handle;
  /** DXF 70: a paper-space dimension on model-space geometry. */
  readonly transSpace: boolean;
  /** DXF 71: rotated dimension type, 0 unknown, 1 parallel, 2 perpendicular. */
  readonly rotatedType: number;
  /**
   * The dimension's first to fourth definition points (DXF 90 bits 1, 2, 4, 8): each the point
   * reference that keeps it on geometry, or null where that point is not associative.
   */
  readonly points: readonly [
    DimAssocPoint | null,
    DimAssocPoint | null,
    DimAssocPoint | null,
    DimAssocPoint | null,
  ];
}

/**
 * A row-major 3×4 affine matrix (DXF 40 × 12 of a SPATIAL_FILTER): rows x, y and z of
 * `[m00 m01 m02 m03]`, the last column the translation, applied to column vectors.
 */
export type Matrix3x4 = readonly number[];

/**
 * XCLIP (DXF SPATIAL_FILTER, M1-103): the clip of a block reference, the `SPATIAL` entry of the
 * `ACAD_FILTER` dictionary in the INSERT's extension dictionary. The boundary is stored where
 * the reference stood when it was clipped; the inverse of that insert transform carries it into
 * the block's coordinates, so the clip moves, turns and scales with the reference afterwards.
 */
export interface SpatialFilter extends NonGraphicalObject {
  readonly type: 'SPATIAL_FILTER';
  /** The INSERT it clips (the owner of its ACAD_FILTER dictionary). */
  readonly insert: Handle;
  /**
   * DXF 10: the boundary, a closed polygon, or two points for the rectangle on those corners.
   * For an inverted clip AutoCAD stores the region outside the inner boundary and inside the
   * block's extents as one polygon joined by a zero-width slit.
   */
  readonly boundary: readonly Vec2[];
  /**
   * Invert clip (AutoCAD 2015 and later; XCLIP's Invert clip, M5-04 part 11): the boundary the
   * drafter drew, whose inside is hidden, in `boundary`'s coordinates (two points for the
   * rectangle on those corners). AutoCAD keeps it in the ACAD_INVERTEDCLIP_ROUNDTRIP section of
   * the ACAD_XREC_ROUNDTRIP XRECORD in the filter's extension dictionary, and `boundary` then
   * holds what shows for a reader that knows no inverted clip (`invertedBoundary`).
   */
  readonly inverted?: readonly Vec2[];
  /** DXF 210 and 11: the boundary's plane. */
  readonly normal: Vec3;
  readonly origin: Vec3;
  /** DXF 71: clipping on (XCLIP ON) or off (XCLIP OFF, the whole block shows). */
  readonly enabled: boolean;
  /** DXF 72/40 and 73/41: the front and back clipping planes' distances, when set. */
  readonly frontClip?: number;
  readonly backClip?: number;
  /** The first 12 DXF 40s: the inverse of the insert transform at the time of clipping. */
  readonly inverseInsert: Matrix3x4;
  /** The last 12 DXF 40s: the clip boundary's own transform (the identity in every sample). */
  readonly boundaryTransform: Matrix3x4;
}

/**
 * An associative array Triya made (M3-11, DEC-059): its definition, the `TRIYA_ARRAY` XRECORD in
 * the array INSERT's extension dictionary (`owner`, which the INSERT's `extDict` names). The array
 * is that INSERT of an anonymous `*U` block whose items are INSERTs of the source block, another
 * anonymous `*U` block holding the source objects; ARRAYEDIT remakes the items from this record.
 * The centre is in the array block's coordinates, the base point and tangent direction in the
 * source block's.
 */
export interface AssocArray extends NonGraphicalObject {
  readonly type: 'TRIYA_ARRAY';
  /** The array's INSERT (the owner of its extension dictionary). */
  readonly insert: Handle;
  /** DXF 340: the source block's BLOCK_RECORD. */
  readonly source: Handle;
  readonly params: AssocArrayParams;
  /**
   * Items ARRAYEDIT's REPlace put other objects in (M3-11 part 2): each an INSERT of its own
   * anonymous block instead of the source block. RESet takes them all back to the source.
   */
  readonly replaced?: readonly ReplacedItem[];
}

/**
 * Which item of an array: `item` along a row (a rectangular array's column, a polar or path
 * array's item) and `row` (a polar array's ring), both from 0. Items are made row by row.
 */
export interface ArrayItemKey {
  readonly item: number;
  readonly row: number;
}

/** An item REPlace gave other objects: DXF 92 item, 93 row, 341 the block's BLOCK_RECORD. */
export interface ReplacedItem extends ArrayItemKey {
  readonly block: Handle;
}

export type AssocArrayParams =
  | {
      readonly kind: 'rectangular';
      readonly columns: number;
      readonly rows: number;
      readonly columnSpacing: number;
      readonly rowSpacing: number;
    }
  | {
      readonly kind: 'polar';
      readonly center: Vec2;
      readonly base: Vec2;
      readonly items: number;
      /** Radians, + counterclockwise; ±2π fills the circle. */
      readonly fillAngle: number;
      readonly rows: number;
      readonly rowSpacing: number;
      readonly rotateItems: boolean;
    }
  | {
      readonly kind: 'path';
      /** DXF 331: the path curve; absent once it is erased (the items then stay as they are). */
      readonly path?: Handle;
      readonly method: 'divide' | 'measure';
      readonly base: Vec2;
      readonly tangent: Vec2;
      readonly spacing: number;
      readonly items: number;
      readonly rows: number;
      readonly rowSpacing: number;
      readonly align: boolean;
      /** Items run from the curve's end point back to its start. */
      readonly reversed: boolean;
    };

export const isAssocArray = (o: NonGraphicalObject | undefined): o is AssocArray =>
  o?.type === 'TRIYA_ARRAY';

/**
 * A dimension's breaks (DIMBREAK, M4-02 part 4, DEC-064): the `TRIYA_DIMBREAK` XRECORD in the
 * dimension's extension dictionary (`owner`, which the dimension's `extDict` names). The
 * dimension's `*D` block holds the gaps as drawn; this record says where they come from, so a
 * regeneration draws them again.
 */
export interface DimBreak extends NonGraphicalObject {
  readonly type: 'TRIYA_DIMBREAK';
  /**
   * The dimension (the owner of its extension dictionary), or the LEADER or MULTILEADER whose
   * breaks these are (M4-15, DEC-065).
   */
  readonly dimension: Handle;
  /**
   * DXF 331 each: the objects that break it (picked, or found by Auto); the gaps follow them
   * when either moves. One that is gone breaks nothing.
   */
  readonly objects: readonly Handle[];
  /** DXF 10 and 11 each: the two points of a manual break, in the dimension's space. */
  readonly manual: readonly (readonly [Vec2, Vec2])[];
}

export const isDimBreak = (o: NonGraphicalObject | undefined): o is DimBreak =>
  o?.type === 'TRIYA_DIMBREAK';

/** An inspection dimension's frame: semicircles, 90° points, or none (AutoCAD's Shape). */
export type InspectionShape = 'round' | 'angular' | 'none';

/**
 * A dimension's inspection data (DIMINSPECT, M4-02 part 4, DEC-064): the `TRIYA_DIMINSPECT`
 * XRECORD in the dimension's extension dictionary. The `*D` block holds the frame as drawn.
 */
export interface DimInspect extends NonGraphicalObject {
  readonly type: 'TRIYA_DIMINSPECT';
  readonly dimension: Handle;
  /** DXF 71: 0 round, 1 angular, 2 none. */
  readonly shape: InspectionShape;
  /** DXF 1: the label, left of the value; absent when the label is off. */
  readonly label?: string;
  /** DXF 3: the inspection rate, right of the value; absent when the rate is off. */
  readonly rate?: string;
}

export const isDimInspect = (o: NonGraphicalObject | undefined): o is DimInspect =>
  o?.type === 'TRIYA_DIMINSPECT';

/**
 * A center mark or centerline Triya made (CENTERMARK, CENTERLINE; M4-08): what keeps it
 * associative to the objects it was made on. The mark is an INSERT of an anonymous `*U` block of
 * lines, which every reader draws; the record (`owner` the INSERT's extension dictionary) says
 * how to draw it again when its objects change. A save writes it as a `TRIYA_CENTERMARK` XRECORD
 * in that dictionary (part 2, DEC-066), so a reopened mark is associative still.
 */
export interface CenterMark extends NonGraphicalObject {
  readonly type: 'TRIYA_CENTERMARK';
  /** The mark's INSERT. */
  readonly insert: Handle;
  /** A center mark on a circle or arc, or a centerline between two lines. */
  readonly kind: 'mark' | 'line';
  /** The circle or arc; the centerline's first and second line (a LINE or a polyline). */
  readonly objects: readonly Handle[];
  /**
   * A centerline's segment of each object (M4-29, DEC-068): the index of the vertex a polyline's
   * straight segment starts at, -1 for a LINE. Absent when every object is a LINE or a circle or
   * arc (the record DEC-066 sets out, version 1).
   */
  readonly segments?: readonly number[];
  /**
   * A center mark's cross size and gap as CENTERCROSSSIZE and CENTERCROSSGAP state them: a length,
   * or a factor of the circle's diameter followed by `x` (`0.1x`).
   */
  readonly crossSize?: string;
  readonly crossGap?: string;
  /**
   * How far each extension line goes past the object: a center mark's left, right, top and bottom
   * (in its own axes), a centerline's start and end.
   */
  readonly extensions: readonly number[];
  /** A center mark's extension lines are drawn (CENTERMARKEXE when it was made). */
  readonly showExtensions?: boolean;
}

export const isCenterMark = (o: NonGraphicalObject | undefined): o is CenterMark =>
  o?.type === 'TRIYA_CENTERMARK';

/**
 * What restoring a layer state sets (M5-07, DXF 91 of its XRECORD): ObjectARX's
 * `AcDbLayerStateManager::LayerStateMask`, the Layer States Manager's "Layer properties to
 * restore". `vpFrozen` is VP Freeze in the current viewport, `newVpFrozen` New VP Freeze. `hidden`
 * marks a state the manager does not list (a view's layer snapshot, `ACAD_VIEWS_<view>`), and
 * `lastRestored` the one restored last.
 */
export const LAYER_STATE_MASK = {
  on: 0x1,
  frozen: 0x2,
  locked: 0x4,
  plot: 0x8,
  newVpFrozen: 0x10,
  color: 0x20,
  linetype: 0x40,
  lineweight: 0x80,
  plotStyle: 0x100,
  vpFrozen: 0x200,
  transparency: 0x400,
  all: 0x7ff,
  hidden: 0x8000,
  lastRestored: 0x10000,
} as const;

/** One layer's settings as a layer state keeps them (M5-07). */
export interface LayerStateLayer {
  /** The layer (DXF 330); absent when the state names a layer the drawing does not have. */
  readonly layer?: Handle;
  /** The layer's name as the state was saved or read (DXF 8, or the layer's name for a 330). */
  readonly name: string;
  /** DXF 90: 1 off, 2 frozen, 4 locked, 8 plotted, 16 New VP frozen, 32 VP frozen. */
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly plot: boolean;
  readonly newVpFrozen: boolean;
  readonly vpFrozen: boolean;
  /** DXF 62, or 92 (and 300's colour book) for a true colour. */
  readonly color: Color;
  /** DXF 331: the LTYPE record, when the drawing has it. */
  readonly linetype?: Handle;
  /** The linetype's name (DXF 6 in a `.las` file). */
  readonly linetypeName: string;
  /** DXF 370. */
  readonly lineweight: Lineweight;
  /** DXF 1 (2 in a `.las` file): the plot style name, `Color_n` in a colour-dependent drawing. */
  readonly plotStyle: string;
  /** DXF 440: 0x02000000 | alpha, 0 for an opaque layer. */
  readonly transparency: Transparency;
}

/**
 * A named layer state (LAYERSTATE, M5-07): every layer's settings as they were when it was saved,
 * which restoring it sets again. AutoCAD keeps it as an XRECORD in the `ACAD_LAYERSTATES`
 * dictionary of the LAYER table's extension dictionary (`owner`), its entry name the state's
 * name. A `.las` file holds the same groups (LAYERSTATEDICTIONARY, LAYERSTATE).
 */
export interface LayerState extends NonGraphicalObject {
  readonly type: 'LAYER_STATE';
  readonly name: string;
  /** DXF 301. */
  readonly description: string;
  /** DXF 91: `LAYER_STATE_MASK` bits, what restoring it sets. */
  readonly mask: number;
  /** DXF 290: saved in a layout (paper space). */
  readonly paperSpace: boolean;
  /** DXF 302: the current layer's name when it was saved. */
  readonly currentLayer: string;
  readonly layers: readonly LayerStateLayer[];
}

export const isLayerState = (o: NonGraphicalObject | undefined): o is LayerState =>
  o?.type === 'LAYER_STATE';

/**
 * A layer filter (the Layer Properties Manager's filter tree, M5-07 part 4; DEC-076). AutoCAD
 * 2005+ keeps each as an XRECORD in the `ACLYDICTIONARY` dictionary of the LAYER table's
 * extension dictionary (`owner`): DXF 1 its class (`AcLyLayerFilter` for a property filter,
 * `AcLyLayerGroup` for a group filter), 300 its name, 301 a property filter's expression, 330 a
 * group filter's layers. A nested filter is filed in the `ACLYDICTIONARY` of its parent's
 * extension dictionary.
 */
export interface LayerFilter extends NonGraphicalObject {
  readonly type: 'LAYER_FILTER';
  /** DXF 300. */
  readonly name: string;
  /** DXF 1: `AcLyLayerFilter` (property) or `AcLyLayerGroup` (group). */
  readonly filterType: 'property' | 'group';
  /** DXF 301: a property filter's expression (ObjectARX `AcLyLayerFilter::filterExpression`). */
  readonly expression: string;
  /** DXF 330: a group filter's layers, as put in it. */
  readonly layers: readonly Handle[];
  /** The filter it is nested in, absent at the top of the tree. */
  readonly parent?: Handle;
  /** The `ACLYDICTIONARY` its nested filters are filed in, when it has one. */
  readonly nested?: Handle;
}

export const isLayerFilter = (o: NonGraphicalObject | undefined): o is LayerFilter =>
  o?.type === 'LAYER_FILTER';

/**
 * A component of the DGN line styles AutoCAD imports from MicroStation (M5-09 part 5): an entry
 * of the named-object dictionary's `ACAD_DGNLINESTYLECOMP` dictionary (`owner`), its entry name
 * `name`. A linetype made from a DGN line style has a `DGNLSDEF` line style definition in its
 * extension dictionary, which refers to the component drawing it; a compound refers to its parts,
 * a point component to the stroke pattern and the symbols it places, a symbol to the anonymous
 * block drawing it, each a hard pointer (DXF 340), which is all AutoCAD's DGN purge tool follows
 * (keanw.com, "Purging unwanted DGN linestyle data", 2012–2014). Triya does not draw them (a
 * linetype draws its own dashes) and keeps them as read; PURGE's "Orphaned data" removes those no
 * linetype uses (`orphanedData`). Its links are not under handle keys: a component uses neither
 * its linetypes nor, for PURGE's named items, its symbol blocks (anonymous, never listed).
 */
export interface DgnLinestyleComponent extends NonGraphicalObject {
  readonly type: 'DGN_LS_COMPONENT';
  /** Its entry name in `ACAD_DGNLINESTYLECOMP`. */
  readonly name: string;
  /** Its class, e.g. `AcDbLSStrokePatternComponent` (the CLASSES entry's C++ name). */
  readonly className: string;
  /** The linetypes whose line style definition (`DGNLSDEF`) refers to it. */
  readonly usedBy: readonly Handle[];
  /** The components it refers to (a compound's parts, a point component's stroke and symbols). */
  readonly parts: readonly Handle[];
  /** The block records it refers to (a symbol's anonymous block). */
  readonly symbolBlocks: readonly Handle[];
}

export const isDgnLinestyleComponent = (
  o: NonGraphicalObject | undefined,
): o is DgnLinestyleComponent => o?.type === 'DGN_LS_COMPONENT';

/**
 * One DXF group code of a `CodedObject`, as the save writes it. A handle code's value (DXF 5,
 * 105, 320–369, 390–399, 480, 481 and 1005: `isHandleCode`) is the handle.
 */
export interface DxfGroup {
  readonly code: number;
  readonly value: string | number | boolean | Uint8Array;
}

/** The CLASSES entry an object's type has in DXF (its DXF name is the object's `dxfName`). */
export interface DxfClassRecord {
  /** DXF 2: the C++ class name, e.g. `AcDbEvalGraph`. */
  readonly cppClassName: string;
  /** DXF 3: the application that defines it. */
  readonly applicationName: string;
  /** DXF 90: the proxy capability flags. */
  readonly proxyFlags: number;
  /** DXF 280: the class was not loaded when the file was saved. */
  readonly wasZombie: boolean;
}

/**
 * An object Triya keeps as the DXF group codes a save writes for it, without mapping what they
 * say (M2-32 part 4): what makes a block dynamic, which AutoCAD keeps in extension dictionaries
 * (a definition's `ACAD_ENHANCEDBLOCK` evaluation graph with its parameters, actions and grips,
 * a state's data, a reference's `AcDbBlockRepresentation`). Triya does not evaluate dynamic
 * blocks (PRD non-goal 2); it holds them as codes so that a paste can carry them into another
 * drawing, where the save writes them as they were. An object at the top of such a tree is an
 * entry of an extension dictionary (`owner`, which the holder's `extDict` names) under `key`;
 * the objects below are owned by the coded object they hang from.
 */
export interface CodedObject extends NonGraphicalObject {
  readonly type: 'CODED_OBJECT';
  /** DXF 0: the object's type, e.g. `ACAD_EVALUATION_GRAPH`. */
  readonly dxfName: string;
  /** Its name in the extension dictionary that owns it; absent below the top. */
  readonly key?: string;
  /** Every group code after DXF 0, its handle (5) and owner (330) among them, in order. */
  readonly codes: readonly DxfGroup[];
  /** Its type's CLASSES entry, for a type that has one. */
  readonly dxfClass?: DxfClassRecord;
}

/** DXF group codes whose value is a handle (DXF reference, "Group Code Value Types"). */
export const isHandleCode = (code: number): boolean =>
  code === 5 ||
  code === 105 ||
  (code >= 320 && code <= 369) ||
  (code >= 390 && code <= 399) ||
  code === 480 ||
  code === 481 ||
  code === 1005;

export const isCodedObject = (o: NonGraphicalObject | undefined): o is CodedObject =>
  o?.type === 'CODED_OBJECT';

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
  /**
   * The named-object (root) dictionary's handle, which drawing-wide objects a command creates
   * are filed under (WIPEOUT Frames' WIPEOUTVARIABLES, M2-08).
   */
  readonly rootDictionary?: Handle;
  /**
   * The `ACAD_IMAGE_DICT` and `ACAD_PDFDEFINITIONS` dictionaries' handles, which new IMAGEDEFs
   * and PDFDEFINITIONs are filed under (a paste's, M2-32): known even while they hold nothing.
   */
  readonly imageDictionary?: Handle;
  readonly pdfDictionary?: Handle;
  /**
   * The `ACAD_GROUP` dictionary's handle, which GROUP files new groups in (M3-08): known even
   * while it holds nothing. A drawing without one cannot hold groups.
   */
  readonly groupDictionary?: Handle;
  /**
   * The `ACAD_LAYERSTATES` dictionary's handle (M5-07), which new layer states are filed in: known
   * even while it holds none. A drawing without one gets it, under the LAYER table's extension
   * dictionary, with its first layer state.
   */
  readonly layerStateDictionary?: Handle;
  /**
   * The LAYER table's `ACLYDICTIONARY` (M5-07 part 4), which new top-level layer filters are filed
   * in: known even while it holds none. A drawing without one gets it with its first filter.
   */
  readonly layerFilterDictionary?: Handle;
  /**
   * The `ACAD_PLOTSETTINGS` dictionary's handle (M6-01 part 3), which PAGESETUP files new named
   * page setups in: known even while it holds none.
   */
  readonly plotSettingsDictionary?: Handle;
  /**
   * Names of style dictionary entries the I/O layer keeps without mapping (M2-29): an R13 or R14
   * DXF can list an R2007 STANDARD multileader style that acad-ts reads as a proxy object. The
   * engine does not see those styles, but a new one must not take their names, which the save
   * would refuse (it never replaces an entry it keeps as read).
   */
  readonly keptEntryNames?: { readonly mleaderStyles?: readonly string[] };
  /**
   * The drawing's annotation scales (the `ACAD_SCALELIST` dictionary's SCALEs, M2-59 part 4):
   * each one's name and value, paper units per drawing unit (0.02 for 1:50), which CANNOSCALE
   * names and CANNOSCALEVALUE is. Scales with no valid ratio are left out.
   */
  readonly annotationScales?: readonly AnnotationScale[];
}

/** An annotation scale of the drawing's scale list. */
export interface AnnotationScale {
  readonly name: string;
  /** Paper units per drawing unit (`CANNOSCALEVALUE`). */
  readonly value: number;
  /** The SCALE object's handle, which an annotative object's representations name (DXF 340). */
  readonly handle?: Handle;
}

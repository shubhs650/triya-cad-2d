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
// Each geometry is a kernel curve (geom/curves.ts) plus what the file carries beyond the plane,
// so `entity.geom` goes straight into kernel functions.

/**
 * Out-of-plane data for planar entities, carried so it round-trips. Geometry is 2D in the
 * entity's plane (OCS for circles/arcs/polylines, WCS XY otherwise); M1-04 decides how 3D-ish
 * input such as a non-default extrusion is presented.
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
export interface EllipseGeometry extends Ellipse {
  readonly normal?: Vec3;
}

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
  readonly closed: boolean;
  readonly periodic: boolean;
  readonly normal?: Vec3;
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
  | SplineGeometry;

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
}

export interface Layout extends ObjectCommon {
  readonly name: string;
  /** Tab order; Model is 0. */
  readonly tabOrder: number;
  /** BLOCK_RECORD holding this layout's entities. */
  readonly blockRecord: Handle;
}

/** A non-graphical object (dictionary, xrecord, layer state, scale, image def, …). */
export interface NonGraphicalObject extends ObjectCommon {
  /** DXF object type name, e.g. `DICTIONARY`. */
  readonly type: string;
  readonly owner: Handle;
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

// The Properties palette's contents (M2-21, UI_SPEC.md §4 "Properties"): what AutoCAD 2024's
// Properties palette lists for the selected objects, grouped as AutoCAD groups it (General,
// then the type's own sections; 3D Visualization omitted). With objects of more than one type
// selected it shows General only, and the type list ("All (5)", "Line (3)", …) narrows the
// sheet, and the edits, to one type. A value the objects do not share is `*VARIES*` (`varies`).
//
// Values are raw (distances and coordinates in drawing units, angles in radians counter-clockwise
// from world +X, as Properties shows them whatever ANGBASE says); the front-end formats them
// with the drawing's LUNITS/LUPREC and AUNITS/AUPREC (`units`).
import { distance, sub } from '../geom/vec';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import { dynamicBlockOf } from '../model/dynamic-block';
import type { EntityId } from '../model/entity-ids';
import type {
  Color,
  Entity,
  EntityGeometry,
  EntityType,
  Lineweight,
  LinetypeRef,
  Transparency,
} from '../model/types';
import { currentProps } from './current';
import { polylineArea, polylineLength } from './measure';
import {
  DIMVAR_ROWS,
  dimensionUnits,
  rowVars,
  type DimensionUnits,
  type DimvarRow,
  type DimvarSection,
} from './dimension';
import { JUSTIFICATIONS } from '../commands/modify/attributes';
import { bookColors } from '../model/book-colors';
import {
  hasThickness,
  hyperlinkOf,
  materialValue,
  namedPlotStyles,
  plotStyleValue,
  thicknessOf,
} from './general';

/** How a row's value is shown and typed. */
export type PropertyKind =
  /** A choice among `options` (Color, Layer, Linetype, Lineweight, Yes/No, …). */
  | 'choice'
  /** A choice that also takes a typed value (Transparency: ByLayer, ByBlock or 0–90). */
  | 'transparency'
  /** A length or coordinate, in drawing units (LUNITS). */
  | 'distance'
  /** An angle (AUNITS), radians. */
  | 'angle'
  /** An area, square drawing units. */
  | 'area'
  /** A plain number (scale factors, ratios). */
  | 'number'
  /** Text. */
  | 'text';

export type PropertyValue = number | string | boolean;

export interface PropertyOption {
  readonly value: string;
  readonly label: string;
}

export interface PropertyRow {
  /** What an edit names (`PropertyEdit.key`). */
  readonly key: string;
  /** AutoCAD's label: "Color", "Start X", "Linetype scale". */
  readonly label: string;
  readonly kind: PropertyKind;
  /** The shared value; undefined when it varies. A choice's value is an option's `value`. */
  readonly value?: PropertyValue;
  /** The objects do not share the value: shown as `*VARIES*`. */
  readonly varies?: true;
  readonly readOnly?: true;
  readonly options?: readonly PropertyOption[];
  /**
   * A colour row other than Color whose last choice opens the Select Color dialog on its Index
   * Color tab only: a dimension's DIMVAR colours, which `DSTYLE` overrides keep as ACIs.
   */
  readonly colorDialog?: 'index';
  /** An empty typed value is a value, not a slip to undo: Hyperlink's takes the link off. */
  readonly clearable?: true;
  /**
   * A navigation row (a polyline's Vertex, M2-35 part 8): a spinner from `min` to `max` that
   * changes which vertex the sheet shows (the session's `property-vertex`), not the drawing.
   */
  readonly spin?: { readonly min: number; readonly max: number };
  /**
   * The row's `...` button opens the In-Place Text Editor on the one object shown (an MTEXT's
   * Contents, M2-35 part 9): the session's `property-editor`, `PromptBus.editContents`.
   */
  readonly editor?: true;
}

export interface PropertySection {
  /** "General", "Geometry", "Text", "Misc", "Attributes", "Pattern". */
  readonly title: string;
  readonly rows: readonly PropertyRow[];
}

export interface PropertyTypeCount {
  readonly type: EntityType;
  /** AutoCAD's name for the type in the palette's list: "Line", "Block Reference". */
  readonly label: string;
  readonly count: number;
}

/**
 * What a dimension measures, unformatted (a length, or an angle in radians), as the dimension
 * engine (`@triya/dims` `measuredValue`) works it out; undefined when it cannot.
 */
export type DimensionMeasure = (e: Entity) => number | undefined;

export interface PropertySheet {
  /** How many objects are selected (all types). */
  readonly count: number;
  /** The selected objects' types, in the order first selected. */
  readonly types: readonly PropertyTypeCount[];
  /** The one type the sheet is narrowed to; undefined for all. */
  readonly filter?: EntityType;
  readonly sections: readonly PropertySection[];
  /**
   * FR-B3: the objects shown are references to one dynamic block, which Triya does not
   * evaluate (PRD non-goal 2): the palette shows "Dynamic — edit in AutoCAD", named by the
   * dynamic block (not its anonymous `*U` state).
   */
  readonly dynamic?: string;
  /**
   * Nothing is selected: the rows are the drawing's current settings, which new objects take
   * (CECOLOR, CLAYER, CELTYPE, CELTSCALE, CELWEIGHT, CETRANSPARENCY), and an edit sets them.
   */
  readonly current?: true;
  /**
   * The Select Color dialog's Color Books tab (M2-35 part 4): the colour books the drawing uses,
   * with the colours of each it uses, by name. Triya ships no colour books (AutoCAD's .acb files
   * are Autodesk's), and a colour-book colour saves only with the drawing's own DBCOLOR, so these
   * are all a choice can name. Left out when the drawing uses none, and with nothing selected
   * (CECOLOR holds no true colour, `applyCurrentEdit`).
   */
  readonly colorBooks?: readonly ColorBook[];
  /** How the front-end formats distances and angles: the drawing's units. */
  readonly units: PropertyUnits;
}

export interface ColorBook {
  /** The book's name, as the drawing spells it: "RAL CLASSIC". */
  readonly name: string;
  readonly colors: readonly ColorBookColor[];
}

export interface ColorBookColor {
  /** The colour's name in its book: "RAL 3020". */
  readonly name: string;
  /** The Color row's value that sets it (`colorValue`). */
  readonly value: string;
  readonly rgb: readonly [number, number, number];
}

export interface PropertyUnits {
  readonly lunits: number;
  readonly luprec: number;
  readonly aunits: number;
  readonly auprec: number;
}

/** AutoCAD's names for the types, as the Properties palette's list shows them. */
const TYPE_LABELS: Partial<Record<EntityType, string>> = {
  LINE: 'Line',
  XLINE: 'Xline',
  RAY: 'Ray',
  CIRCLE: 'Circle',
  ARC: 'Arc',
  ELLIPSE: 'Ellipse',
  POINT: 'Point',
  LWPOLYLINE: 'Polyline',
  POLYLINE: '2D Polyline',
  SPLINE: 'Spline',
  SOLID: '2D Solid',
  TRACE: 'Trace',
  '3DFACE': '3D Face',
  TEXT: 'Text',
  MTEXT: 'MText',
  ATTDEF: 'Attribute Definition',
  INSERT: 'Block Reference',
  DIMENSION: 'Dimension',
  ARC_DIMENSION: 'Arc Dimension',
  LARGE_RADIAL_DIMENSION: 'Jogged Radius Dimension',
  LEADER: 'Leader',
  TOLERANCE: 'Tolerance',
  MULTILEADER: 'MultiLeader',
  ACAD_TABLE: 'Table',
  IMAGE: 'Raster Image',
  WIPEOUT: 'Wipeout',
  PDFUNDERLAY: 'PDF Underlay',
  MLINE: 'MLine',
  VIEWPORT: 'Viewport',
  REGION: 'Region',
  OLE2FRAME: 'OLE Object',
  ACAD_PROXY_ENTITY: 'Proxy Entity',
  HATCH: 'Hatch',
};

export const typeLabel = (t: EntityType): string => TYPE_LABELS[t] ?? t;

/** ACI 1–7 by AutoCAD's names; other indices show as "Color n". */
const ACI_NAMES = ['', 'Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'];

/** An entity colour as a choice value: `ByLayer`, `ByBlock`, `aci:n`, `rgb:r,g,b`. */
export function colorValue(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'ByLayer';
    case 'byBlock':
      return 'ByBlock';
    case 'aci':
      return `aci:${c.index}`;
    case 'rgb':
      // A colour-book colour keeps its book and name in the value, so it is one choice.
      return `rgb:${c.r},${c.g},${c.b}${c.bookName ? `;${c.bookName};${c.colorName ?? ''}` : ''}`;
  }
}

export function colorLabel(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'ByLayer';
    case 'byBlock':
      return 'ByBlock';
    case 'aci':
      return ACI_NAMES[c.index] ?? `Color ${c.index}`;
    case 'rgb':
      return c.bookName ? `${c.bookName}$${c.colorName ?? ''}` : `${c.r},${c.g},${c.b}`;
  }
}

/** `colorBooks` by drawing, kept while its version stands: a sheet follows every pick. */
const booksSeen = new WeakMap<DocumentModel, { version: number; books: ColorBook[] }>();

/** The colour books the drawing uses, by name, each with its colours by name (`ColorBook`). */
export function colorBooks(model: DocumentModel): ColorBook[] {
  const seen = booksSeen.get(model);
  if (seen?.version === model.version) return seen.books;
  const books = readColorBooks(model);
  booksSeen.set(model, { version: model.version, books });
  return books;
}

function readColorBooks(model: DocumentModel): ColorBook[] {
  const books = new Map<string, { name: string; colors: ColorBookColor[] }>();
  for (const c of bookColors(model).values()) {
    if (c.kind !== 'rgb' || c.bookName === undefined || !c.colorName) continue;
    const key = c.bookName.toUpperCase();
    const book = books.get(key) ?? { name: c.bookName, colors: [] };
    books.set(key, book);
    book.colors.push({ name: c.colorName, value: colorValue(c), rgb: [c.r, c.g, c.b] });
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  return [...books.values()]
    .map((b) => ({ name: b.name, colors: b.colors.sort(byName) }))
    .sort(byName);
}

/** The colour a choice value names, or undefined. */
export function parseColorValue(v: string): Color | undefined {
  if (v === 'ByLayer') return { kind: 'byLayer' };
  if (v === 'ByBlock') return { kind: 'byBlock' };
  const aci = /^aci:(\d+)$/.exec(v);
  if (aci) {
    const index = Number(aci[1]);
    return index >= 1 && index <= 255 ? { kind: 'aci', index } : undefined;
  }
  const rgb = /^rgb:(\d+),(\d+),(\d+)(?:;([^;]*);(.*))?$/.exec(v);
  if (!rgb) return undefined;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
  if ([r, g, b].some((n) => n > 255)) return undefined;
  return rgb[4]
    ? { kind: 'rgb', r, g, b, bookName: rgb[4], colorName: rgb[5] ?? '' }
    : { kind: 'rgb', r, g, b };
}

const STANDARD_COLORS: readonly Color[] = [
  { kind: 'byLayer' },
  { kind: 'byBlock' },
  ...[1, 2, 3, 4, 5, 6, 7].map((index): Color => ({ kind: 'aci', index })),
];

/** AutoCAD's lineweights, hundredths of a millimetre (the Lineweight list). */
export const LINEWEIGHTS: readonly number[] = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

export const lineweightValue = (w: Lineweight): string => String(w);

export function lineweightLabel(w: Lineweight): string {
  return typeof w === 'number' ? `${(w / 100).toFixed(2)} mm` : w;
}

export function parseLineweightValue(v: string): Lineweight | undefined {
  if (v === 'ByLayer' || v === 'ByBlock' || v === 'Default') return v;
  const n = Number(v);
  return LINEWEIGHTS.includes(n) ? n : undefined;
}

/**
 * Transparency as Properties shows it: ByLayer, ByBlock, or a percentage 0–90 (AutoCAD's
 * range). DXF 440 keeps alpha 0–255, 255 opaque: percent = (1 − alpha/255) · 100.
 */
export function transparencyValue(t: Transparency): string | number {
  if (t === 'ByLayer' || t === 'ByBlock') return t;
  return Math.round((1 - t.alpha / 255) * 100);
}

export function transparencyOf(percent: number): Transparency {
  return { alpha: Math.round(((100 - percent) / 100) * 255) };
}

export const MAX_TRANSPARENCY = 90;

/** The value every one of `values` shares, by `key`, or `varies`. */
function shared<T>(
  values: readonly T[],
  key: (v: T) => unknown = (v) => v,
): { value?: T; varies?: true } {
  if (values.length === 0) return {};
  const first = values[0]!;
  const k = key(first);
  for (let i = 1; i < values.length; i++) if (key(values[i]!) !== k) return { varies: true };
  return { value: first };
}

/** How near two computed numbers must be to show as one value. */
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function sharedNumber(values: readonly number[]): { value?: number; varies?: true } {
  if (values.length === 0) return {};
  const first = values[0]!;
  return values.every((v) => close(v, first)) ? { value: first } : { varies: true };
}

interface RowSpec<E> {
  readonly key: string;
  readonly label: string;
  readonly kind: PropertyKind;
  readonly get: (e: E) => PropertyValue;
  readonly readOnly?: boolean;
  readonly options?: readonly PropertyOption[];
}

function row<E>(objects: readonly E[], spec: RowSpec<E>): PropertyRow {
  const values = objects.map(spec.get);
  const s =
    typeof values[0] === 'number'
      ? sharedNumber(values as number[])
      : shared<PropertyValue>(values);
  return {
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    ...(s.value !== undefined && { value: s.value }),
    ...(s.varies && { varies: true as const }),
    ...(spec.readOnly && { readOnly: true as const }),
    ...(spec.options && { options: spec.options }),
  };
}

const YES_NO: readonly PropertyOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const yesNo = (b: boolean): string => (b ? 'yes' : 'no');

/** A polyline's Linetype generation (PLINEGEN), as AutoCAD's palette names its values. */
const ENABLED_DISABLED: readonly PropertyOption[] = [
  { value: 'yes', label: 'Enabled' },
  { value: 'no', label: 'Disabled' },
];

/** DXF 75, a hatch's island detection, by AutoCAD's names. */
const ISLAND_STYLES: readonly PropertyOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'Outer' },
  { value: '2', label: 'Ignore' },
];

/** A hatch of pattern lines: neither a solid fill nor a gradient. */
export const isPatterned = (g: { readonly solid: boolean; readonly gradient?: unknown }): boolean =>
  !g.solid && g.gradient === undefined;

/** DXF 72/73 as AutoCAD's justification names (TEXT's Justify). */
export function textJustify(h: number, v: number): string {
  if (v === 0) return ['Left', 'Center', 'Right', 'Aligned', 'Middle', 'Fit'][h] ?? 'Left';
  const vertical = ['', 'Bottom', 'Middle', 'Top'][v] ?? '';
  return `${vertical} ${['left', 'center', 'right'][h] ?? 'left'}`;
}

/** MTEXT attachment 1–9 as AutoCAD's names. */
const MTEXT_JUSTIFY = [
  '',
  'Top left',
  'Top center',
  'Top right',
  'Middle left',
  'Middle center',
  'Middle right',
  'Bottom left',
  'Bottom center',
  'Bottom right',
];

/** A TEXT's Justify choices (M2-35 part 2), by AutoCAD's names: `textJustify` gives the value. */
const TEXT_JUSTIFY_OPTIONS: readonly PropertyOption[] = JUSTIFICATIONS.map((j) => ({
  value: j.name,
  label: j.name,
}));

/** An MTEXT's Justify choices: attachments 1–9, by name. */
const MTEXT_JUSTIFY_OPTIONS: readonly PropertyOption[] = MTEXT_JUSTIFY.slice(1).map((n) => ({
  value: n,
  label: n,
}));

/** The width every segment of a polyline has (`constantWidth`, DXF 43), or undefined. */
export function polylineGlobalWidth(g: {
  readonly constantWidth?: number;
  readonly vertices: readonly { readonly startWidth?: number; readonly endWidth?: number }[];
}): number | undefined {
  const widths = g.vertices.flatMap((v) => [v.startWidth, v.endWidth]);
  if (widths.every((w) => w === undefined)) return g.constantWidth ?? 0;
  const first = widths[0] ?? 0;
  return widths.every((w) => (w ?? 0) === first) ? first : undefined;
}

const arcSweep = (start: number, end: number): number => {
  const tau = 2 * Math.PI;
  const s = (((end - start) % tau) + tau) % tau;
  return s === 0 ? tau : s;
};

const polar = (c: Vec2, r: number, a: number): Vec2 => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});

const angleOf = (v: Vec2): number => {
  const a = Math.atan2(v.y, v.x);
  return a < 0 ? a + 2 * Math.PI : a;
};

type G<K extends EntityType> = Extract<EntityGeometry, { kind: K }>;
const geomOf = <K extends EntityType>(e: Entity): G<K> => e.geom as G<K>;

/**
 * A polyline's Global width (M2-35 part 2): `*VARIES*` where the polylines differ, or where one
 * polyline's segments do (AutoCAD shows those by segment, which vertex navigation will list).
 */
function globalWidthRow(widths: readonly (number | undefined)[]): PropertyRow {
  const first = widths[0];
  const one = first !== undefined && widths.every((w) => w !== undefined && close(w, first));
  return {
    key: 'globalWidth',
    label: 'Global width',
    kind: 'distance',
    ...(one ? { value: first } : { varies: true as const }),
  };
}

/**
 * A polyline's vertex rows (M2-35 part 8), as AutoCAD 2024's palette shows them for one polyline:
 * Vertex, a spinner from 1 to the vertex count, then the vertex's X and Y and the start and end
 * width of the segment leaving it (a constant-width polyline's segments all show DXF 43). The
 * keys name the vertex (`vertex:<index>:x`), so an edit reaches the vertex the sheet showed.
 * AutoCAD's help does not say what Vertex shows for several polylines; one number naming a
 * different point on each is no use to a drafter, so several polylines show none of these rows.
 */
function vertexRows(g: G<'LWPOLYLINE'>, at: number): PropertyRow[] {
  const n = g.vertices.length;
  if (n === 0) return [];
  const i = Math.min(Math.max(Math.trunc(at), 0), n - 1);
  const v = g.vertices[i]!;
  const width = (w: number | undefined) => w ?? g.constantWidth ?? 0;
  const key = (part: string) => `vertex:${i}:${part}`;
  return [
    { key: 'vertex', label: 'Vertex', kind: 'number', value: i + 1, spin: { min: 1, max: n } },
    { key: key('x'), label: 'Vertex X', kind: 'distance', value: v.x },
    { key: key('y'), label: 'Vertex Y', kind: 'distance', value: v.y },
    {
      key: key('startWidth'),
      label: 'Start segment width',
      kind: 'distance',
      value: width(v.startWidth),
    },
    {
      key: key('endWidth'),
      label: 'End segment width',
      kind: 'distance',
      value: width(v.endWidth),
    },
  ];
}

/** The sections a selection of one type shows after General. */
function typeSections(
  model: DocumentModel,
  type: EntityType,
  es: readonly Entity[],
  vertex: number,
  measure: DimensionMeasure | undefined,
) {
  const sections: PropertySection[] = [];
  const add = (title: string, rows: PropertyRow[]) => {
    if (rows.length > 0) sections.push({ title, rows });
  };
  // M2-35 part 2: a text's Style is a choice of the drawing's text styles, by handle.
  const textStyles: readonly PropertyOption[] = [...model.tables.textStyles.values()].map((r) => ({
    value: r.handle as string,
    label: r.name,
  }));
  switch (type) {
    case 'LINE': {
      const g = (e: Entity) => geomOf<'LINE'>(e);
      add('Geometry', [
        row(es, { key: 'startX', label: 'Start X', kind: 'distance', get: (e) => g(e).start.x }),
        row(es, { key: 'startY', label: 'Start Y', kind: 'distance', get: (e) => g(e).start.y }),
        row(es, { key: 'endX', label: 'End X', kind: 'distance', get: (e) => g(e).end.x }),
        row(es, { key: 'endY', label: 'End Y', kind: 'distance', get: (e) => g(e).end.y }),
        row(es, {
          key: 'deltaX',
          label: 'Delta X',
          kind: 'distance',
          readOnly: true,
          get: (e) => g(e).end.x - g(e).start.x,
        }),
        row(es, {
          key: 'deltaY',
          label: 'Delta Y',
          kind: 'distance',
          readOnly: true,
          get: (e) => g(e).end.y - g(e).start.y,
        }),
        row(es, {
          key: 'length',
          label: 'Length',
          kind: 'distance',
          readOnly: true,
          get: (e) => distance(g(e).start, g(e).end),
        }),
        row(es, {
          key: 'angle',
          label: 'Angle',
          kind: 'angle',
          readOnly: true,
          get: (e) => angleOf(sub(g(e).end, g(e).start)),
        }),
      ]);
      break;
    }
    case 'CIRCLE': {
      const g = (e: Entity) => geomOf<'CIRCLE'>(e);
      add('Geometry', [
        row(es, { key: 'centerX', label: 'Center X', kind: 'distance', get: (e) => g(e).center.x }),
        row(es, { key: 'centerY', label: 'Center Y', kind: 'distance', get: (e) => g(e).center.y }),
        row(es, { key: 'radius', label: 'Radius', kind: 'distance', get: (e) => g(e).radius }),
        row(es, {
          key: 'diameter',
          label: 'Diameter',
          kind: 'distance',
          get: (e) => 2 * g(e).radius,
        }),
        row(es, {
          key: 'circumference',
          label: 'Circumference',
          kind: 'distance',
          get: (e) => 2 * Math.PI * g(e).radius,
        }),
        row(es, {
          key: 'area',
          label: 'Area',
          kind: 'area',
          get: (e) => Math.PI * g(e).radius ** 2,
        }),
      ]);
      break;
    }
    case 'ARC': {
      const g = (e: Entity) => geomOf<'ARC'>(e);
      const sweep = (e: Entity) => arcSweep(g(e).startAngle, g(e).endAngle);
      add('Geometry', [
        row(es, {
          key: 'startX',
          label: 'Start X',
          kind: 'distance',
          readOnly: true,
          get: (e) => polar(g(e).center, g(e).radius, g(e).startAngle).x,
        }),
        row(es, {
          key: 'startY',
          label: 'Start Y',
          kind: 'distance',
          readOnly: true,
          get: (e) => polar(g(e).center, g(e).radius, g(e).startAngle).y,
        }),
        row(es, { key: 'centerX', label: 'Center X', kind: 'distance', get: (e) => g(e).center.x }),
        row(es, { key: 'centerY', label: 'Center Y', kind: 'distance', get: (e) => g(e).center.y }),
        row(es, {
          key: 'endX',
          label: 'End X',
          kind: 'distance',
          readOnly: true,
          get: (e) => polar(g(e).center, g(e).radius, g(e).endAngle).x,
        }),
        row(es, {
          key: 'endY',
          label: 'End Y',
          kind: 'distance',
          readOnly: true,
          get: (e) => polar(g(e).center, g(e).radius, g(e).endAngle).y,
        }),
        row(es, { key: 'radius', label: 'Radius', kind: 'distance', get: (e) => g(e).radius }),
        row(es, {
          key: 'startAngle',
          label: 'Start angle',
          kind: 'angle',
          get: (e) => g(e).startAngle,
        }),
        row(es, { key: 'endAngle', label: 'End angle', kind: 'angle', get: (e) => g(e).endAngle }),
        row(es, {
          key: 'totalAngle',
          label: 'Total angle',
          kind: 'angle',
          readOnly: true,
          get: sweep,
        }),
        row(es, {
          key: 'arcLength',
          label: 'Arc length',
          kind: 'distance',
          readOnly: true,
          get: (e) => g(e).radius * sweep(e),
        }),
        row(es, {
          key: 'area',
          label: 'Area',
          kind: 'area',
          readOnly: true,
          // The area between the arc and its chord, as AutoCAD's Area for an arc.
          get: (e) => (g(e).radius ** 2 / 2) * (sweep(e) - Math.sin(sweep(e))),
        }),
      ]);
      break;
    }
    case 'ELLIPSE': {
      const g = (e: Entity) => geomOf<'ELLIPSE'>(e);
      const major = (e: Entity) => Math.hypot(g(e).majorAxis.x, g(e).majorAxis.y);
      add('Geometry', [
        row(es, { key: 'centerX', label: 'Center X', kind: 'distance', get: (e) => g(e).center.x }),
        row(es, { key: 'centerY', label: 'Center Y', kind: 'distance', get: (e) => g(e).center.y }),
        row(es, {
          key: 'majorRadius',
          label: 'Major radius',
          kind: 'distance',
          readOnly: true,
          get: major,
        }),
        row(es, {
          key: 'minorRadius',
          label: 'Minor radius',
          kind: 'distance',
          readOnly: true,
          get: (e) => major(e) * g(e).ratio,
        }),
        row(es, {
          key: 'radiusRatio',
          label: 'Radius ratio',
          kind: 'number',
          readOnly: true,
          get: (e) => g(e).ratio,
        }),
      ]);
      break;
    }
    case 'POINT': {
      const g = (e: Entity) => geomOf<'POINT'>(e);
      add('Geometry', [
        row(es, {
          key: 'positionX',
          label: 'Position X',
          kind: 'distance',
          get: (e) => g(e).position.x,
        }),
        row(es, {
          key: 'positionY',
          label: 'Position Y',
          kind: 'distance',
          get: (e) => g(e).position.y,
        }),
      ]);
      break;
    }
    case 'LWPOLYLINE': {
      const g = (e: Entity) => geomOf<'LWPOLYLINE'>(e);
      add('Geometry', [
        ...(es.length === 1 ? vertexRows(g(es[0]!), vertex) : []),
        // AutoCAD lists Global width before Elevation.
        globalWidthRow(es.map((e) => polylineGlobalWidth(g(e)))),
        row(es, {
          key: 'elevation',
          label: 'Elevation',
          kind: 'distance',
          get: (e) => g(e).elevation ?? 0,
        }),
        row(es, {
          key: 'length',
          label: 'Length',
          kind: 'distance',
          readOnly: true,
          get: (e) => polylineLength(g(e)),
        }),
        row(es, {
          key: 'area',
          label: 'Area',
          kind: 'area',
          readOnly: true,
          get: (e) => polylineArea(g(e)),
        }),
      ]);
      add('Misc', [
        row(es, {
          key: 'closed',
          label: 'Closed',
          kind: 'choice',
          options: YES_NO,
          get: (e) => yesNo(g(e).closed),
        }),
        row(es, {
          key: 'plinegen',
          label: 'Linetype generation',
          kind: 'choice',
          options: ENABLED_DISABLED,
          get: (e) => yesNo(g(e).plinegen ?? false),
        }),
      ]);
      break;
    }
    case 'TEXT': {
      const g = (e: Entity) => geomOf<'TEXT'>(e);
      add('Text', [
        row(es, { key: 'contents', label: 'Contents', kind: 'text', get: (e) => g(e).value }),
        row(es, {
          key: 'style',
          label: 'Style',
          kind: 'choice',
          options: textStyles,
          get: (e) => g(e).style,
        }),
        row(es, {
          key: 'justify',
          label: 'Justify',
          kind: 'choice',
          options: TEXT_JUSTIFY_OPTIONS,
          get: (e) => textJustify(g(e).halign, g(e).valign),
        }),
        row(es, { key: 'height', label: 'Height', kind: 'distance', get: (e) => g(e).height }),
        row(es, { key: 'rotation', label: 'Rotation', kind: 'angle', get: (e) => g(e).rotation }),
        row(es, {
          key: 'widthFactor',
          label: 'Width factor',
          kind: 'number',
          get: (e) => g(e).widthFactor,
        }),
        row(es, { key: 'oblique', label: 'Obliquing', kind: 'angle', get: (e) => g(e).oblique }),
      ]);
      add('Geometry', [
        row(es, {
          key: 'positionX',
          label: 'Position X',
          kind: 'distance',
          get: (e) => textPositionOf(g(e)).x,
        }),
        row(es, {
          key: 'positionY',
          label: 'Position Y',
          kind: 'distance',
          get: (e) => textPositionOf(g(e)).y,
        }),
      ]);
      add('Misc', [
        row(es, {
          key: 'upsideDown',
          label: 'Upside down',
          kind: 'choice',
          options: YES_NO,
          get: (e) => yesNo(g(e).upsideDown),
        }),
        row(es, {
          key: 'backward',
          label: 'Backward',
          kind: 'choice',
          options: YES_NO,
          get: (e) => yesNo(g(e).backward),
        }),
      ]);
      break;
    }
    case 'MTEXT': {
      const g = (e: Entity) => geomOf<'MTEXT'>(e);
      // AutoCAD 2024 edits an MTEXT's contents in the In-Place Text Editor, which the row's
      // `...` button opens; the editor edits one object, so several show no button.
      const contents = row(es, {
        key: 'contents',
        label: 'Contents',
        kind: 'text',
        readOnly: true,
        get: (e) => g(e).contents,
      });
      add('Text', [
        es.length === 1 ? { ...contents, editor: true as const } : contents,
        row(es, {
          key: 'style',
          label: 'Style',
          kind: 'choice',
          options: textStyles,
          get: (e) => g(e).style,
        }),
        row(es, {
          key: 'justify',
          label: 'Justify',
          kind: 'choice',
          options: MTEXT_JUSTIFY_OPTIONS,
          get: (e) => MTEXT_JUSTIFY[g(e).attachment] ?? 'Top left',
        }),
        row(es, { key: 'height', label: 'Text height', kind: 'distance', get: (e) => g(e).height }),
        row(es, { key: 'rotation', label: 'Rotation', kind: 'angle', get: (e) => g(e).rotation }),
        row(es, {
          key: 'lineSpacing',
          label: 'Line space factor',
          kind: 'number',
          get: (e) => g(e).lineSpacing,
        }),
        row(es, {
          key: 'width',
          label: 'Defined width',
          kind: 'distance',
          get: (e) => g(e).width,
        }),
      ]);
      add('Geometry', [
        row(es, {
          key: 'positionX',
          label: 'Position X',
          kind: 'distance',
          get: (e) => g(e).position.x,
        }),
        row(es, {
          key: 'positionY',
          label: 'Position Y',
          kind: 'distance',
          get: (e) => g(e).position.y,
        }),
      ]);
      break;
    }
    case 'INSERT': {
      const g = (e: Entity) => geomOf<'INSERT'>(e);
      add('Geometry', [
        row(es, {
          key: 'positionX',
          label: 'Position X',
          kind: 'distance',
          get: (e) => g(e).position.x,
        }),
        row(es, {
          key: 'positionY',
          label: 'Position Y',
          kind: 'distance',
          get: (e) => g(e).position.y,
        }),
        row(es, {
          key: 'scaleX',
          label: 'Scale X',
          kind: 'number',
          get: (e) => g(e).scale.x,
        }),
        row(es, {
          key: 'scaleY',
          label: 'Scale Y',
          kind: 'number',
          get: (e) => g(e).scale.y,
        }),
        row(es, {
          key: 'scaleZ',
          label: 'Scale Z',
          kind: 'number',
          get: (e) => g(e).scale.z,
        }),
      ]);
      add('Misc', [
        row(es, {
          key: 'name',
          label: 'Name',
          kind: 'text',
          readOnly: true,
          // A dynamic block's reference is named by the dynamic block, not its `*U` state.
          get: (e) =>
            dynamicBlockOf(model.blocks, g(e).block)?.name ??
            model.tables.blockRecords.get(g(e).block)?.name ??
            g(e).block,
        }),
        row(es, { key: 'rotation', label: 'Rotation', kind: 'angle', get: (e) => g(e).rotation }),
      ]);
      if (es.length === 1) {
        // One reference: its attributes by tag, as AutoCAD's Attributes section lists them.
        // A multiline attribute is edited in the Enhanced Attribute Editor (EATTEDIT).
        const attributes = g(es[0]!).attributes;
        add(
          'Attributes',
          attributes.map((a) => ({
            key: `attribute:${a.handle}`,
            label: a.tag,
            kind: 'text' as const,
            value: a.mtext ? a.mtext.contents : a.value,
            ...(a.mtext && { readOnly: true as const }),
          })),
        );
      }
      break;
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      const g = (e: Entity) => geomOf<'DIMENSION'>(e);
      const styles = [...model.tables.dimStyles.values()]
        .map((r) => ({ value: r.handle as string, label: r.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
      // A DIMVAR row shows what the dimension is drawn with: its style's value, or its override.
      const vars = es.map((e) => rowVars(g(e).style, e.xdata, model));
      // An angular dimension's units are angular ones (M2-35 part 10); a selection of both
      // kinds shows the rows both have, as AutoCAD's palette shows what the objects share.
      const kinds = new Set<DimensionUnits>(es.map((e) => dimensionUnits(g(e))));
      const shows = (d: DimvarRow) => d.for === undefined || (kinds.size === 1 && kinds.has(d.for));
      const dimvar = (d: DimvarRow): PropertyRow => {
        const options = typeof d.options === 'function' ? d.options(model, vars[0]!) : d.options;
        return {
          ...row(vars, {
            key: `dimvar:${d.name}`,
            label: d.label,
            kind: d.kind,
            ...(options && { options }),
            get: (v) => d.get(v, model),
          }),
          ...(d.color && { colorDialog: 'index' as const }),
        };
      };
      const group = (title: DimvarSection) =>
        DIMVAR_ROWS.filter((d) => d.section === title && shows(d)).map(dimvar);
      // Measurement: AutoCAD's read-only row of what the dimension measures, a length in the
      // drawing's units or an angle in its angular ones.
      const measured = measure ? es.map((e) => measure(e)) : [];
      const measurement: PropertyRow[] =
        measured.length === 0 || measured.some((m) => m === undefined)
          ? []
          : kinds.size === 1
            ? [
                row(measured as number[], {
                  key: 'measurement',
                  label: 'Measurement',
                  kind: kinds.has('angular') ? 'angle' : 'distance',
                  readOnly: true,
                  get: (m) => m,
                }),
              ]
            : [
                {
                  key: 'measurement',
                  label: 'Measurement',
                  kind: 'text',
                  varies: true,
                  readOnly: true,
                },
              ];
      add('Misc', [
        row(es, {
          key: 'dimStyle',
          label: 'Dim style',
          kind: 'choice',
          options: styles,
          get: (e) => g(e).style,
        }),
      ]);
      add('Lines & Arrows', group('Lines & Arrows'));
      add('Text', [
        ...group('Text'),
        row(es, {
          key: 'textRotation',
          label: 'Text rotation',
          kind: 'angle',
          readOnly: true,
          get: (e) => g(e).textRotation,
        }),
        ...measurement,
        row(es, {
          key: 'textOverride',
          label: 'Text override',
          kind: 'text',
          get: (e) => g(e).text,
        }),
      ]);
      add('Fit', group('Fit'));
      add('Primary Units', group('Primary Units'));
      add('Alternate Units', group('Alternate Units'));
      add('Tolerances', group('Tolerances'));
      break;
    }
    case 'HATCH': {
      const g = (e: Entity) => geomOf<'HATCH'>(e);
      // M2-35 part 3: AutoCAD 2024's Pattern rows. A gradient's own rows (gradient name,
      // colours, centred) are not edited yet, so its rows stay read only; a solid fill has no
      // lines to turn or scale, so its Angle and Scale are greyed as AutoCAD greys them. Each
      // row edits the hatches it applies to: Scale the predefined and custom patterns, Spacing
      // and Double the user-defined ones (DXF 76 = 0, whose DXF 41 is the spacing).
      const gradient = es.some((e) => g(e).gradient);
      const patterned = es.filter((e) => isPatterned(g(e)));
      const scaled = patterned.filter((e) => g(e).patternType !== 0);
      const user = patterned.filter((e) => g(e).patternType === 0);
      const angleRow = (objects: readonly Entity[], readOnly: boolean) =>
        row(objects, {
          key: 'patternAngle',
          label: 'Angle',
          kind: 'angle',
          ...(readOnly && { readOnly }),
          get: (e) => g(e).patternAngle,
        });
      const scaleRow = (objects: readonly Entity[], readOnly: boolean) =>
        row(objects, {
          key: 'patternScale',
          label: 'Scale',
          kind: 'number',
          ...(readOnly && { readOnly }),
          get: (e) => g(e).patternScale,
        });
      add('Pattern', [
        row(es, {
          key: 'patternType',
          label: 'Type',
          kind: 'text',
          readOnly: true,
          get: (e) =>
            g(e).gradient
              ? 'Gradient'
              : (['User defined', 'Predefined', 'Custom'][g(e).patternType] ?? 'Predefined'),
        }),
        row(es, {
          key: 'patternName',
          label: 'Pattern name',
          kind: 'text',
          ...(gradient && { readOnly: true }),
          get: (e) => g(e).gradient?.name ?? g(e).pattern,
        }),
        patterned.length > 0 ? angleRow(patterned, false) : angleRow(es, true),
        ...(scaled.length > 0
          ? [scaleRow(scaled, false)]
          : user.length === 0
            ? [scaleRow(es, true)]
            : []),
        ...(user.length > 0
          ? [
              row(user, {
                key: 'patternSpacing',
                label: 'Spacing',
                kind: 'distance',
                get: (e) => g(e).patternScale,
              }),
              row(user, {
                key: 'double',
                label: 'Double',
                kind: 'choice',
                options: YES_NO,
                get: (e) => yesNo(g(e).double),
              }),
            ]
          : []),
        row(es, {
          key: 'associative',
          label: 'Associative',
          kind: 'choice',
          readOnly: true,
          options: YES_NO,
          get: (e) => yesNo(g(e).associative),
        }),
        row(es, {
          key: 'islandStyle',
          label: 'Island detection style',
          kind: 'choice',
          options: ISLAND_STYLES,
          get: (e) => String(g(e).style),
        }),
      ]);
      break;
    }
    default:
      break;
  }
  return sections;
}

/**
 * Where Properties puts a TEXT (Position X/Y): its alignment point when the text is not
 * left-baseline (DXF 11, which AutoCAD keeps while DXF 10 is recomputed), otherwise DXF 10.
 */
export function textPositionOf(g: {
  readonly position: Vec2;
  readonly alignmentPoint?: Vec2;
  readonly halign: number;
  readonly valign: number;
}): Vec2 {
  return (g.halign !== 0 || g.valign !== 0) && g.alignmentPoint ? g.alignmentPoint : g.position;
}

function headerNumber(model: DocumentModel, name: string, fallback: number): number {
  const v = model.header.get(name);
  return typeof v === 'number' ? v : fallback;
}

export function propertyUnits(model: DocumentModel): PropertyUnits {
  return {
    lunits: headerNumber(model, '$LUNITS', 2),
    luprec: headerNumber(model, '$LUPREC', 4),
    aunits: headerNumber(model, '$AUNITS', 0),
    auprec: headerNumber(model, '$AUPREC', 0),
  };
}

/** The selected objects of the type the sheet is narrowed to (all when `filter` is undefined). */
export function filtered(
  model: DocumentModel,
  ids: readonly EntityId[],
  filter: EntityType | undefined,
): Entity[] {
  const out: Entity[] = [];
  for (const id of ids) {
    const e = model.entity(id);
    if (e && (filter === undefined || e.type === filter)) out.push(e);
  }
  return out;
}

/** The properties every object has, and the drawing's current settings for new objects. */
export type GeneralProps = Pick<
  Entity,
  'color' | 'layer' | 'linetype' | 'ltScale' | 'lineweight' | 'transparency'
>;

/**
 * General's rows: Color, Layer, Linetype, Linetype scale, Lineweight and Transparency, and for
 * selected objects (`entities`) Plot style, Hyperlink and Thickness in AutoCAD's places (M2-35
 * part 6, `general.ts`).
 */
function generalRows(
  model: DocumentModel,
  es: readonly GeneralProps[],
  entities?: readonly Entity[],
): PropertyRow[] {
  const layers = [...model.tables.layers.values()]
    .map((l) => ({ value: l.handle as string, label: l.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const linetypes: PropertyOption[] = [
    { value: 'ByLayer', label: 'ByLayer' },
    { value: 'ByBlock', label: 'ByBlock' },
    ...[...model.tables.linetypes.values()]
      .filter((l) => !/^(BYLAYER|BYBLOCK)$/i.test(l.name))
      .map((l) => ({ value: l.handle as string, label: l.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const colors = new Map<string, string>(
    STANDARD_COLORS.map((c) => [colorValue(c), colorLabel(c)]),
  );
  for (const e of es) {
    const v = colorValue(e.color);
    if (!colors.has(v)) colors.set(v, colorLabel(e.color));
  }
  const weights: PropertyOption[] = [
    ...(['ByLayer', 'ByBlock', 'Default'] as const).map((w) => ({ value: w, label: w })),
    ...LINEWEIGHTS.map((w) => ({ value: String(w), label: lineweightLabel(w) })),
  ];
  const linetypeValue = (l: LinetypeRef): string => l;

  const rows = [
    row(es, {
      key: 'color',
      label: 'Color',
      kind: 'choice',
      options: [...colors].map(([value, label]) => ({ value, label })),
      get: (e) => colorValue(e.color),
    }),
    row(es, { key: 'layer', label: 'Layer', kind: 'choice', options: layers, get: (e) => e.layer }),
    row(es, {
      key: 'linetype',
      label: 'Linetype',
      kind: 'choice',
      options: linetypes,
      get: (e) => linetypeValue(e.linetype),
    }),
    row(es, { key: 'ltScale', label: 'Linetype scale', kind: 'number', get: (e) => e.ltScale }),
    row(es, {
      key: 'lineweight',
      label: 'Lineweight',
      kind: 'choice',
      options: weights,
      get: (e) => lineweightValue(e.lineweight),
    }),
    row(es, {
      key: 'transparency',
      label: 'Transparency',
      kind: 'transparency',
      options: [
        { value: 'ByLayer', label: 'ByLayer' },
        { value: 'ByBlock', label: 'ByBlock' },
      ],
      get: (e) => transparencyValue(e.transparency),
    }),
  ];
  if (!entities) return rows;
  const named = namedPlotStyles(model);
  const plotStyle = row(entities, {
    key: 'plotStyle',
    label: 'Plot style',
    kind: named ? 'choice' : 'text',
    readOnly: !named,
    ...(named && {
      options: [
        { value: 'ByLayer', label: 'ByLayer' },
        ...[...model.tables.plotStyles.values()].map((r) => ({
          value: r.handle as string,
          label: r.name,
        })),
      ],
    }),
    get: (e) => plotStyleValue(model, e),
  });
  const hyperlink: PropertyRow = {
    ...row(entities, {
      key: 'hyperlink',
      label: 'Hyperlink',
      kind: 'text',
      get: (e) => hyperlinkOf(model, e),
    }),
    clearable: true,
  };
  const thickness = entities.every(hasThickness)
    ? [row(entities, { key: 'thickness', label: 'Thickness', kind: 'distance', get: thicknessOf })]
    : [];
  // AutoCAD's order: Plot style after Linetype scale, Hyperlink and Thickness last.
  return [...rows.slice(0, 4), plotStyle, ...rows.slice(4), hyperlink, ...thickness];
}

/**
 * The 3D Visualization group's Material (M2-35 part 6): ByLayer and the drawing's materials, in
 * ACAD_MATERIAL's order. None for a drawing without materials (before R2007).
 */
function visualizationRows(model: DocumentModel, es: readonly Entity[]): PropertyRow[] {
  const materials = [...model.tables.materials.values()];
  if (materials.length === 0) return [];
  const options: PropertyOption[] = [
    { value: 'ByLayer', label: 'ByLayer' },
    ...materials
      .filter((m) => m.name.toUpperCase() !== 'BYLAYER')
      .map((m) => ({ value: m.handle as string, label: m.name })),
  ];
  return [
    row(es, {
      key: 'material',
      label: 'Material',
      kind: 'choice',
      options,
      get: (e) => materialValue(model, e),
    }),
  ];
}

/**
 * The Properties palette's sheet for the objects `ids`, narrowed to `filter` (a type among
 * them; any other shows all). With nothing selected, AutoCAD's "No selection": General with the
 * drawing's current settings for new objects (`current`, M2-35).
 */
export function propertySheet(
  model: DocumentModel,
  ids: readonly EntityId[],
  filter?: EntityType,
  /** The polyline vertex shown, from 0 (M2-35 part 8); kept within the polyline. */
  vertex = 0,
  /** What a dimension measures, from the dimension engine (M2-35 part 10); none without. */
  measure?: DimensionMeasure,
): PropertySheet {
  const all = filtered(model, ids, undefined);
  const counts = new Map<EntityType, number>();
  for (const e of all) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const types = [...counts].map(([type, count]) => ({ type, label: typeLabel(type), count }));
  const narrowed = filter !== undefined && counts.has(filter) ? filter : undefined;
  const es = narrowed ? all.filter((e) => e.type === narrowed) : all;
  const units = propertyUnits(model);
  if (ids.length === 0) {
    const sections = [{ title: 'General', rows: generalRows(model, [currentProps(model)]) }];
    return { count: 0, types: [], sections, current: true, units };
  }
  if (es.length === 0) return { count: 0, types: [], sections: [], units };

  const general = generalRows(model, es, es);
  const visualization = visualizationRows(model, es);
  const oneType = narrowed ?? (counts.size === 1 ? es[0]!.type : undefined);
  const sections: PropertySection[] = [
    { title: 'General', rows: general },
    ...(visualization.length > 0 ? [{ title: '3D Visualization', rows: visualization }] : []),
    ...(oneType ? typeSections(model, oneType, es, vertex, measure) : []),
  ];
  const dynamic =
    oneType === 'INSERT'
      ? shared(es.map((e) => dynamicBlockOf(model.blocks, geomOf<'INSERT'>(e).block)?.name ?? ''))
          .value || undefined
      : undefined;
  const books = colorBooks(model);
  return {
    count: all.length,
    types,
    ...(narrowed && { filter: narrowed }),
    sections,
    ...(dynamic && { dynamic }),
    ...(books.length > 0 && { colorBooks: books }),
    units,
  };
}

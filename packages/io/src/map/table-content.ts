// The TABLECONTENT object of an AC1032 DXF (M4-28): what AutoCAD keeps of a table that the
// legacy ACAD_TABLE codes cannot state (each row's, column's and cell's cell style, cell locks,
// custom data, border linetypes and double lines, several contents in a cell), named by the
// table's `ACAD_ROUNDTRIP_2008_TABLE_ENTITY` XRECORD. acad-ts reads and writes the object raw
// (patch 0070, DEC-040); this reads its codes into acad-ts's own table content classes, the
// ones its DWG reader fills for an R2010+ table, and writes them back.
//
// The layout is the DWG R2010+ table content (acad-ts `DwgObjectReader._readTableContent`)
// spelled out in DXF, each part between `<NAME>_BEGIN` (1) and `<NAME>_END` (309) markers, as
// AutoCAD writes it (acadsharp sample_AC1015…AC1032, ezdxf acad_table_*): the LinkedData name
// and description; the columns (name, custom data, cell style, style id, width); the rows
// (cells, custom data, cell style, style id, height); each cell's state, tooltip, custom data,
// data link, contents (a value, field or block, attributes, content format), cell style, style
// id and geometry; the field references; the table's cell style; the merged ranges; the style.
// Reading then writing a corpus TABLECONTENT gives its codes back as they were
// (`table-content.corpus.test.ts`): what the classes do not hold (which borders a cell style
// lists, a value's data of a type Triya does not edit, a true colour's name) is kept beside them.
//
// Values are framed as R2007 and later frame them (93 flags, 90 type, data, 94 units, 300
// format, 302 formatted value, 304 ACVALUE_END); a value as a DXF before R2007 wrote it (90 and
// its data only) is read too and written framed, as acad-ts's raw writer frames it (0070).
import type { CadValue, CellBorder, CellStyle } from '@node-projects/acad-ts';
import {
  CadValueType,
  CellContent,
  CellContentGeometry,
  CellEdgeFlags,
  CellRange,
  Color,
  CustomDataEntry,
  MathHelper,
  TableAttribute,
  TableCellContentType,
  TableContent,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  XRecord,
  XYZ,
  type CadObject,
  type ContentFormat,
  type TableEntity,
} from '@node-projects/acad-ts';

/** One group code as acad-ts keeps raw codes: strings caret-escaped, handles as numbers. */
export interface RawCode {
  readonly code: number;
  readonly value: unknown;
}

/** An object a handle names, or a stand-in holding the handle when the drawing has none. */
export type HandleTarget = { readonly handle: number };
type Resolve = (handle: number) => CadObject | null;

/** What the classes do not hold, kept so that a write gives the codes back as read. */
const listedBorders = new WeakMap<CellStyle, CellEdgeFlags[]>();
const valueData = new WeakMap<CadValue, { value: unknown; codes: RawCode[] }>();
const trueColors = new WeakMap<Color, RawCode[]>();

const DATA_END = new Set([94, 304]);

const unescape = (s: string): string =>
  s.replace(/\^(.)/g, (_, c: string) =>
    c === ' ' ? '^' : String.fromCharCode(c.charCodeAt(0) - 64),
  );
const escape = (s: string): string =>
  s
    .replace(/\^/g, '^ ')
    // eslint-disable-next-line no-control-regex -- caret notation, as acad-ts writes strings
    .replace(/[\x00-\x1f]/g, (c) => '^' + String.fromCharCode(c.charCodeAt(0) + 64));

class Cursor {
  i = 0;
  constructor(
    private readonly codes: readonly RawCode[],
    private readonly resolve: Resolve,
  ) {}

  get peek(): RawCode | undefined {
    return this.codes[this.i];
  }

  take(): RawCode {
    return this.codes[this.i++]!;
  }

  next(code: number): unknown {
    const c = this.codes[this.i];
    if (c?.code !== code) {
      throw new Error(
        `TABLECONTENT: ${code} expected at ${this.i}, found ${c?.code} ${String(c?.value)}`,
      );
    }
    this.i++;
    return c.value;
  }

  int(code: number): number {
    return Number(this.next(code));
  }
  num(code: number): number {
    return Number(this.next(code));
  }
  str(code: number): string {
    return unescape(String(this.next(code) ?? ''));
  }
  /** A marker string, case as AutoCAD writes it. */
  marker(code: number, name: string): void {
    const v = String(this.next(code));
    if (v.toUpperCase() !== name) throw new Error(`TABLECONTENT: ${name} expected, found ${v}`);
  }
  handle(code: number): CadObject | null {
    const h = Number(this.next(code));
    if (!h) return null;
    return this.resolve(h) ?? ({ handle: h } as unknown as CadObject);
  }
  is(code: number, name?: string): boolean {
    const c = this.peek;
    return c?.code === code && (name === undefined || String(c.value).toUpperCase() === name);
  }
  color(code: number): Color {
    const index = this.int(code);
    let color =
      index === 0
        ? Color.byBlock
        : index === 256
          ? Color.byLayer
          : index === 257
            ? Color.byEntity
            : new Color(index);
    if (this.is(420)) {
      const extra: RawCode[] = [];
      color = Color.fromTrueColor(Number(this.peek!.value) & 0xffffff);
      while (this.is(420) || this.is(430)) extra.push(this.take());
      trueColors.set(color, extra);
    }
    return color;
  }
}

class Out {
  readonly codes: RawCode[] = [];
  put(code: number, value: unknown): void {
    this.codes.push({ code, value });
  }
  str(code: number, value: string): void {
    this.put(code, escape(value));
  }
  handle(code: number, o: { handle: number } | null | undefined): void {
    this.put(code, o?.handle ?? 0);
  }
  color(code: number, color: Color): void {
    if (!color.isTrueColor) {
      this.put(code, color.index);
      return;
    }
    this.put(code, color.getApproxIndex());
    const kept = trueColors.get(color);
    if (kept) this.codes.push(...kept);
    else this.put(420, color.trueColor);
  }
}

// ── Values ─────────────────────────────────────────────────────────────────────────────────

function readValue(c: Cursor, value: CadValue): void {
  const flagged = c.is(93);
  if (flagged) value.flags = c.int(93);
  value.valueType = c.int(90) as CadValueType;
  const data: RawCode[] = [];
  if (flagged) {
    while (c.peek && !DATA_END.has(c.peek.code)) data.push(c.take());
  } else {
    // Before R2007 a value is its type and that type's data, ending on the type's last code
    // (acad-ts DxfValueFrame.ts); an unknown value's data is dropped, as R2007 frames it empty.
    const bytes = value.valueType === CadValueType.Date || value.valueType === CadValueType.Buffer;
    const last = PRE_R2007_LAST[value.valueType];
    let size = 0;
    let read = 0;
    while (c.peek && (bytes || last !== undefined)) {
      const code = c.take();
      data.push(code);
      if (code.code === 92) size = Number(code.value);
      if (code.code === 310) read += (code.value as Uint8Array).length;
      if (bytes ? code.code === 310 && read >= size : code.code === last) break;
    }
    if (value.valueType === CadValueType.Unknown) data.length = 0;
  }
  const decoded = decodeValue(value.valueType, data);
  if (decoded !== undefined) value.value = decoded;
  else valueData.set(value, { value: value.value, codes: data });
  if (flagged || c.is(94)) {
    value.units = c.int(94);
    value.format = c.str(300);
    value.formattedValue = c.str(302);
    c.marker(304, 'ACVALUE_END');
  } else if (!flagged) {
    // Framed as R2007 frames such a value (acad-ts 0070 `framePreR2007Values`).
    value.flags = value.valueType === CadValueType.Unknown ? 3 : 2;
  }
}

/** The last data code of a value written before R2007, by type; a date or buffer ends on its bytes. */
const PRE_R2007_LAST: Partial<Record<CadValueType, number>> = {
  [CadValueType.Unknown]: 91,
  [CadValueType.Long]: 91,
  [CadValueType.Double]: 140,
  [CadValueType.String]: 1,
  [CadValueType.Point2D]: 21,
  [CadValueType.Point3D]: 31,
  [CadValueType.Handle]: 330,
};

/** The value its data codes state, for the types Triya writes; undefined keeps the codes. */
function decodeValue(type: CadValueType, data: readonly RawCode[]): unknown {
  const only = (code: number): RawCode | undefined =>
    data.length === 1 && data[0]!.code === code ? data[0] : undefined;
  switch (type) {
    case CadValueType.Long: {
      const d = only(91);
      return d ? Number(d.value) : undefined;
    }
    case CadValueType.Double: {
      const d = only(140);
      return d ? Number(d.value) : undefined;
    }
    case CadValueType.String:
    case CadValueType.General: {
      const last = data.at(-1);
      if (!last || last.code !== 1 || data.slice(0, -1).some((d) => d.code !== 2)) return undefined;
      return data.map((d) => unescape(String(d.value))).join('');
    }
    default:
      return undefined;
  }
}

function writeValue(o: Out, value: CadValue): void {
  o.put(93, value.flags);
  o.put(90, value.valueType);
  const kept = valueData.get(value);
  if (kept && kept.value === value.value) {
    o.codes.push(...kept.codes);
  } else if (!value.isEmpty && value.value != null) {
    switch (value.valueType) {
      case CadValueType.Long:
        o.put(91, Number(value.value));
        break;
      case CadValueType.Double:
        o.put(140, Number(value.value));
        break;
      case CadValueType.String:
      case CadValueType.General: {
        let text = escape(String(value.value));
        while (text.length > 250) {
          o.put(2, text.slice(0, 250));
          text = text.slice(250);
        }
        o.put(1, text);
        break;
      }
      case CadValueType.Point2D:
      case CadValueType.Point3D: {
        const p = value.value as { x: number; y: number; z?: number };
        o.put(11, p.x);
        o.put(21, p.y);
        o.put(31, p.z ?? 0);
        break;
      }
      default:
        break;
    }
  }
  o.put(94, value.units);
  o.str(300, value.format ?? '');
  o.str(302, value.formattedValue ?? '');
  o.put(304, 'ACVALUE_END');
}

function readCustomData(c: Cursor, entries: CustomDataEntry[]): void {
  c.marker(301, 'CUSTOMDATA');
  c.marker(1, 'DATAMAP_BEGIN');
  const n = c.int(90);
  for (let k = 0; k < n; k++) {
    const entry = new CustomDataEntry();
    entry.name = c.str(300);
    c.marker(301, 'DATAMAP_VALUE');
    readValue(c, entry.value);
    entries.push(entry);
  }
  c.marker(309, 'DATAMAP_END');
}

function writeCustomData(o: Out, entries: readonly CustomDataEntry[]): void {
  o.put(301, 'CUSTOMDATA');
  o.put(1, 'DATAMAP_BEGIN');
  o.put(90, entries.length);
  for (const entry of entries) {
    o.str(300, entry.name);
    o.put(301, 'DATAMAP_VALUE');
    writeValue(o, entry.value);
  }
  o.put(309, 'DATAMAP_END');
}

// ── Formats ────────────────────────────────────────────────────────────────────────────────

/** CONTENTFORMAT: 90 override flags, 91 property flags, then the DWG order (rotation in degrees). */
function readContentFormat(c: Cursor, f: ContentFormat): void {
  c.marker(300, 'CONTENTFORMAT');
  c.marker(1, 'CONTENTFORMAT_BEGIN');
  f.propertyOverrideFlags = c.int(90);
  f.propertyFlags = c.int(91);
  f.valueDataType = c.int(92);
  f.valueUnitType = c.int(93);
  f.valueFormatString = c.str(300);
  f.rotation = MathHelper.degToRad(c.num(40));
  f.scale = c.num(140);
  f.alignment = c.int(94);
  f.color = c.color(62);
  f.textStyle = c.handle(340) as ContentFormat['textStyle'];
  f.textHeight = c.num(144);
  c.marker(309, 'CONTENTFORMAT_END');
}

function writeContentFormat(o: Out, f: ContentFormat): void {
  o.put(300, 'CONTENTFORMAT');
  o.put(1, 'CONTENTFORMAT_BEGIN');
  o.put(90, f.propertyOverrideFlags);
  o.put(91, f.propertyFlags);
  o.put(92, f.valueDataType);
  o.put(93, f.valueUnitType);
  o.str(300, f.valueFormatString);
  o.put(40, MathHelper.radToDegRoundTrip(f.rotation));
  o.put(140, f.scale);
  o.put(94, f.alignment);
  o.color(62, f.color);
  o.handle(340, f.textStyle);
  o.put(144, f.textHeight);
  o.put(309, 'CONTENTFORMAT_END');
}

const BORDER: Record<number, (s: CellStyle) => CellBorder> = {
  [CellEdgeFlags.Top]: (s) => s.topBorder,
  [CellEdgeFlags.InsideHorizontal]: (s) => s.horizontalInsideBorder,
  [CellEdgeFlags.Bottom]: (s) => s.bottomBorder,
  [CellEdgeFlags.Left]: (s) => s.leftBorder,
  [CellEdgeFlags.InsideVertical]: (s) => s.verticalInsideBorder,
  [CellEdgeFlags.Right]: (s) => s.rightBorder,
};
const EDGE_ORDER = [1, 2, 4, 8, 16, 32] as CellEdgeFlags[];

/** TABLEFORMAT: a cell style as the DWG states it (`_readCellStyle`). */
function readTableFormat(c: Cursor, s: CellStyle): void {
  c.marker(1, 'TABLEFORMAT_BEGIN');
  s.cellStyleType = c.int(90);
  s.hasData = c.int(170) !== 0;
  if (s.hasData) {
    s.cellPropertyOverrideFlags = c.int(91);
    s.tableCellStylePropertyFlags = c.int(92);
    s.backgroundColor = c.color(62);
    s.contentLayoutFlags = c.int(93);
    readContentFormat(c, s);
    s.marginOverrideFlags = c.int(171);
    if (c.is(301, 'MARGIN')) {
      c.next(301);
      c.marker(1, 'CELLMARGIN_BEGIN');
      s.verticalMargin = c.num(40);
      s.horizontalMargin = c.num(40);
      s.bottomMargin = c.num(40);
      s.rightMargin = c.num(40);
      s.marginHorizontalSpacing = c.num(40);
      s.marginVerticalSpacing = c.num(40);
      c.marker(309, 'CELLMARGIN_END');
    }
    const n = c.int(94);
    const listed: CellEdgeFlags[] = [];
    for (let k = 0; k < n; k++) {
      const edge = c.int(95) as CellEdgeFlags;
      const border = BORDER[edge]?.(s);
      if (!border) throw new Error(`TABLECONTENT: border edge ${edge}`);
      listed.push(edge);
      c.marker(302, 'GRIDFORMAT');
      c.marker(1, 'GRIDFORMAT_BEGIN');
      border.propertyOverrideFlags = c.int(90);
      border.type = c.int(91);
      border.color = c.color(62);
      border.lineWeight = c.int(92);
      border.lineType = c.handle(340) as CellBorder['lineType'];
      border.isInvisible = c.int(93) !== 0;
      border.doubleLineSpacing = c.num(40);
      c.marker(309, 'GRIDFORMAT_END');
    }
    listedBorders.set(s, listed);
  }
  c.marker(309, 'TABLEFORMAT_END');
}

function writeTableFormat(o: Out, s: CellStyle): void {
  o.put(1, 'TABLEFORMAT_BEGIN');
  o.put(90, s.cellStyleType);
  o.put(170, s.hasData ? 1 : 0);
  if (s.hasData) {
    o.put(91, s.cellPropertyOverrideFlags ?? 0);
    o.put(92, s.tableCellStylePropertyFlags);
    o.color(62, s.backgroundColor);
    o.put(93, s.contentLayoutFlags);
    writeContentFormat(o, s);
    o.put(171, s.marginOverrideFlags);
    if (s.marginOverrideFlags & 1) {
      o.put(301, 'MARGIN');
      o.put(1, 'CELLMARGIN_BEGIN');
      for (const m of [
        s.verticalMargin,
        s.horizontalMargin,
        s.bottomMargin,
        s.rightMargin,
        s.marginHorizontalSpacing,
        s.marginVerticalSpacing,
      ])
        o.put(40, m);
      o.put(309, 'CELLMARGIN_END');
    }
    // The borders listed as read, then those that override something since (an edited cell's,
    // M4-30), in edge order, as AutoCAD lists them.
    const listed = listedBorders.get(s) ?? [];
    const edges = [
      ...listed,
      ...EDGE_ORDER.filter((e) => !listed.includes(e) && BORDER[e]!(s).propertyOverrideFlags !== 0),
    ];
    o.put(94, edges.length);
    for (const edge of edges) {
      const b = BORDER[edge]!(s);
      o.put(95, edge);
      o.put(302, 'GRIDFORMAT');
      o.put(1, 'GRIDFORMAT_BEGIN');
      o.put(90, b.propertyOverrideFlags);
      o.put(91, b.type);
      o.color(62, b.color);
      o.put(92, b.lineWeight);
      o.handle(340, b.lineType);
      o.put(93, b.isInvisible ? 1 : 0);
      o.put(40, b.doubleLineSpacing);
      o.put(309, 'GRIDFORMAT_END');
    }
  }
  o.put(309, 'TABLEFORMAT_END');
}

// ── Cells ──────────────────────────────────────────────────────────────────────────────────

function readContent(c: Cursor): CellContent {
  const content = new CellContent();
  c.marker(302, 'CONTENT');
  c.marker(1, 'CELLCONTENT_BEGIN');
  content.contentType = c.int(90);
  if (content.contentType === TableCellContentType.Value) {
    c.marker(300, 'VALUE');
    readValue(c, content.cadValue);
  } else if (content.contentType === TableCellContentType.Field) {
    content.field = c.handle(340) as CellContent['field'];
  } else if (content.contentType === TableCellContentType.Block) {
    content.blockRecord = c.handle(340) as CellContent['blockRecord'];
  }
  const attributes = c.int(91);
  for (let k = 0; k < attributes; k++) {
    const a = new TableAttribute();
    a.attributeDefinition = c.handle(340) as TableAttribute['attributeDefinition'];
    a.value = c.str(301);
    a.index = c.int(92);
    content.attributes.push(a);
  }
  c.marker(309, 'CELLCONTENT_END');
  c.marker(1, 'FORMATTEDCELLCONTENT_BEGIN');
  content.format.hasData = c.int(170) !== 0;
  if (content.format.hasData) readContentFormat(c, content.format);
  c.marker(309, 'FORMATTEDCELLCONTENT_END');
  return content;
}

function writeContent(o: Out, content: CellContent): void {
  o.put(302, 'CONTENT');
  o.put(1, 'CELLCONTENT_BEGIN');
  o.put(90, content.contentType);
  if (content.contentType === TableCellContentType.Value) {
    o.put(300, 'VALUE');
    writeValue(o, content.cadValue);
  } else if (content.contentType === TableCellContentType.Field) {
    o.handle(340, content.field);
  } else if (content.contentType === TableCellContentType.Block) {
    o.handle(340, content.blockRecord);
  }
  o.put(91, content.attributes.length);
  for (const a of content.attributes) {
    o.handle(340, a.attributeDefinition);
    o.str(301, a.value);
    o.put(92, a.index);
  }
  o.put(309, 'CELLCONTENT_END');
  o.put(1, 'FORMATTEDCELLCONTENT_BEGIN');
  o.put(170, content.format.hasData ? 1 : 0);
  if (content.format.hasData) writeContentFormat(o, content.format);
  o.put(309, 'FORMATTEDCELLCONTENT_END');
}

function readCell(c: Cursor): TableEntityCell {
  const cell = new TableEntityCell();
  c.marker(300, 'CELL');
  c.marker(1, 'LINKEDTABLEDATACELL_BEGIN');
  cell.stateFlags = c.int(90);
  cell.toolTip = c.str(300);
  cell.customData = c.int(91);
  readCustomData(c, cell.customDataCollection);
  cell.hasLinkedData = c.int(92) !== 0;
  if (cell.hasLinkedData) {
    cell.dataLink = c.handle(340);
    cell.linkedRowCount = c.int(93);
    cell.linkedColumnCount = c.int(94);
    cell.linkedDataFlags = c.int(96);
  }
  const contents = c.int(95);
  for (let k = 0; k < contents; k++) cell.contents.push(readContent(c));
  c.marker(309, 'LINKEDTABLEDATACELL_END');
  c.marker(1, 'FORMATTEDTABLEDATACELL_BEGIN');
  c.marker(300, 'CELLTABLEFORMAT');
  readTableFormat(c, cell.styleOverride);
  c.marker(309, 'FORMATTEDTABLEDATACELL_END');
  c.marker(1, 'TABLECELL_BEGIN');
  cell.styleId = c.int(90);
  const geometry = c.int(91);
  if (geometry !== 0) {
    cell.geometryFlags = c.int(91);
    cell.geometryWidth = c.num(40);
    cell.geometryHeight = c.num(41);
    cell.geometryReference = c.handle(330);
    const n = c.int(92);
    for (let k = 0; k < n; k++) {
      const g = new CellContentGeometry();
      g.distanceTopLeft = new XYZ(c.num(10), c.num(20), c.num(30));
      g.distanceCenter = new XYZ(c.num(11), c.num(21), c.num(31));
      g.contentWidth = c.num(43);
      g.contentHeight = c.num(44);
      g.width = c.num(45);
      g.height = c.num(46);
      g.flags = c.int(95);
      cell.geometryCollection.push(g);
    }
    cell.geometry = cell.geometryCollection[0] ?? null;
  }
  c.marker(309, 'TABLECELL_END');
  return cell;
}

function writeCell(o: Out, cell: TableEntityCell): void {
  o.put(300, 'CELL');
  o.put(1, 'LINKEDTABLEDATACELL_BEGIN');
  o.put(90, cell.stateFlags);
  o.str(300, cell.toolTip);
  o.put(91, cell.customData);
  writeCustomData(o, cell.customDataCollection);
  o.put(92, cell.hasLinkedData ? 1 : 0);
  if (cell.hasLinkedData) {
    o.handle(340, cell.dataLink);
    o.put(93, cell.linkedRowCount);
    o.put(94, cell.linkedColumnCount);
    o.put(96, cell.linkedDataFlags);
  }
  o.put(95, cell.contents.length);
  for (const content of cell.contents) writeContent(o, content);
  o.put(309, 'LINKEDTABLEDATACELL_END');
  o.put(1, 'FORMATTEDTABLEDATACELL_BEGIN');
  o.put(300, 'CELLTABLEFORMAT');
  writeTableFormat(o, cell.styleOverride);
  o.put(309, 'FORMATTEDTABLEDATACELL_END');
  o.put(1, 'TABLECELL_BEGIN');
  o.put(90, cell.styleId);
  const geometry = cell.geometryReference != null || cell.geometryCollection.length > 0;
  o.put(91, geometry ? 1 : 0);
  if (geometry) {
    o.put(91, cell.geometryFlags);
    o.put(40, cell.geometryWidth);
    o.put(41, cell.geometryHeight);
    o.handle(330, cell.geometryReference);
    o.put(92, cell.geometryCollection.length);
    for (const g of cell.geometryCollection) {
      for (const [code, p] of [
        [10, g.distanceTopLeft],
        [11, g.distanceCenter],
      ] as const) {
        o.put(code, p.x);
        o.put(code + 10, p.y);
        o.put(code + 20, p.z);
      }
      o.put(43, g.contentWidth);
      o.put(44, g.contentHeight);
      o.put(45, g.width);
      o.put(46, g.height);
      o.put(95, g.flags);
    }
  }
  o.put(309, 'TABLECELL_END');
}

// ── Columns, rows, the table ───────────────────────────────────────────────────────────────

function readColumn(c: Cursor): TableEntityColumn {
  const column = new TableEntityColumn();
  c.marker(300, 'COLUMN');
  c.marker(1, 'LINKEDTABLEDATACOLUMN_BEGIN');
  column.name = c.str(300);
  column.customData = c.int(91);
  readCustomData(c, column.customDataCollection);
  c.marker(309, 'LINKEDTABLEDATACOLUMN_END');
  c.marker(1, 'FORMATTEDTABLEDATACOLUMN_BEGIN');
  c.marker(300, 'COLUMNTABLEFORMAT');
  readTableFormat(c, column.cellStyleOverride);
  c.marker(309, 'FORMATTEDTABLEDATACOLUMN_END');
  c.marker(1, 'TABLECOLUMN_BEGIN');
  column.styleId = c.int(90);
  column.width = c.num(40);
  c.marker(309, 'TABLECOLUMN_END');
  return column;
}

function writeColumn(o: Out, column: TableEntityColumn): void {
  o.put(300, 'COLUMN');
  o.put(1, 'LINKEDTABLEDATACOLUMN_BEGIN');
  o.str(300, column.name);
  o.put(91, column.customData);
  writeCustomData(o, column.customDataCollection);
  o.put(309, 'LINKEDTABLEDATACOLUMN_END');
  o.put(1, 'FORMATTEDTABLEDATACOLUMN_BEGIN');
  o.put(300, 'COLUMNTABLEFORMAT');
  writeTableFormat(o, column.cellStyleOverride);
  o.put(309, 'FORMATTEDTABLEDATACOLUMN_END');
  o.put(1, 'TABLECOLUMN_BEGIN');
  o.put(90, column.styleId);
  o.put(40, column.width);
  o.put(309, 'TABLECOLUMN_END');
}

function readRow(c: Cursor): TableEntityRow {
  const row = new TableEntityRow();
  c.marker(301, 'ROW');
  c.marker(1, 'LINKEDTABLEDATAROW_BEGIN');
  const cells = c.int(90);
  for (let k = 0; k < cells; k++) row.cells.push(readCell(c));
  row.customData = c.int(91);
  readCustomData(c, row.customDataCollection);
  c.marker(309, 'LINKEDTABLEDATAROW_END');
  c.marker(1, 'FORMATTEDTABLEDATAROW_BEGIN');
  c.marker(300, 'ROWTABLEFORMAT');
  readTableFormat(c, row.cellStyleOverride);
  c.marker(309, 'FORMATTEDTABLEDATAROW_END');
  c.marker(1, 'TABLEROW_BEGIN');
  row.styleId = c.int(90);
  row.height = c.num(40);
  c.marker(309, 'TABLEROW_END');
  return row;
}

function writeRow(o: Out, row: TableEntityRow): void {
  o.put(301, 'ROW');
  o.put(1, 'LINKEDTABLEDATAROW_BEGIN');
  o.put(90, row.cells.length);
  for (const cell of row.cells) writeCell(o, cell);
  o.put(91, row.customData);
  writeCustomData(o, row.customDataCollection);
  o.put(309, 'LINKEDTABLEDATAROW_END');
  o.put(1, 'FORMATTEDTABLEDATAROW_BEGIN');
  o.put(300, 'ROWTABLEFORMAT');
  writeTableFormat(o, row.cellStyleOverride);
  o.put(309, 'FORMATTEDTABLEDATAROW_END');
  o.put(1, 'TABLEROW_BEGIN');
  o.put(90, row.styleId);
  o.put(40, row.height);
  o.put(309, 'TABLEROW_END');
}

/** A table content read from TABLECONTENT codes, and the codes before its first subclass. */
export interface ReadTableContent {
  readonly content: TableContent;
  /** The handle, owner and reactor codes, as read. */
  readonly head: readonly RawCode[];
}

/**
 * Reads a TABLECONTENT object's raw codes (acad-ts `rawDxfCodes`, its handle and owner first)
 * into a table content. Throws on codes it does not know, so that a caller keeps them raw.
 */
export function readTableContent(
  codes: readonly RawCode[],
  resolve: Resolve = () => null,
): ReadTableContent {
  const start = codes.findIndex((c) => c.code === 100);
  const head = codes.slice(0, start);
  const c = new Cursor(codes.slice(start), resolve);
  const content = new TableContent();
  c.marker(100, 'ACDBLINKEDDATA');
  content.name = c.str(1);
  content.description = c.str(300);
  c.marker(100, 'ACDBLINKEDTABLEDATA');
  const columns = c.int(90);
  for (let k = 0; k < columns; k++) content.columns.push(readColumn(c));
  const rows = c.int(91);
  for (let k = 0; k < rows; k++) content.rows.push(readRow(c));
  const fields = c.int(92);
  for (let k = 0; k < fields; k++) {
    const field = c.handle(360);
    if (field) content.fieldReferences.push(field);
  }
  c.marker(100, 'ACDBFORMATTEDTABLEDATA');
  c.marker(300, 'TABLEFORMAT');
  readTableFormat(c, content.cellStyleOverride);
  const merged = c.int(90);
  for (let k = 0; k < merged; k++) {
    const range = new CellRange();
    range.topRowIndex = c.int(91);
    range.leftColumnIndex = c.int(92);
    range.bottomRowIndex = c.int(93);
    range.rightColumnIndex = c.int(94);
    content.mergedCellRanges.push(range);
  }
  c.marker(100, 'ACDBTABLECONTENT');
  content.style = c.handle(340) as TableContent['style'];
  if (c.peek) throw new Error(`TABLECONTENT: ${c.peek.code} after the table style`);
  return { content, head };
}

/** The codes of a TABLECONTENT object holding `content`, after `head` (handle, owner). */
export function tableContentCodes(content: TableContent, head: readonly RawCode[]): RawCode[] {
  const o = new Out();
  o.codes.push(...head);
  o.put(100, 'AcDbLinkedData');
  o.str(1, content.name);
  o.str(300, content.description);
  o.put(100, 'AcDbLinkedTableData');
  o.put(90, content.columns.length);
  for (const column of content.columns) writeColumn(o, column);
  o.put(91, content.rows.length);
  for (const row of content.rows) writeRow(o, row);
  o.put(92, content.fieldReferences.length);
  for (const field of content.fieldReferences) o.handle(360, field);
  o.put(100, 'AcDbFormattedTableData');
  o.put(300, 'TABLEFORMAT');
  writeTableFormat(o, content.cellStyleOverride);
  o.put(90, content.mergedCellRanges.length);
  for (const r of content.mergedCellRanges) {
    o.put(91, r.topRowIndex);
    o.put(92, r.leftColumnIndex);
    o.put(93, r.bottomRowIndex);
    o.put(94, r.rightColumnIndex);
  }
  o.put(100, 'AcDbTableContent');
  o.handle(340, content.style);
  return o.codes;
}

/** The key of a table's round-trip XRECORD in its extension dictionary. */
export const ROUNDTRIP_DICTIONARY_KEY = 'ACAD_XREC_ROUNDTRIP';
/** The XRECORD's first string: the table's AutoCAD 2008 data follows (360 the TABLECONTENT). */
export const ROUNDTRIP_TABLE = 'ACAD_ROUNDTRIP_2008_TABLE_ENTITY';

/** A table's round-trip XRECORD and the TABLECONTENT it names, read. */
export interface RoundTripTableContent {
  readonly record: XRecord;
  readonly object: CadObject & { rawDxfCodes: RawCode[] | null };
  /** The content, or null when its codes do not read (an unknown layout). */
  readonly content: TableContent | null;
  /** The object's handle, owner and reactor codes, as read. */
  readonly head: readonly RawCode[];
}

/**
 * The AutoCAD 2008 data of a DXF table (M4-30): the TABLECONTENT its `ACAD_XREC_ROUNDTRIP`
 * XRECORD names after `ACAD_ROUNDTRIP_2008_TABLE_ENTITY`, read into acad-ts's table content (the
 * classes an R2010+ DWG's table fills). Undefined when the table has no such record or the
 * record names no TABLECONTENT kept raw (a DWG, or a table a save has not given one yet).
 */
export function roundTripTableContent(
  t: TableEntity,
  resolve: Resolve = () => null,
): RoundTripTableContent | undefined {
  const record = t.xDictionary?.getEntry(ROUNDTRIP_DICTIONARY_KEY);
  if (!(record instanceof XRecord)) return undefined;
  const [first, second] = record.entries;
  if (first?.code !== 102 || first.value !== ROUNDTRIP_TABLE || second?.code !== 360) {
    return undefined;
  }
  const object = second.value as RoundTripTableContent['object'] | null;
  const codes = object?.rawDxfCodes;
  if (!object || object.objectName !== 'TABLECONTENT' || !codes) return undefined;
  // A cell's FIELD (M4-23) is owned by the table and in no dictionary, so the drawing may not list
  // it: the table's cells name it (DXF 344), and the content's 340 and 360 resolve to the same one.
  const fields = new Map<number, CadObject>();
  for (const row of t.rows)
    for (const cell of row.cells)
      for (const k of cell.contents) if (k.field) fields.set(k.field.handle, k.field);
  const own: Resolve = (h) => resolve(h) ?? fields.get(h) ?? null;
  try {
    const { content, head } = readTableContent(codes, own);
    return { record, object, content, head };
  } catch {
    return { record, object, content: null, head: codes.slice(0, 0) };
  }
}

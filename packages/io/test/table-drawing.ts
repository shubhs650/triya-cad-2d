// The table drawing the ACAD_TABLE save tests start from (export-tables.test.ts and
// export-tables-new.test.ts), authored in memory with acad-ts and saved once, so "the file" is
// real bytes.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  CadValueType,
  CellContent,
  CellOverrideFlags,
  CellStyleType,
  CellType,
  Color,
  Line,
  TableBorderPropertyFlags,
  TableCellContentType,
  TableCellStateFlags,
  TableCellStylePropertyFlags,
  TableEntity,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  TableStyle,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument, type CadFormat } from '../src/index';

export interface Options {
  /** A field in cell (1, 1) instead of its text. */
  readonly field?: boolean;
  /** Cell (1, 1) has its content locked (TableCellStateFlags.ContentLocked). */
  readonly locked?: boolean;
  /**
   * Cell (1, 0) overrides its alignment (middle centre), content colour (ACI 3) and top border
   * lineweight (0.50 mm) in the cell's override flag word (DXF 177 / 91, DWG before R2010).
   */
  readonly formatted?: boolean;
  /**
   * The same overrides as a DWG from R2010 states them, in cell styles: cell (1, 0)'s own cell
   * style overrides its alignment (middle centre), content colour (ACI 3) and top border
   * lineweight (0.50 mm), its content format the text height (0.3); the data row's cell style
   * overrides the alignment (middle left) of every cell in it.
   */
  readonly cellStyles?: boolean;
  /**
   * Each row names the cell style of its row type (title, header, data) by the table style's
   * ids, as every row of an AutoCAD-saved DWG from R2010 does: a DWG from R2010 states the
   * table-wide overrides of a row type in the cell styles of its rows.
   */
  readonly rowStyles?: boolean;
  /**
   * DXF 94 (the border colour override flags) set, as a table overriding a border colour states
   * it; the values after it are not mapped (M1-81).
   */
  readonly borderOverrides?: boolean;
}

/**
 * Table styles Standard and GRID; blocks MARK and FLAG; one table in model space with its `*T`
 * block (a frame line), 3 rows × 2 columns: a title, a header row and a data row whose second
 * cell shows block MARK.
 */
export function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  options: Options = {},
): Uint8Array {
  const doc = new CadDocument(version);
  const dict = doc.rootDictionary!.get(CadDictionary.acadTableStyle) as CadDictionary;
  const styles = [TableStyle.defaultName, 'GRID'].map((name) => {
    const s = new TableStyle(name);
    s.cellStyles = [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle];
    dict.add(s);
    return s;
  });
  const blocks = ['MARK', 'FLAG', '*T1'].map((name) => {
    const b = new BlockRecord(name);
    const l = new Line();
    l.endPoint = new XYZ(1, 1, 0);
    b.entities.add(l);
    doc.blockRecords!.add(b);
    return b;
  });
  const t = new TableEntity();
  doc.entities!.add(t);
  t.style = styles[0]!;
  t.block = blocks[2]!;
  t.insertPoint = new XYZ(10, 20, 0);
  t.horizontalDirection = new XYZ(1, 0, 0);
  for (const w of [3, 4]) {
    const c = new TableEntityColumn();
    c.width = w;
    t.columns.push(c);
  }
  const texts = [
    ['Schedule', ''],
    ['Tag', 'Mark'],
    ['N1', null],
  ];
  texts.forEach((row, i) => {
    const r = new TableEntityRow();
    r.height = 0.5 + i * 0.25;
    row.forEach((text, j) => {
      const cell = new TableEntityCell();
      const content = new CellContent();
      if (text === null) {
        cell.type = CellType.Block;
        cell.value = blocks[0]!;
        content.contentType = TableCellContentType.Block;
        content.blockRecord = blocks[0]!;
        cell.blockScale = 1;
      } else {
        content.contentType = TableCellContentType.Value;
        content.cadValue.setValue(text, CadValueType.String);
      }
      cell.contents.push(content);
      // The title spans both columns (DXF 175 / 176), the cell after it is covered by it.
      if (i === 0) {
        cell.borderWidth = j === 0 ? 2 : 0;
        cell.borderHeight = j === 0 ? 1 : 0;
        cell.mergedValue = j === 0 ? 0 : 1;
      } else {
        cell.borderWidth = 1;
        cell.borderHeight = 1;
      }
      r.cells.push(cell);
    });
    t.rows.push(r);
  });
  if (options.formatted) {
    const c = t.rows[1]!.cells[0]!;
    c.overrideFlags = CellOverrideFlags.CellAlignment | CellOverrideFlags.ContentColor;
    c.overrideFlags |= CellOverrideFlags.TopGridLineWeight;
    c.styleOverride.cellAlignment = 5;
    c.styleOverride.contentColor = new Color(3);
    c.styleOverride.topBorder.lineWeight = 50 as never;
  }
  if (options.cellStyles) {
    const s = t.rows[1]!.cells[0]!.styleOverride;
    s.hasData = true;
    s.cellPropertyOverrideFlags =
      TableCellStylePropertyFlags.Alignment | TableCellStylePropertyFlags.ContentColor;
    s.alignment = 5;
    s.color = new Color(3);
    s.topBorder.propertyOverrideFlags = TableBorderPropertyFlags.LineWeight;
    s.topBorder.lineWeight = 50 as never;
    const f = t.rows[1]!.cells[0]!.contents[0]!.format;
    f.hasData = true;
    f.propertyOverrideFlags = TableCellStylePropertyFlags.TextHeight;
    f.textHeight = 0.3;
    const row = t.rows[2]!.cellStyleOverride;
    row.cellStyleType = CellStyleType.Row;
    row.hasData = true;
    row.cellPropertyOverrideFlags = TableCellStylePropertyFlags.Alignment;
    row.alignment = 4;
  }
  if (options.rowStyles) t.rows.forEach((r, i) => (r.styleId = i + 1));
  if (options.borderOverrides) {
    t.tableOverrideDxfCodes = [93, 94, 95, 96].map((code) => ({
      code,
      value: code === 94 ? 1 : 0,
    }));
  }
  const special = t.rows[1]!.cells[1]!;
  if (options.locked) special.stateFlags = TableCellStateFlags.ContentLocked;
  if (options.field) special.contents[0]!.contentType = TableCellContentType.Field;
  return writeCadDocument(doc, { format });
}

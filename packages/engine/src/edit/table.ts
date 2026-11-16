// Tables in the drawing (M4-05): the table style a new table takes, a new table's grid as the
// TABLE command builds it, and a table's `*T` block written with what the table engine draws
// for it (annotation/table.ts).
//
// The block is rewritten as AutoCAD regenerates it: the old contents go and the new get new
// handles above $HANDSEED, the block record keeping its handle; a table without a block gets a
// new anonymous `*T<n>` one. The contents lie on the table's layer, as AutoCAD's do, and the
// zero-length line every AutoCAD table block ends with on layer Defpoints, which is made (not
// plotted) when the drawing has none, as for a dimension's definition points.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  Color,
  TableCell,
  TableCellBorder,
  TableCellStyle,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import { tableParts, tableRowHeight, tableRowTypes, rowCellStyle } from '../annotation/table';
import { defpointsLayer, layerNamed } from './dimension-block';
import { AnonymousNames } from './edit';
import { blockExtentsOf } from './mleader';

/**
 * The style new tables take: the one CTABLESTYLE names, else Standard, else the first;
 * undefined in a drawing with none.
 */
export function currentTableStyle(model: DocumentModel): TableStyleRecord | undefined {
  const name = model.header.get('CTABLESTYLE') ?? model.header.get('$CTABLESTYLE');
  const styles = [...model.tables.tableStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return (typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0];
}

const BY_BLOCK: Color = { kind: 'byBlock' };

const border = (): TableCellBorder => ({ lineweight: 'ByBlock', visible: true, color: BY_BLOCK });

const cellStyle = (textHeight: number, alignment: number, textStyle?: Handle): TableCellStyle => ({
  ...(textStyle !== undefined && { textStyle }),
  textHeight,
  alignment,
  textColor: BY_BLOCK,
  fillColor: { kind: 'aci', index: 7 },
  fillOn: false,
  dataType: 512,
  unitType: 0,
  borders: Array.from({ length: 6 }, border),
});

/**
 * AutoCAD's Standard table style, for a drawing that has none: acadsharp's sample drawings hold
 * the imperial one (acad.dwt: 0.06 margins, data 0.18 top centre, title 0.25 and header 0.18
 * middle centre, ByBlock borders and text, no fill); acadiso.dwt's is the same at 25 times the
 * size, rounded as AutoCAD rounds it (1.5 margins, data and header 4.5, title 6).
 */
export function standardTableStyle(
  metric: boolean,
  textStyle: Handle | undefined,
): Omit<TableStyleRecord, 'handle'> {
  const [margin, text, title] = metric ? [1.5, 4.5, 6] : [0.06, 0.18, 0.25];
  return {
    name: 'Standard',
    description: '',
    flowDirection: 0,
    styleFlags: 0,
    horizontalMargin: margin,
    verticalMargin: margin,
    suppressTitle: false,
    suppressHeader: false,
    // The file's order: data, title, header.
    cellStyles: [
      cellStyle(text, 2, textStyle),
      cellStyle(title, 5, textStyle),
      cellStyle(text, 5, textStyle),
    ],
  };
}

const empty = (more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text: '',
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/** What the TABLE command builds: its style, size and where it goes. */
export interface NewTable {
  readonly style: TableStyleRecord;
  readonly columns: number;
  /** Data rows, below the title and header rows the style does not suppress. */
  readonly dataRows: number;
  readonly columnWidth: number;
  /** Each row's height in lines of its row type's text (`tableRowHeight`). */
  readonly rowLines: number;
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * A new table's geometry, without its block: a title row merged across every column (as
 * AutoCAD's Standard title cell style merges it), a header row and `dataRows` data rows, each
 * `rowLines` lines of its own row type's text high, every cell empty.
 */
export function newTableGeometry(t: NewTable): TableGeometry {
  const first = tableRowTypes(t.style, 2).filter((r) => r !== 'data').length;
  const rows = first + t.dataRows;
  const types = tableRowTypes(t.style, rows);
  const rowHeights = types.map((type) =>
    tableRowHeight(
      t.rowLines,
      rowCellStyle(t.style, type)?.textHeight ?? 0.18,
      t.style.verticalMargin,
    ),
  );
  const cells = types.map((type) =>
    Array.from({ length: t.columns }, (_, j) =>
      type !== 'title'
        ? empty()
        : j === 0
          ? empty({ columnSpan: t.columns })
          : empty({ merged: true }),
    ),
  );
  return {
    kind: 'ACAD_TABLE',
    style: t.style.handle,
    position: t.position,
    direction: { x: 1, y: 0 },
    rowHeights,
    columnWidths: Array.from({ length: t.columns }, () => t.columnWidth),
    cells,
  };
}

/** The text style a cell whose cell style names none takes: Standard, else the first. */
function standardTextStyle(model: DocumentModel): Handle {
  const styles = [...model.tables.textStyles.values()];
  return (styles.find((s) => s.name.toUpperCase() === 'STANDARD') ?? styles[0])?.handle ?? '';
}

/**
 * Rewrites table `id`'s `*T` block with what the table engine draws for it now, as the change
 * being built sees the table and its style. Returns false when the table is gone or the drawing
 * has no layer 0.
 */
export function writeTableBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  id: EntityId,
  names: AnonymousNames = new AnonymousNames(model),
): boolean {
  const e = b.entity(id);
  if (!e || e.geom.kind !== 'ACAD_TABLE') return false;
  const g = e.geom;
  const zero = layerNamed(b, model, '0');
  if (zero === undefined) return false;
  const style = g.style !== undefined ? b.tableRecord('tableStyles', g.style) : undefined;
  const parts = tableParts(g, style, {
    textStyle: standardTextStyle(model),
    blockExtents: (h) => blockExtentsOf(model, h),
  });
  let block = g.block !== undefined && b.block(g.block) ? g.block : undefined;
  if (block === undefined) {
    block = b.addBlock({ name: names.take('T'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  } else {
    for (const old of b.blockEntities(block)) b.removeEntity(old);
  }
  const defpoints = defpointsLayer(b, model, zero);
  for (const p of parts) {
    b.addEntity({
      owner: block,
      layer: p.defpoint ? defpoints : e.layer,
      geom: p.geom,
      color: p.color ?? BY_BLOCK,
      ...(p.linetype !== undefined && { linetype: p.linetype }),
      ...(p.lineweight !== undefined && { lineweight: p.lineweight }),
    });
  }
  if (block !== g.block) b.updateEntity(id, { geom: { ...g, block } });
  return true;
}

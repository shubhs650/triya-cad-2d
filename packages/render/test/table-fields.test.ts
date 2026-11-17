// FIELDDISPLAY in table cells (M4-32). A table draws from its `*T` block, whose MTEXTs carry no
// fields (the block is saved as it is drawn: AutoCAD keeps a cell's fields in the cell, M4-23
// part 2), so the renderer shades a cell's fields from the cell itself: a grey, half-opaque box
// behind each field's characters, as an MTEXT's (M4-10 part 3), over the cells' fills and under
// the cells' text. The block draws as before, and the shading never plots.
import {
  ChangeSetBuilder,
  writeTableBlock,
  type DrawingField,
  type EntityInit,
  type TableCell,
  type TableGeometry,
  type TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  defaultPaint,
  expandInsert,
  newPlotStyle,
  PlotResolver,
  plotParts,
  type BlockSource,
  type RenderPrimitive,
} from '../src/index';
import { drawing, entity, MODEL } from './fixtures';
import { fontBook } from './text-fonts';

const STYLE = '30';
const TABLE = '20';

const standard: TextStyleRecord = {
  handle: STYLE,
  name: 'Standard',
  font: 'romans',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

/** `A` then a Filename field showing `A`. */
const field: DrawingField = {
  evaluator: '_text',
  code: 'A%<\\_FldIdx 0>%',
  children: [
    { evaluator: 'AcVar', code: '\\AcVar Filename', children: [], objects: [], value: 'A' },
  ],
  objects: [],
};

const cell = (text: string, extra: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...extra,
});

/** Two rows by two columns, 4 wide and 1 tall each, at (10, 5); cell (1, 1) filled yellow. */
const table = (fieldCell: TableCell = cell('AA', { field })): TableGeometry => ({
  kind: 'ACAD_TABLE',
  position: { x: 10, y: 5 },
  direction: { x: 1, y: 0 },
  rowHeights: [1, 1],
  columnWidths: [4, 4],
  cells: [
    [cell('A'), cell('A')],
    [cell('A'), { ...fieldCell, format: { background: { kind: 'aci', index: 2 } } }],
  ],
});

/** The drawing with the table and its `*T` block drawn by the table engine, as a save keeps it. */
function setup(geom: TableGeometry) {
  const d = drawing([entity(TABLE, geom) as EntityInit], { textStyles: [standard] });
  const id = [...d.model.blockEntities(MODEL)].find((i) => d.model.entity(i)!.handle === TABLE)!;
  const b = new ChangeSetBuilder(d.model);
  expect(writeTableBlock(b, d.model, id)).toBe(true);
  d.model.apply(b.build());
  const text = { fonts: fontBook(), style: (h: string) => d.model.tables.textStyles.get(h) };
  const src: BlockSource = {
    model: d.model,
    paint: defaultPaint,
    insertContext: defaultPaint.insertContext,
    order: (blk) => d.model.blockEntities(blk),
    tessellate: { text },
  };
  const t = d.model.entity(id)!;
  return { model: d.model, t, text, prims: expandInsert(t, src, { dashes: false }).prims };
}

const isShade = (p: RenderPrimitive) => p.kind === 'fill' && p.fieldShade === true;

/** The move and line targets of a path, as [x, y] pairs. */
function points(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op === PATH_M || op === PATH_L) {
      out.push([path[i + 1]!, path[i + 2]!]);
      i += 3;
    } else if (op === PATH_A) i += 7;
    else if (op === PATH_Z) i += 1;
    else throw new Error(`unexpected path command ${op}`);
  }
  return out;
}
const pathOf = (p: RenderPrimitive) => ('path' in p ? (p.path as readonly number[]) : []);
const xs = (p: RenderPrimitive) => points(pathOf(p)).map(([x]) => x);
const ys = (p: RenderPrimitive) => points(pathOf(p)).map(([, y]) => y);

describe('field shading in table cells (FIELDDISPLAY, M4-32)', () => {
  it("shades a cell's field behind its value, inside the cell, from the cell's own field", () => {
    const { prims } = setup(table());
    const shades = prims.filter(isShade);
    expect(shades).toHaveLength(1);
    const [shade] = shades;
    expect(shade).toMatchObject({ color: '#808080', opacity: 0.5, evenOdd: false });
    // Cell (1, 1) spans x 14 → 18 and y 3 → 4 in the drawing (the table hangs down from (10, 5)).
    expect(Math.min(...xs(shade!))).toBeGreaterThan(14);
    expect(Math.max(...xs(shade!))).toBeLessThan(18);
    expect(Math.min(...ys(shade!))).toBeGreaterThan(3);
    // Margins are 0 without a table style: the text hangs from the cell's top edge.
    expect(Math.max(...ys(shade!))).toBeLessThanOrEqual(4);
  });

  it('shades only the field: the second A of the cell, not the first', () => {
    const { prims } = setup(table());
    const shade = prims.find(isShade)!;
    // The cell's glyphs: the strokes after the shade that lie inside cell (1, 1).
    const inCell = prims.filter(
      (p) =>
        p.kind === 'stroke' &&
        xs(p).every((x) => x >= 14 && x < 18) &&
        ys(p).every((y) => y > 3 && y < 4),
    );
    expect(inCell.length).toBeGreaterThan(0);
    const glyphX = inCell.flatMap(xs);
    const [left, right] = [Math.min(...glyphX), Math.max(...glyphX)];
    // romans' A is a square one font unit wide advancing two: the shade starts past the first
    // A's ink and covers the second's, to the end of its advance.
    const [s0, s1] = [Math.min(...xs(shade)), Math.max(...xs(shade))];
    expect(s0).toBeGreaterThan(left + (right - left) / 3);
    expect(s0).toBeLessThan(right);
    expect(s1).toBeGreaterThanOrEqual(right);
  });

  it("draws over the cell's fill and under the cell's text", () => {
    const { prims } = setup(table());
    const shadeAt = prims.findIndex(isShade);
    const fillAt = prims.findIndex((p) => p.kind === 'fill' && !isShade(p));
    const firstStroke = prims.findIndex((p) => p.kind === 'stroke');
    expect(fillAt).toBeGreaterThanOrEqual(0);
    expect(fillAt).toBeLessThan(shadeAt);
    expect(shadeAt).toBeLessThan(firstStroke);
  });

  it('leaves the block as it was drawn: the same parts as the table without the field', () => {
    const shaded = setup(table()).prims.filter((p) => !isShade(p));
    const plain = setup(table(cell('AA'))).prims;
    expect(shaded).toEqual(plain);
    expect(plain.some(isShade)).toBe(false);
  });

  it('gives a merged range its head cell’s shading once, and a block or empty cell none', () => {
    const merged = setup({
      ...table(),
      cells: [
        [cell('AA', { field, columnSpan: 2 }), cell('', { merged: true })],
        [cell('', { field }), cell('A')],
      ],
    });
    const shades = merged.prims.filter(isShade);
    expect(shades).toHaveLength(1);
    // The merged range spans the whole first row: x 10 → 18, y 4 → 5.
    expect(Math.min(...ys(shades[0]!))).toBeGreaterThan(4);
  });

  it('never plots the shading', () => {
    const { model } = setup(table());
    const styles = Array.from({ length: CTB_STYLE_COUNT }, (_, i) =>
      newPlotStyle(`Color_${i + 1}`),
    );
    const resolver = new PlotResolver({
      kind: 'ctb',
      description: 'test',
      scaleFactor: 1,
      applyFactor: false,
      lineweightUnits: 'mm',
      lineweights: DEFAULT_PLOT_LINEWEIGHTS,
      styles,
    });
    const text = { fonts: fontBook(), style: (h: string) => model.tables.textStyles.get(h) };
    const parts = plotParts(model, MODEL, { resolver, tessellate: { text } });
    const fills = parts.filter((p) => p.kind === 'fill');
    // The yellow fill of cell (1, 1) plots; the grey shade does not.
    expect(fills).toHaveLength(1);
  });
});

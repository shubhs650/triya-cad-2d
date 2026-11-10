// M2-26 part 2: the grips of an MTEXT set in columns (AutoCAD 2024 Help, "To Change the Columns
// of Multiline Text with Grips"): besides its insertion point, the column width, the gutter and
// the column height (one per column for dynamic columns of manual height), and what dragging each
// does to the columns.
import { describe, expect, it } from 'vitest';
import { gripsOf, moveGrip, withColumnCount, type MTextGeometry } from '../../src/index';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** Two static columns 30 wide, gutter 5, 40 high, inserted top left at (10,100). */
const columned = (over: Partial<MTextGeometry> = {}, cols = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents: 'one\\Ptwo',
  style: '30',
  position: { x: 10, y: 100 },
  height: 2.5,
  width: 30,
  definedHeight: 40,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  columns: {
    type: 1,
    count: 2,
    flowReversed: false,
    autoHeight: false,
    width: 30,
    gutter: 5,
    heights: [],
    ...cols,
  },
  ...over,
});

const pts = (g: MTextGeometry) => gripsOf(g).map((x) => [r6(x.point.x), r6(x.point.y), x.kind]);

const shaped = (g: MTextGeometry, grip: { x: number; y: number }, to: { x: number; y: number }) => {
  const r = moveGrip(g, grip, to);
  if (r.kind !== 'shape') throw new Error(`expected a shape, got ${r.kind}`);
  return r.geom as MTextGeometry;
};

describe('MTEXT column grips', () => {
  it('a plain MTEXT keeps its one grip, which moves it', () => {
    const { columns: _c, ...plain } = columned();
    expect(pts(plain)).toEqual([[10, 100, 'move']]);
  });

  it('static columns: insertion point, column width, gutter and column height', () => {
    expect(pts(columned())).toEqual([
      [10, 100, 'move'],
      // The first column's top right corner, the second column's top left corner.
      [40, 100, 'columnWidth'],
      [45, 100, 'columnGutter'],
      // The middle of the first column's bottom edge.
      [25, 60, 'columnHeight'],
    ]);
  });

  it('one column has no gutter grip', () => {
    expect(pts(columned({}, { count: 1 })).map((p) => p[2])).toEqual([
      'move',
      'columnWidth',
      'columnHeight',
    ]);
  });

  it('dynamic columns of manual height: a height grip under each column', () => {
    const g = columned({ definedHeight: 40 }, { type: 2, count: 3, heights: [40, 20, 30] });
    expect(pts(g).filter((p) => p[2] === 'columnHeight')).toEqual([
      [25, 60, 'columnHeight'],
      [60, 80, 'columnHeight'],
      [95, 70, 'columnHeight'],
    ]);
  });

  it('dynamic columns of auto height without a height show no height grip', () => {
    const { definedHeight: _h, ...g } = columned({}, { type: 2, autoHeight: true });
    expect(pts(g).map((p) => p[2])).toEqual(['move', 'columnWidth', 'columnGutter']);
  });

  it('follows the attachment: bottom right puts the frame up and left of the insertion point', () => {
    // Total width 2 × 30 + 5 = 65, height 40.
    expect(pts(columned({ attachment: 9 }))).toEqual([
      [10, 100, 'move'],
      [-25, 140, 'columnWidth'],
      [-20, 140, 'columnGutter'],
      [-40, 100, 'columnHeight'],
    ]);
  });

  it('turns with the text', () => {
    // Rotated 90°: the text's x axis is the drawing's y axis.
    expect(pts(columned({ rotation: Math.PI / 2 }))).toEqual([
      [10, 100, 'move'],
      [10, 130, 'columnWidth'],
      [10, 135, 'columnGutter'],
      [50, 115, 'columnHeight'],
    ]);
  });

  it('columns set right to left: the frame is the same, its first column on the right', () => {
    const g = columned({}, { type: 2, count: 2, flowReversed: true, heights: [40, 20] });
    // Column 1 (40 high) is the right one, column 2 (20 high) the left one.
    expect(pts(g).filter((p) => p[2] === 'columnHeight')).toEqual([
      [60, 60, 'columnHeight'],
      [25, 80, 'columnHeight'],
    ]);
  });

  it('the column width grip sets the width of every column, and the text width with it', () => {
    const g = shaped(columned(), { x: 40, y: 100 }, { x: 46, y: 97 });
    expect(g.width).toBe(36);
    expect(g.columns).toMatchObject({ width: 36, gutter: 5, count: 2 });
    expect(g.position).toEqual({ x: 10, y: 100 });
  });

  it('the gutter grip sets the gutter, never below 0', () => {
    expect(shaped(columned(), { x: 45, y: 100 }, { x: 47, y: 100 }).columns).toMatchObject({
      width: 30,
      gutter: 7,
    });
    expect(shaped(columned(), { x: 45, y: 100 }, { x: 30, y: 100 }).columns?.gutter).toBe(0);
  });

  it('the height grip sets the column height; dragged above the top it does nothing', () => {
    const g = shaped(columned(), { x: 25, y: 60 }, { x: 22, y: 50 });
    expect(g.definedHeight).toBe(50);
    expect(moveGrip(columned(), { x: 25, y: 60 }, { x: 25, y: 120 }).kind).toBe('none');
  });

  it('a manual height grip sets its own column, the tallest being the defined height', () => {
    const g = columned({ definedHeight: 40 }, { type: 2, count: 3, heights: [40, 20, 30] });
    const after = shaped(g, { x: 60, y: 80 }, { x: 60, y: 45 });
    expect(after.columns?.heights).toEqual([40, 55, 30]);
    expect(after.definedHeight).toBe(55);
  });

  it('the width grip on turned text reads the drag along the text', () => {
    const g = columned({ rotation: Math.PI / 2 });
    expect(r6(shaped(g, { x: 10, y: 130 }, { x: 4, y: 140 }).columns!.width)).toBe(40);
  });

  it('a width dragged to nothing does nothing', () => {
    expect(moveGrip(columned(), { x: 40, y: 100 }, { x: 5, y: 100 }).kind).toBe('none');
  });
});

describe('withColumnCount', () => {
  it('sets the dynamic count; manual heights take the last one for added columns', () => {
    const g = columned({ definedHeight: 40 }, { type: 2, count: 2, heights: [40, 20] });
    expect(withColumnCount(g, 4).columns).toMatchObject({ count: 4, heights: [40, 20, 20, 20] });
    const one = withColumnCount(g, 1);
    expect(one.columns).toMatchObject({ count: 1, heights: [40] });
    expect(one.definedHeight).toBe(40);
  });

  it('keeps an MTEXT already at that count, and static columns, as they are', () => {
    const g = columned({}, { type: 2, autoHeight: true });
    expect(withColumnCount(g, 2)).toBe(g);
    const s = columned();
    expect(withColumnCount(s, 5)).toBe(s);
  });
});

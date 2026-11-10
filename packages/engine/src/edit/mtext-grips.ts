// The grips of an MTEXT set in columns (M2-26 part 2), after AutoCAD 2024 Help ("To Change the
// Columns of Multiline Text with Grips"): besides the insertion point, a column width grip, a
// gutter grip and a column height grip, one under each column for dynamic columns of manual
// height. AutoCAD's help names the grips without placing them exactly; Triya puts the column
// width grip on the top right corner of the leftmost column, the gutter grip on the top left
// corner of the column after it, and a height grip in the middle of a column's bottom edge (our
// reading, noted in the PR). With no gutter the two top grips meet and the width grip is found
// first; Column Settings still sets the gutter.
//
// The frame is placed as `layoutMText` (@triya/text) places it: by the attachment, around the
// insertion point, its height the tallest column. Text running past the last column's height
// (which the layout lets it) is not measured here, as the engine has no fonts.
//
// A drag is read along the text's own axes: the column width and the gutter change by its x
// part, a height by its y part, whatever the attachment (so the grip follows the cursor
// exactly for a top left attachment, AutoCAD's default). Dynamic columns then take as many
// columns as the text needs, which only the renderer can measure: the grip command asks it
// (`columnCounts`, `withColumnCount`).
import type { Vec2 } from '../geom/types';
import type { MTextGeometry } from '../model/types';
import type { Grip } from './grips';

type Columns = NonNullable<MTextGeometry['columns']>;

/** The columns an MTEXT is set in, or undefined (none, or a count that draws none). */
function columnsOf(g: MTextGeometry): Columns | undefined {
  const c = g.columns;
  return c && (c.type === 1 || c.type === 2) && c.count >= 1 && c.width > 0 ? c : undefined;
}

/** A column's height, as the renderer reads it: its own (manual), else the defined height. */
const columnHeight = (g: MTextGeometry, c: Columns, i: number): number | undefined =>
  c.heights[i] ?? g.definedHeight;

/** The text's frame: its own (x, y) to the drawing's, as the renderer turns MTEXT. */
function frameOf(g: MTextGeometry) {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const my = g.upsideDown ? -1 : 1;
  return {
    toWorld: (x: number, y: number): Vec2 => ({
      x: g.position.x + cos * x - sin * my * y,
      y: g.position.y + sin * x + cos * my * y,
    }),
    /** The drawing's direction of the text's own (x, y) direction. */
    direction: (x: number, y: number): Vec2 => ({
      x: cos * x - sin * my * y,
      y: sin * x + cos * my * y,
    }),
    toLocal: (d: Vec2): Vec2 => ({
      x: cos * d.x + sin * d.y,
      y: my * (-sin * d.x + cos * d.y),
    }),
  };
}

interface ColumnGrip extends Grip {
  readonly kind: 'columnWidth' | 'columnGutter' | 'columnHeight';
  /** A height grip's column, in flow order. */
  readonly column?: number;
}

function placedGrips(g: MTextGeometry): ColumnGrip[] {
  const c = columnsOf(g);
  if (!c) return [];
  const n = c.count;
  const heights = Array.from({ length: n }, (_, i) => columnHeight(g, c, i));
  const finite = heights.filter((h): h is number => h !== undefined && Number.isFinite(h));
  const total = n * c.width + (n - 1) * c.gutter;
  const tall = finite.length > 0 ? Math.max(...finite) : 0;
  const a = Math.min(9, Math.max(1, Math.round(g.attachment))) - 1;
  const left = [0, -0.5, -1][a % 3]! * total;
  const top = [0, 0.5, 1][Math.floor(a / 3)]! * tall;
  const columnX = (i: number) => left + (c.flowReversed ? n - 1 - i : i) * (c.width + c.gutter);
  const { toWorld, direction } = frameOf(g);
  const across = direction(1, 0);
  const down = direction(0, -1);
  const out: ColumnGrip[] = [
    { point: toWorld(left + c.width, top), kind: 'columnWidth', towards: across },
  ];
  if (n > 1) {
    out.push({
      point: toWorld(left + c.width + c.gutter, top),
      kind: 'columnGutter',
      towards: across,
    });
  }
  const manual = c.type === 2 && c.heights.length > 0;
  for (let i = 0; i < (manual ? n : 1); i++) {
    const h = heights[i];
    if (h === undefined || !Number.isFinite(h)) continue;
    out.push({
      point: toWorld(columnX(i) + c.width / 2, top - h),
      kind: 'columnHeight',
      towards: down,
      column: i,
    });
  }
  return out;
}

/** A columned MTEXT's column grips (none without columns), after its insertion point's. */
export function columnGrips(g: MTextGeometry): Grip[] {
  return placedGrips(g).map(({ point, kind, towards }) => ({
    point,
    kind,
    ...(towards && { towards }),
  }));
}

const near = (a: Vec2, b: Vec2): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9 * Math.max(1, Math.abs(a.x), Math.abs(a.y));

/**
 * The MTEXT with its column grip at `grip` dragged by `d`, or undefined when there is none
 * there or the drag leaves a column no width or height.
 */
export function moveColumnGrip(g: MTextGeometry, grip: Vec2, d: Vec2): MTextGeometry | undefined {
  const c = columnsOf(g);
  const found = placedGrips(g).find((x) => near(x.point, grip));
  if (!c || !found) return undefined;
  const local = frameOf(g).toLocal(d);
  switch (found.kind) {
    case 'columnWidth': {
      const width = c.width + local.x;
      if (!(width > 0)) return undefined;
      // DXF 41 is the column width when the MTEXT has columns (as TEXTEDIT writes it).
      return { ...g, width, columns: { ...c, width } };
    }
    case 'columnGutter':
      return { ...g, columns: { ...c, gutter: Math.max(0, c.gutter + local.x) } };
    case 'columnHeight': {
      const i = found.column ?? 0;
      const height = (columnHeight(g, c, i) ?? 0) - local.y;
      if (!(height > 0)) return undefined;
      if (c.type === 2 && c.heights.length > 0) {
        const heights = c.heights.map((h, k) => (k === i ? height : h));
        return { ...g, definedHeight: Math.max(...heights), columns: { ...c, heights } };
      }
      return { ...g, definedHeight: height };
    }
  }
}

/**
 * The MTEXT with `count` dynamic columns, as the renderer counts the text needs after a column
 * grip changed them: a column added to manual heights takes the last one's height, as TEXTEDIT
 * does. Static columns, and an MTEXT already at the count, come back as they are.
 */
export function withColumnCount(g: MTextGeometry, count: number): MTextGeometry {
  const c = columnsOf(g);
  if (!c || c.type !== 2 || !(count >= 1) || count === c.count) return g;
  if (c.heights.length === 0) return { ...g, columns: { ...c, count } };
  const heights = Array.from(
    { length: count },
    (_, i) => c.heights[Math.min(i, c.heights.length - 1)]!,
  );
  return { ...g, definedHeight: Math.max(...heights), columns: { ...c, count, heights } };
}

/** Dynamic columns, whose count follows the text after a column grip changed them. */
export const hasDynamicColumns = (g: MTextGeometry): boolean => columnsOf(g)?.type === 2;

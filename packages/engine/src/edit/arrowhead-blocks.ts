// AutoCAD's arrowheads as blocks (M2-35 part 22): the Arrow 1 / Arrow 2 list of a dimension and
// the Arrowhead list of a multileader (AutoCAD 2024 Help, "Lines and Arrows Tab (Modify
// Dimension Style Dialog Box)" and "Leader Format Tab (Modify Multileader Style Dialog Box)").
// Every arrowhead but closed filled is a block named `_NAME` that AutoCAD adds to a drawing the
// first time it is chosen. Triya authors the ones a drawing lacks from their published shapes
// (never copied from an AutoCAD install: CLAUDE.md, "No Autodesk assets").
//
// Every block is drawn for a size of 1 with its tip at the base point and its back towards −X:
// the dimension generator inserts it at the tip, turned along the dimension line and scaled by
// DIMASZ (`@triya/dims` arrowParts). The shapes AutoCAD stores in drawings we can read agree:
// `_ARCHTICK` a 0.15-wide polyline from (−0.5, −0.5) to (0.5, 0.5), `_CLOSEDBLANK` a closed
// triangle back to x = −1 and a sixth of the size either side of the line, `_BOXBLANK` a unit
// square about the tip and a line from its back edge to x = −1 (acadsharp sample_AC1009 and
// ezdxf mtext_text_frame.dxf). An arrowhead whose dimension line stops at its back (every one
// not drawn about the tip, `DRAWN_AT_TIP` in dims) carries that line on to the tip itself, as
// those blocks do. The help names the rest without sizes; our reading, the one ezdxf's MIT
// arrows module also draws: the dot a filled disc 1 across, the open arrows' arms back to
// x = −1 at their angle, the datum triangle equilateral with its base across the tip, the
// integral two quarter arcs. Where ezdxf draws the small dots as large as the dot, we draw them
// half its size, as AutoCAD's list shows them smaller. Every part is on layer 0, ByBlock, so
// the dimension's colour, linetype and lineweight show through.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { BlockDefinition, EntityGeometry } from '../model/types';

/** AutoCAD's arrowhead blocks with the names its lists give them, in the lists' order. */
export const ARROWHEAD_BLOCKS: readonly { readonly name: string; readonly label: string }[] = [
  { name: '_CLOSEDBLANK', label: 'Closed blank' },
  { name: '_CLOSED', label: 'Closed' },
  { name: '_DOT', label: 'Dot' },
  { name: '_ARCHTICK', label: 'Architectural tick' },
  { name: '_OBLIQUE', label: 'Oblique' },
  { name: '_OPEN', label: 'Open' },
  { name: '_ORIGIN', label: 'Origin indicator' },
  { name: '_ORIGIN2', label: 'Origin indicator 2' },
  { name: '_OPEN90', label: 'Right angle' },
  { name: '_OPEN30', label: 'Open 30' },
  { name: '_DOTSMALL', label: 'Dot small' },
  { name: '_DOTBLANK', label: 'Dot blank' },
  { name: '_SMALL', label: 'Dot small blank' },
  { name: '_BOXBLANK', label: 'Box' },
  { name: '_BOXFILLED', label: 'Box filled' },
  { name: '_DATUMBLANK', label: 'Datum triangle' },
  { name: '_DATUMFILLED', label: 'Datum triangle filled' },
  { name: '_INTEGRAL', label: 'Integral' },
  { name: '_NONE', label: 'None' },
];

/** AutoCAD's name for arrowhead block `name` (any case), or undefined for another block. */
export function arrowheadBlockName(name: string): string | undefined {
  const n = name.trim().toUpperCase();
  return ARROWHEAD_BLOCKS.find((a) => a.name === n)?.name;
}

/** The label AutoCAD's lists give arrowhead block `name` (any case), or undefined. */
export function arrowheadLabel(name: string): string | undefined {
  const n = name.trim().toUpperCase();
  return ARROWHEAD_BLOCKS.find((a) => a.name === n)?.label;
}

/** The drawing's block for AutoCAD arrowhead `name`, matched without case, or undefined. */
export function arrowheadBlock(
  blocks: ReadonlyMap<Handle, BlockDefinition>,
  name: string,
): BlockDefinition | undefined {
  const n = name.toUpperCase();
  for (const b of blocks.values()) if (b.name.toUpperCase() === n) return b;
  return undefined;
}

const p = (x: number, y: number): Vec2 => ({ x, y });
const line = (a: Vec2, b: Vec2): EntityGeometry => ({ kind: 'LINE', start: a, end: b });
const circle = (radius: number): EntityGeometry => ({ kind: 'CIRCLE', center: p(0, 0), radius });
const polyline = (pts: readonly Vec2[], closed: boolean, width?: number): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: pts.map((v) => ({ x: v.x, y: v.y, bulge: 0 })),
  closed,
  ...(width !== undefined && { constantWidth: width }),
});
/** A filled disc `d` across about the tip: a closed two-arc polyline as wide as its radius. */
const disc = (d: number): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: [
    { x: -d / 4, y: 0, bulge: 1 },
    { x: d / 4, y: 0, bulge: 1 },
  ],
  closed: true,
  constantWidth: d / 2,
});
/** A SOLID through `a`, `b`, `c`, `d` in DXF order (its outline runs a, b, d, c). */
const solid = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): EntityGeometry => ({
  kind: 'SOLID',
  corners: [a, b, c, d],
});
/** The dimension line from `x` back to x = −1, where the line stops at the arrowhead's back. */
const tail = (x: number): EntityGeometry => line(p(x, 0), p(-1, 0));

/** Arms of an open or closed arrow back to x = −1, `half` radians either side of the line. */
const arms = (half: number): [Vec2, Vec2, Vec2] => {
  const h = Math.tan(half);
  return [p(-1, h), p(0, 0), p(-1, -h)];
};

/** The parts of AutoCAD arrowhead `name` (any case) for a size of 1, or undefined. */
export function arrowheadBlockParts(name: string): EntityGeometry[] | undefined {
  // Closed and open arrows: a sixth of the size either side of the line at the back (the
  // sample's 0.1667; closed filled's SOLID in dims is drawn so).
  const arrow = Math.atan(1 / 6);
  const tick = [p(-0.5, -0.5), p(0.5, 0.5)];
  const square = [p(-0.5, -0.5), p(0.5, -0.5), p(0.5, 0.5), p(-0.5, 0.5)];
  const datum = Math.tan(Math.PI / 6);
  switch (arrowheadBlockName(name)) {
    case '_CLOSEDBLANK':
      return [polyline(arms(arrow), true)];
    case '_CLOSED':
      return [polyline(arms(arrow), true), tail(0)];
    case '_DOT':
      return [disc(1), tail(-0.5)];
    case '_ARCHTICK':
      return [polyline(tick, false, 0.15)];
    case '_OBLIQUE':
      return [line(tick[0]!, tick[1]!)];
    case '_OPEN':
      return [polyline(arms(arrow), false), tail(0)];
    case '_ORIGIN':
      return [circle(0.5), tail(0)];
    case '_ORIGIN2':
      return [circle(0.5), circle(0.25), tail(-0.5)];
    case '_OPEN90': {
      // Arms at right angles, each 45° off the line, as long as the closed arrow's.
      const [a, tip, b] = arms(Math.PI / 4).map((v) => ({ x: v.x / 2, y: v.y / 2 }));
      return [polyline([a!, tip!, b!], false), tail(0)];
    }
    case '_OPEN30':
      return [polyline(arms(Math.PI / 12), false), tail(0)];
    case '_DOTSMALL':
      return [disc(0.5)];
    case '_DOTBLANK':
      return [circle(0.5), tail(-0.5)];
    case '_SMALL':
      return [circle(0.25)];
    case '_BOXBLANK':
      return [polyline(square, true), tail(-0.5)];
    case '_BOXFILLED':
      return [solid(square[0]!, square[1]!, square[3]!, square[2]!), tail(-0.5)];
    case '_DATUMBLANK':
      return [polyline([p(0, datum), p(0, -datum), p(-1, 0)], true)];
    case '_DATUMFILLED':
      return [solid(p(0, datum), p(0, -datum), p(-1, 0), p(-1, 0))];
    case '_INTEGRAL': {
      // Two quarter arcs meeting at the tip, an S across the line (r = √2 / 4 of the size).
      const r = Math.SQRT2 / 4;
      return [
        { kind: 'ARC', center: p(-r, 0), radius: r, startAngle: -Math.PI / 2, endAngle: 0 },
        { kind: 'ARC', center: p(r, 0), radius: r, startAngle: Math.PI / 2, endAngle: Math.PI },
      ];
    }
    case '_NONE':
      return [];
    default:
      return undefined;
  }
}

/**
 * The handle of the drawing's block for AutoCAD arrowhead `name`, adding the block (based at the
 * origin, its parts on layer 0, ByBlock) when the drawing lacks it. Undefined for a name that is
 * not one of AutoCAD's arrowheads.
 */
export function addArrowheadBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  name: string,
): Handle | undefined {
  const canonical = arrowheadBlockName(name);
  const parts = arrowheadBlockParts(name);
  if (!canonical || !parts) return undefined;
  const have = arrowheadBlock(model.blocks, canonical);
  if (have) return have.handle;
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const block = b.addBlock({ name: canonical, basePoint: p(0, 0) }).handle;
  for (const geom of parts) {
    b.addEntity({
      owner: block,
      layer: zero,
      geom,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
    });
  }
  return block;
}

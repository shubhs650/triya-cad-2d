// Block attributes on screen (M1-14 part 2). AutoCAD rules encoded here:
// - An INSERT's ATTRIBs draw where they are stored (their positions are already in the
//   INSERT's owner's coordinates), with their own properties: ByBlock takes the INSERT's, and
//   one on layer 0 shows on the INSERT's layer, as the block's own objects do.
// - A block's ATTDEFs do not draw through a reference, except a constant one, which has no
//   ATTRIB and shows its value as part of the block.
// - An ATTDEF outside a block draws its tag.
// - ATTMODE (ATTDISP): 0 hides every attribute, 1 shows the visible ones, 2 shows them all.
import type {
  AttdefGeometry,
  EntityInit,
  InsertAttribute,
  InsertGeometry,
  MTextGeometry,
  TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  defaultPaint,
  expandInsert,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  tessellate,
  type BlockSource,
  type RenderPrimitive,
} from '../src/index';
import { drawing, entity, LAYER_0, LAYER_RED, line } from './fixtures';
import { fontBook } from './text-fonts';

const BLOCK = '40';
const INNER = '41';
const STYLE = '30';

const style: TextStyleRecord = {
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

const textFields = (value: string, x: number, y: number) => ({
  value,
  style: STYLE,
  position: { x, y },
  height: 10,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const attdef = (tag: string, value: string, flags = 0, x = 0, y = 0): AttdefGeometry => ({
  kind: 'ATTDEF',
  ...textFields(value, x, y),
  tag,
  prompt: tag,
  flags,
});

let next = 0x500;
const attrib = (
  tag: string,
  value: string,
  x: number,
  y: number,
  extra: Partial<InsertAttribute> = {},
): InsertAttribute => ({
  ...textFields(value, x, y),
  tag,
  flags: 0,
  handle: (next++).toString(16).toUpperCase(),
  layer: LAYER_0,
  color: { kind: 'byBlock' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...extra,
});

const insertOf = (
  attributes: InsertAttribute[],
  extra: Partial<InsertGeometry> = {},
): InsertGeometry => ({
  kind: 'INSERT',
  block: BLOCK,
  position: { x: 100, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes,
  ...extra,
});

function setup(entities: EntityInit[], attMode?: number) {
  const d = drawing(entities, {
    blocks: [
      { handle: BLOCK, name: 'B' },
      { handle: INNER, name: 'INNER' },
    ],
    textStyles: [style],
    ...(attMode !== undefined ? { header: [['$ATTMODE', attMode] as const] } : {}),
  });
  const text = { fonts: fontBook(), style: (h: string) => d.model.tables.textStyles.get(h) };
  const src: BlockSource = {
    model: d.model,
    paint: defaultPaint,
    insertContext: defaultPaint.insertContext,
    order: (b) => d.model.blockEntities(b),
    tessellate: { text, ...(attMode !== undefined ? { attributeMode: attMode } : {}) },
  };
  const draw = (handle: string): RenderPrimitive[] => {
    const id = [...d.model.blockEntities(d.model.layouts[0]!.blockRecord)].find(
      (i) => d.model.entity(i)!.handle === handle,
    )!;
    return expandInsert(d.model.entity(id)!, src, { dashes: false }).prims;
  };
  return { d, text, draw };
}

const strokes = (prims: readonly RenderPrimitive[]) => prims.filter((p) => p.kind === 'stroke');

/** The box of the glyph strokes' move and line targets (not the greeking box). */
function inkBox(prims: readonly RenderPrimitive[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of prims) {
    if (!('path' in p)) continue;
    for (let i = 0; i < p.path.length;) {
      const op = p.path[i]!;
      if (op === PATH_M || op === PATH_L) {
        xs.push(p.path[i + 1]!);
        ys.push(p.path[i + 2]!);
        i += 3;
      } else if (op === PATH_A) i += 7;
      else if (op === PATH_Z) i += 1;
      else throw new Error(`unexpected path command ${op}`);
    }
  }
  const r = (v: number) => Math.round(v * 1e9) / 1e9;
  return {
    minX: r(Math.min(...xs)),
    minY: r(Math.min(...ys)),
    maxX: r(Math.max(...xs)),
    maxY: r(Math.max(...ys)),
  };
}

describe('block attributes (M1-14 part 2)', () => {
  it('draws an ATTRIB where it is stored, not moved by the INSERT, in the INSERT colour for ByBlock', () => {
    const { draw } = setup([
      entity('A1', insertOf([attrib('NAME', 'A', 20, 30)]), {
        color: { kind: 'aci', index: 3 },
      }),
    ]);
    const prims = strokes(draw('A1'));
    expect(prims).toHaveLength(1);
    // romans draws A as a unit square at height 10 (above 10): from the stored (20, 30).
    expect(inkBox(prims)).toEqual({ minX: 20, minY: 30, maxX: 21, maxY: 31 });
    const lineColour = strokes(
      setup([
        entity('C1', line(0, 0, 1, 0), { owner: BLOCK, color: { kind: 'byBlock' } }),
        entity('A1', insertOf([]), { color: { kind: 'aci', index: 3 } }),
      ]).draw('A1'),
    )[0]!.color;
    expect(prims[0]!.color).toEqual(lineColour);
  });

  it("shows an ATTRIB on layer 0 on the INSERT's layer, and one on its own layer on that layer", () => {
    const { draw } = setup([
      entity(
        'A1',
        insertOf([
          attrib('ON0', 'A', 0, 0, { color: { kind: 'byLayer' } }),
          attrib('RED', 'A', 50, 0, { color: { kind: 'byLayer' }, layer: LAYER_RED }),
        ]),
        { layer: LAYER_RED },
      ),
    ]);
    const prims = strokes(draw('A1'));
    expect(prims).toHaveLength(2);
    expect(prims[0]!.color).toEqual(prims[1]!.color);
    expect(prims[0]!.color).not.toBe('foreground');
  });

  it('draws nothing for a block ATTDEF through a reference, and a constant one as its value', () => {
    const { draw } = setup([
      entity('D1', attdef('ASKED', 'AAAA', 0, 0, 50), { owner: BLOCK }),
      entity('D2', attdef('FIXED', 'A', 2, 5, 0), { owner: BLOCK }),
      entity('A1', insertOf([], { scale: { x: 2, y: 2, z: 1 } })),
    ]);
    const prims = strokes(draw('A1'));
    // Only the constant value: one A, from (5, 0) in the block, scaled 2 about the base point
    // and moved to (100, 0).
    expect(prims).toHaveLength(1);
    expect(inkBox(prims)).toEqual({ minX: 110, minY: 0, maxX: 112, maxY: 2 });
  });

  it('draws an ATTDEF outside a block as its tag', () => {
    const { text } = setup([]);
    const prims = tessellate(attdef('AB', 'AAAAAA'), { color: 'foreground' }, { text });
    // Tag "AB": the square, then B's semicircle; never the six-letter default value.
    const box = inkBox(prims);
    expect(box.minX).toBe(0);
    expect(box.maxX).toBeLessThan(5);
  });

  it('hides an invisible ATTRIB unless ATTMODE is 2, and every attribute under ATTMODE 0', () => {
    const entities = () => [
      entity('D2', attdef('FIXED', 'A', 2, 5, 0), { owner: BLOCK }),
      entity(
        'A1',
        insertOf([attrib('SHOWN', 'A', 0, 0), attrib('HIDDEN', 'A', 50, 0, { flags: 1 })]),
      ),
    ];
    expect(strokes(setup(entities()).draw('A1'))).toHaveLength(2);
    expect(strokes(setup(entities(), 1).draw('A1'))).toHaveLength(2);
    expect(strokes(setup(entities(), 2).draw('A1'))).toHaveLength(3);
    expect(strokes(setup(entities(), 0).draw('A1'))).toHaveLength(0);
  });

  it('draws a multiline ATTRIB from its embedded MTEXT', () => {
    const mtext: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'A\\PA',
      style: STYLE,
      position: { x: 0, y: 0 },
      height: 10,
      width: 0,
      rotation: 0,
      attachment: 7,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    const { draw } = setup([entity('A1', insertOf([attrib('M', 'A A', 0, 0, { mtext })]))]);
    const box = inkBox(strokes(draw('A1')));
    // Two lines: taller than one line's square.
    expect(box.maxY - box.minY).toBeGreaterThan(10);
  });

  it("draws a MINSERT's attributes once, and a nested INSERT's attributes with its block", () => {
    const { draw } = setup([
      entity(
        'A1',
        insertOf([attrib('ONCE', 'A', 0, 0)], {
          array: { columns: 3, rows: 2, columnSpacing: 10, rowSpacing: 10 },
        }),
      ),
      // INNER holds an INSERT of B with an attribute at (1, 0) in INNER's coordinates.
      entity('B1', insertOf([attrib('IN', 'A', 1, 0)], { position: { x: 0, y: 0 } }), {
        owner: INNER,
      }),
      entity(
        'A2',
        insertOf([], { block: INNER, position: { x: 200, y: 0 }, rotation: Math.PI / 2 }),
      ),
    ]);
    expect(strokes(draw('A1'))).toHaveLength(1);
    const nested = inkBox(strokes(draw('A2')));
    // (1, 0) in INNER turned a quarter about the insertion point (200, 0): (200, 1), and the
    // square turned with it.
    expect(nested.minX).toBeCloseTo(199, 9);
    expect(nested.maxX).toBeCloseTo(200, 9);
    expect(nested.minY).toBeCloseTo(1, 9);
    expect(nested.maxY).toBeCloseTo(2, 9);
  });
});

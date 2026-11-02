// M1-45: text and shapes inside complex linetypes. `dashPath` places them (M1-13 part 3); the
// tessellator now draws them through the text engine and SHX shapes, in the entity's colour
// and lineweight, as part of the dashed stroke only (once the pattern is under a pixel the
// renderer draws the continuous path, and the embeds go with the dashes).
//
// AutoCAD ("Text in Custom Linetypes"): S= multiplies the text style's fixed height, or is
// the height itself when the style's height is 0; shapes are drawn at S= times the linetype
// scale, the shape number taken from the shape file the STYLE record names.
import type { EntityGeometry, TextStyleRecord } from '@triya/engine';
import { FontBook, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { PATH_A, PATH_L, PATH_M, type RenderPrimitive } from '../src/types';
import { tessellate, type Paint } from '../src/tessellate';
import type { LinePattern, PatternEmbed } from '../src/style/pattern';
import { buildShapes } from '../../text/test/shx/builder';
import { romans } from './text-fonts';

const TEXT_STYLE = '11';
const SHAPES = '27F';
const style = (handle: string, font: string, height: number, flags = 0): TextStyleRecord => ({
  handle,
  name: handle === SHAPES ? '' : 'Standard',
  ...(flags ? { flags } : {}),
  font,
  height,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 0.2,
  generation: 0,
  trueTypeFlags: 0,
});

/** A shape file (no font info) with shape 130: a 1×1 square from the pen. */
const shapeFile = () =>
  parseShx(buildShapes([{ code: 130, name: 'BOX', bytes: [0x14, 0x10, 0x1c, 0x18, 0] }]));

function context(textHeight = 0) {
  const fonts = new FontBook();
  fonts.addShx('romans.shx', romans());
  fonts.addShx('shapes.shx', shapeFile());
  const styles = new Map([
    [TEXT_STYLE, style(TEXT_STYLE, 'romans.shx', textHeight)],
    // DXF 70 bit 1: a shape file.
    [SHAPES, style(SHAPES, 'shapes.shx', 0, 1)],
  ]);
  return { text: { fonts, style: (h: string) => styles.get(h) } };
}

const embedText = (over: Partial<PatternEmbed> = {}): PatternEmbed => ({
  kind: 'text',
  text: 'A',
  style: TEXT_STYLE,
  scale: 0.1,
  rotation: 0,
  rotationMode: 'relative',
  offset: { x: -0.1, y: -0.05 },
  ...over,
});

/** GAS_LINE as the corpus stores it: dash .5, gap .2 holding the text, gap .25. */
const gas = (embed: PatternEmbed): LinePattern => ({
  name: 'GAS_LINE',
  description: '',
  elements: [{ length: 0.5 }, { length: -0.2, embed }, { length: -0.25 }],
});

const paint = (pattern: LinePattern, scale = 1): Paint => ({
  color: '#ff0000',
  lineweight: 0.5,
  linetype: { pattern, scale },
});

const line = (x: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: 0, y: 0 },
  end: { x, y: 0 },
});

/** The points a path moves and draws to (arcs by their centres), for its extents. */
function extents(path: readonly number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op === PATH_M || op === PATH_L) {
      xs.push(path[i + 1]!);
      ys.push(path[i + 2]!);
      i += 3;
    } else if (op === PATH_A) {
      xs.push(path[i + 1]!);
      ys.push(path[i + 2]!);
      i += 7;
    } else throw new Error(`unexpected path op ${op}`);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const glyphs = (prims: RenderPrimitive[]) =>
  prims.filter(
    (p): p is RenderPrimitive & { kind: 'stroke' } => p.kind === 'stroke' && !p.continuous,
  );

describe('text in complex linetypes (M1-45)', () => {
  it('draws the text at each placement, S= high when the style has no fixed height', () => {
    // P = 0.95 and L = 1.9: two placements, at x = 0.35 and 1.3, y = -0.05.
    const prims = tessellate(line(1.9), paint(gas(embedText())), context());
    const dashes = prims.filter((p) => p.kind === 'stroke' && p.continuous);
    expect(dashes).toHaveLength(1);
    const text = glyphs(prims);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({ color: '#ff0000', lineweight: 0.5 });
    // romans' A is a cell 1×1 font units at cap height 10: 0.01 square at height 0.1.
    const e = extents(text[0]!.path);
    expect(e.minX).toBeCloseTo(0.35, 9);
    expect(e.maxX).toBeCloseTo(1.3 + 0.01, 9);
    expect(e.minY).toBeCloseTo(-0.05, 9);
    expect(e.maxY).toBeCloseTo(-0.05 + 0.01, 9);
  });

  it('multiplies a fixed style height by S=, and both by the linetype scale', () => {
    const prims = tessellate(line(3.8), paint(gas(embedText()), 2), context(2));
    // Height 2 × S 0.1 × scale 2 = 0.4; the A cell is a tenth of it.
    const e = extents(glyphs(prims)[0]!.path);
    expect(e.maxY - e.minY).toBeCloseTo(0.04, 9);
    expect(e.minY).toBeCloseTo(-0.1, 9);
  });

  it('turns the text with the placement angle', () => {
    const up: EntityGeometry = { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 0, y: 1.9 } };
    const e = extents(glyphs(tessellate(up, paint(gas(embedText())), context()))[0]!.path);
    // Along +y, Y = -0.05 is to the right (+x), and the cell's height runs towards −x.
    expect(e.maxX).toBeCloseTo(0.05, 9);
    expect(e.minX).toBeCloseTo(0.04, 9);
    expect(e.minY).toBeCloseTo(0.35, 9);
  });

  it('draws nothing in the gap without fonts, or for a style it cannot find', () => {
    expect(glyphs(tessellate(line(1.9), paint(gas(embedText())), {}))).toEqual([]);
    const lost = embedText({ style: 'FFFF' });
    expect(glyphs(tessellate(line(1.9), paint(gas(lost)), context()))).toEqual([]);
  });
});

describe('shapes in complex linetypes (M1-45)', () => {
  const embedShape = (over: Partial<PatternEmbed> = {}): PatternEmbed => ({
    kind: 'shape',
    shapeNumber: 130,
    style: SHAPES,
    scale: 0.1,
    rotation: 0,
    rotationMode: 'relative',
    offset: { x: -0.1, y: 0 },
    ...over,
  });

  it("draws the shape the STYLE's shape file holds, S= times the linetype scale", () => {
    const prims = tessellate(line(1.9), paint(gas(embedShape())), context());
    const shapes = glyphs(prims);
    expect(shapes).toHaveLength(1);
    // The 1×1 box at size 0.1, from each placement.
    const e = extents(shapes[0]!.path);
    expect(e.minX).toBeCloseTo(0.35, 9);
    expect(e.maxX).toBeCloseTo(1.3 + 0.1, 9);
    expect(e.minY).toBeCloseTo(0, 9);
    expect(e.maxY).toBeCloseTo(0.1, 9);
  });

  it('draws nothing for a shape the file lacks or a shape file that is not loaded', () => {
    const none = embedShape({ shapeNumber: 7 });
    expect(glyphs(tessellate(line(1.9), paint(gas(none)), context()))).toEqual([]);
    const ctx = context();
    const missing = { ...ctx.text, fonts: new FontBook() };
    expect(glyphs(tessellate(line(1.9), paint(gas(embedShape())), { text: missing }))).toEqual([]);
  });
});

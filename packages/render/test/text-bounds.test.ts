// M1-35 part 1: text bounds for the spatial index are the box of what the renderer draws.
import {
  SpatialIndex,
  toleranceForSize,
  type AttdefGeometry,
  type EntityInit,
  type InsertAttribute,
  type MTextGeometry,
  type TextGeometry,
  type TextStyleRecord,
} from '@triya/engine';
import { FontBook } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  primitivesBox,
  tessellate,
  textBounds,
  textOutline,
  type TextContext,
} from '../src/index';
import { drawing, entity, MODEL, surface } from './fixtures';
import { fontBook } from './text-fonts';

const STYLE = '30';
const romansStyle: TextStyleRecord = {
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
const ctx = (fonts = fontBook()): TextContext => ({
  fonts,
  style: (h) => (h === STYLE ? romansStyle : undefined),
});

const text = (value: string, extra: Partial<TextGeometry> = {}): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: STYLE,
  position: { x: 10, y: 20 },
  height: 5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...extra,
});
const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('textBounds', () => {
  it('bounds TEXT by its glyphs and its greeking box', () => {
    // Squares 0.5 wide at x 10 and 11; the run's cap-height box reaches x 12, y 25.
    expect(textBounds(ctx())(text('AA'))).toEqual(box(10, 20, 12, 25));
  });

  it('holds every arc whole and every Bézier by its control points', () => {
    // B is a semicircle of radius 0.5 about (10.5, 20): the whole circle counts.
    expect(textBounds(ctx())(text('B'))).toEqual(box(10, 19.5, 11, 25));
    const leaning = textBounds(ctx())(text('B', { oblique: 0.5 }))!;
    const drawn = primitivesBox(
      tessellate(
        text('B', { oblique: 0.5 }),
        { color: '#fff' },
        {
          text: ctx(),
        },
      ),
    )!;
    expect(leaning).toEqual(drawn);
    expect(leaning.minY).toBeLessThan(19.6);
  });

  it('includes an MTEXT background', () => {
    const m: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'AA',
      style: STYLE,
      position: { x: 0, y: 0 },
      height: 10,
      width: 0,
      rotation: 0,
      attachment: 7,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
      background: { flags: 1, color: { kind: 'aci', index: 1 }, scale: 1.5 },
    };
    expect(textBounds(ctx())(m)).toEqual(box(-5, -5, 9, 15));
  });

  it('bounds an ATTDEF by its tag and an ATTRIB by its value', () => {
    const fields = { ...text(''), flags: 0 };
    const def: AttdefGeometry = { ...fields, kind: 'ATTDEF', tag: 'AA', prompt: 'Name?' };
    expect(textBounds(ctx())(def)).toEqual(box(10, 20, 12, 25));
    const { kind: _kind, ...attr } = { ...fields, value: 'A', tag: 'X' };
    const attrib = {
      ...attr,
      handle: '99',
      layer: '10',
      owner: '1F',
    } as unknown as InsertAttribute;
    expect(textBounds(ctx())(attrib)).toEqual(box(10, 20, 11, 25));
  });

  it('gives text that draws nothing its insertion point, unless its font is missing', () => {
    expect(textBounds(ctx())(text('   '))).toEqual(box(10, 20, 10, 20));
    expect(textBounds(ctx(new FontBook()))(text('A'))).toBeUndefined();
  });

  it('leaves the other annotations to their own geometry', () => {
    const leader = {
      kind: 'LEADER',
      style: '0',
      vertices: [{ x: 0, y: 0 }],
      arrowhead: true,
      pathType: 0,
    } as never;
    expect(textBounds(ctx())(leader)).toBeUndefined();
  });
});

describe('the renderer with text bounds', () => {
  it('culls and picks text by its box', () => {
    const fonts = fontBook();
    const entities: EntityInit[] = [entity('20', text('A', { position: { x: 0, y: 0 } }))];
    const d = drawing(entities, { textStyles: [romansStyle] });
    const tc = { fonts, style: (h: string) => d.model.tables.textStyles.get(h) };
    const { model } = d;
    const index = SpatialIndex.build(model, {
      tol: toleranceForSize(1000),
      annotationBounds: textBounds(tc),
    });
    expect(index.bounds(model.ids.idOf('20')!)).toEqual({
      kind: 'box',
      box: box(0, 0, 1, 5),
    });
    const scene = surface('scene');
    const r = new Canvas2DRenderer({
      model,
      index,
      block: MODEL,
      surface: surface('visible'),
      createLayer: () => scene,
      requestIdle: () => {},
      fonts,
    });
    r.resize(200, 100, 1);
    // The text is far off to the left: culled.
    r.setView({ center: { x: 1000, y: 0 }, scale: 10 });
    r.frame();
    expect(scene.ctx.calls.some((c) => c[0] === 'lineTo')).toBe(false);
    r.setView({ center: { x: 0, y: 0 }, scale: 10 });
    expect(r.hitTest({ x: 100, y: 45 }, 3)).toEqual([model.ids.idOf('20')!]);
  });
});

// M2-27: where a text lies as drawn, for an attribute picked by its text and an attribute's
// justification changed with its insertion point kept.
describe('textOutline', () => {
  const round = (ps: readonly { x: number; y: number }[]) =>
    ps.map((p) => [Number(p.x.toFixed(9)), Number(p.y.toFixed(9))]);

  it("runs a TEXT's box along its baseline from its descender to its height", () => {
    const o = textOutline(ctx())(text('AA'))!;
    expect(o.width).toBe(2);
    expect(o.below).toBeGreaterThanOrEqual(0);
    expect(round(o.corners)).toEqual([
      [10, 20 - o.below],
      [12, 20 - o.below],
      [12, 25],
      [10, 25],
    ]);
  });

  it('places the box by the justification and turns it with the text', () => {
    const centred = textOutline(ctx())(
      text('AA', { halign: 1, valign: 3, alignmentPoint: { x: 50, y: 50 } }),
    )!;
    // Top center: the alignment point at the middle of the top edge.
    expect(round(centred.corners)).toEqual([
      [49, 45 - centred.below],
      [51, 45 - centred.below],
      [51, 50],
      [49, 50],
    ]);
    const turned = textOutline(ctx())(text('AA', { rotation: Math.PI / 2 }))!;
    expect(round(turned.corners)).toEqual([
      [10 + turned.below, 20],
      [10 + turned.below, 22],
      [5, 22],
      [5, 20],
    ]);
  });

  it("bounds an MTEXT by its glyphs' box, and knows nothing without the font", () => {
    const m: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'AA',
      style: STYLE,
      position: { x: 10, y: 25 },
      height: 5,
      width: 0,
      rotation: 0,
      attachment: 1,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    const b = textBounds(ctx())(m)!;
    expect(textOutline(ctx())(m)).toEqual({
      corners: [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ],
      width: 0,
      below: 0,
    });
    expect(textOutline(ctx(new FontBook()))(text('AA'))).toBeUndefined();
    expect(textOutline(ctx(new FontBook()))(m)).toBeUndefined();
  });
});

// Canvas2DRenderer with text (M1-41 part 1): TEXT and MTEXT draw their glyphs from the fonts
// passed in, text inside a dimension's block draws too, a text style edit redraws its text,
// and clicking a glyph picks the text.
import type {
  DimensionGeometry,
  EntityInit,
  MTextGeometry,
  TextGeometry,
  TextStyleRecord,
} from '@triya/engine';
import type { TextFonts } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, type RenderStyle } from '../src/index';
import { change, drawing, entity, MODEL, surface } from './fixtures';
import { fontBook } from './text-fonts';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const D1 = '40';
const STYLE = '30';

const textStyle = (font: string): TextStyleRecord => ({
  handle: STYLE,
  name: 'Standard',
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const text = (value: string): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: STYLE,
  position: { x: 0, y: 0 },
  height: 10,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const mtext = (contents: string): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: STYLE,
  position: { x: 0, y: 0 },
  height: 10,
  width: 0,
  rotation: 0,
  attachment: 7,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

function setup(entities: EntityInit[], fonts: TextFonts | null = fontBook(), font = 'romans') {
  const d = drawing(entities, {
    blocks: [{ handle: D1, name: '*D1' }],
    textStyles: [textStyle(font)],
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
    ...(fonts ? { fonts } : {}),
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 0, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

const count = (c: ReturnType<ReturnType<typeof setup>['redraw']>, name: string) =>
  c.calls.filter((k) => k[0] === name).length;

describe('text in the renderer', () => {
  it('strokes SHX TEXT and fills TrueType MTEXT', () => {
    const shx = setup([entity('20', text('A'))]).redraw();
    expect(count(shx, 'moveTo')).toBe(1);
    expect(count(shx, 'lineTo')).toBe(4);
    expect(count(shx, 'stroke')).toBe(1);
    const ttf = setup([entity('20', mtext('B'))], fontBook(), 'testsans.ttf').redraw();
    expect(count(ttf, 'bezierCurveTo')).toBeGreaterThan(0);
    expect(ttf.calls.filter((k) => k[0] === 'fill').map((k) => k[2])).toEqual(['nonzero']);
  });

  it('draws nothing for text when no fonts are given', () => {
    const c = setup([entity('20', text('A'))], null).redraw();
    expect(count(c, 'moveTo')).toBe(0);
  });

  it('draws the text inside a dimension block', () => {
    const dim: DimensionGeometry = {
      kind: 'DIMENSION',
      dimType: 'linear',
      style: '0',
      block: D1,
      definitionPoint: { x: 10, y: 2 },
      textPosition: { x: 5, y: 2 },
      textUserPositioned: false,
      text: '',
      textRotation: 0,
      horizontalDirection: 0,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1,
      first: { x: 0, y: 0 },
      second: { x: 10, y: 0 },
      rotation: 0,
    };
    const c = setup([entity('50', mtext('AA'), { owner: D1 }), entity('20', dim)]).redraw();
    expect(count(c, 'moveTo')).toBe(2);
  });

  it("draws an INSERT's attributes and an ATTDEF's tag, and follows ATTMODE (M1-14 part 2)", () => {
    const props = {
      layer: '10',
      color: { kind: 'byBlock' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
    } as const;
    const ins = {
      kind: 'INSERT',
      block: D1,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [
        { ...text('A'), ...props, handle: '60', tag: 'SHOWN', flags: 0 },
        { ...text('A'), ...props, handle: '61', tag: 'HIDDEN', flags: 1 },
      ],
    } as const;
    const tag = { ...text('AAAA'), kind: 'ATTDEF', tag: 'A', prompt: '', flags: 0 } as const;
    const { d, r, redraw } = setup([entity('20', ins), entity('21', tag)]);
    // The visible attribute and the ATTDEF's one-letter tag (not its four-letter value).
    expect(count(redraw(), 'moveTo')).toBe(2);
    r.apply(change(d, (b) => b.setHeader('$ATTMODE', 2)));
    expect(count(redraw(), 'moveTo')).toBe(3);
    r.apply(change(d, (b) => b.setHeader('$ATTMODE', 0)));
    // ATTMODE hides attributes, not attribute definitions.
    expect(count(redraw(), 'moveTo')).toBe(1);
  });

  it('redraws its text when a text style changes font', () => {
    const { d, r, redraw } = setup([entity('20', text('A'))]);
    expect(count(redraw(), 'bezierCurveTo')).toBe(0);
    r.apply(change(d, (b) => b.updateTableRecord('textStyles', STYLE, { font: 'testsans.ttf' })));
    expect(count(redraw(), 'fill')).toBe(1);
  });

  it('picks the text by its glyphs', () => {
    const { d, r } = setup([entity('20', text('A'))]);
    r.frame();
    const id = d.model.ids.idOf('20')!;
    // The square glyph's left side runs from (0, 0) to (0, 1): screen (100, 50)–(100, 40).
    expect(r.hitTest({ x: 100, y: 45 }, 3)).toEqual([id]);
    expect(r.hitTest({ x: 160, y: 45 }, 3)).toEqual([]);
  });

  it('greeks text under 3 px tall as a faint box per run', () => {
    const { r, redraw } = setup([entity('20', text('AA'))]);
    // Height 10 at 0.2 px per unit: 2 px.
    r.setView({ center: { x: 0, y: 0 }, scale: 0.2 });
    const c = redraw();
    expect(count(c, 'stroke')).toBe(0);
    expect(c.calls.filter((k) => k[0] === 'fill')).toEqual([['fill', '#ffffff', 'nonzero', 0.35]]);
    // At 3 px the glyphs are back.
    r.setView({ center: { x: 0, y: 0 }, scale: 0.3 });
    expect(count(redraw(), 'stroke')).toBe(1);
  });

  it('masks in the canvas background colour', () => {
    const masked: MTextGeometry = {
      ...mtext('A'),
      background: { flags: 3, scale: 1.5 },
    };
    const c = setup([entity('20', masked)]).redraw();
    expect(c.calls.filter((k) => k[0] === 'fill').map((k) => k[1])).toEqual(['#000000']);
  });
});

// M1-38: the user's font files (TrueType/OpenType, and SHX for M1-37) reach the renderer as
// bytes beside the bundled fonts. A style naming a file the user added draws with it (fills
// for TrueType) instead of its bundled stand-in, and a font added or removed while the drawing
// is open redraws and re-bounds its text; a file that does not parse is reported, not drawn.
import { toleranceForSize, type EntityInit, type TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { buildShapes } from '../../text/test/shx/builder';
import { fontBytes, testFont } from '../../text/test/ttf/fonts';
import simplex from '../../../assets/fonts/oet-simplex.json';
import { RenderSession, type FontSources } from '../src/index';
import { drawingInit, entity, MODEL, surface } from './fixtures';

type Recorded = ReturnType<typeof surface>;

const style = (handle: string, font: string): TextStyleRecord => ({
  handle,
  name: `S${handle}`,
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const text = (handle: string, styleHandle: string, y: number): EntityInit =>
  entity(handle, {
    kind: 'TEXT',
    value: 'AB',
    style: styleHandle,
    position: { x: 0, y },
    height: 10,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  });

const BUNDLED = { shx: [{ name: 'oet-simplex', source: JSON.stringify(simplex) }] };
const SANS = { name: 'TestSans.TTF', bytes: fontBytes(testFont()) };
/** romans.shx with A and B as a 1×1 square from the pen, then 2 east. */
const ROMANS = {
  name: 'romans.shx',
  bytes: buildShapes(
    [
      { code: 65, name: 'UCA', bytes: [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0] },
      { code: 66, name: 'UCB', bytes: [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0] },
    ],
    { name: 'User romans', above: 1, below: 0 },
  ),
};

function setup(fonts: FontSources) {
  const layers: Recorded[] = [];
  const s = new RenderSession({
    document: {
      init: drawingInit([text('20', '30', 0), text('21', '31', 20)], {
        textStyles: [style('30', 'testsans.ttf'), style('31', 'romans.shx')],
      }),
      block: MODEL,
      tol: toleranceForSize(1000),
    },
    surface: surface('visible'),
    createLayer: () => {
      const l = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(l);
      return l;
    },
    style: { background: '#000000', foreground: '#ffffff', showLineweights: false },
    requestIdle: () => {},
    fonts,
  });
  s.renderer.resize(200, 100, 1);
  s.renderer.setView({ center: { x: 20, y: 15 }, scale: 3 });
  const draw = () => {
    const scene = layers[0]!;
    scene.ctx.clear();
    s.renderer.frame();
    return scene.ctx;
  };
  return { s, draw };
}

describe('user font files in a render session (M1-38)', () => {
  it('draws a TrueType style with the user font, matched by file name in any case', () => {
    const { s, draw } = setup({ ...BUNDLED, files: [SANS] });
    // The TrueType glyphs fill; romans.shx has no user file, so it strokes with oet-simplex.
    expect(draw().named('fill').length).toBeGreaterThan(0);
    expect(s.fonts.substitutions.has('testsans.ttf')).toBe(false);
    expect(s.fonts.substitutions.get('romans.shx')).toBe('oet-simplex');
  });

  it('puts a user SHX file ahead of the bundled stand-in for its name', () => {
    const { s, draw } = setup({ ...BUNDLED, files: [ROMANS] });
    draw();
    expect(s.fonts.substitutions.has('romans.shx')).toBe(false);
    // The user romans is 1 unit tall per 1 unit above: its text box is 10 high, like the text.
    const b = s.index.bounds(s.model.ids.idOf('21')!);
    expect(b?.kind).toBe('box');
  });

  it('redraws and re-bounds text when fonts change while the drawing is open', () => {
    const { s, draw } = setup(BUNDLED);
    expect(draw().named('fill')).toHaveLength(0);
    const sansId = s.model.ids.idOf('20')!;
    const before = s.index.bounds(sansId);
    s.setFonts({ ...BUNDLED, files: [SANS] });
    expect(draw().named('fill').length).toBeGreaterThan(0);
    expect(s.index.bounds(sansId)).not.toEqual(before);
    s.setFonts(BUNDLED);
    expect(draw().named('fill')).toHaveLength(0);
  });

  it('reports a file that does not parse and draws as if it were absent', () => {
    const bad = { name: 'broken.ttf', bytes: new Uint8Array([1, 2, 3, 4]) };
    const { s, draw } = setup({ ...BUNDLED, files: [bad, SANS] });
    expect(s.fontWarnings).toEqual(['broken.ttf']);
    expect(draw().named('fill').length).toBeGreaterThan(0);
  });
});

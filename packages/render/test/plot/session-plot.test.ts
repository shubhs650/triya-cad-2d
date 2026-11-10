// A render session's plot (M2-17): the space tessellated as the screen draws it, with TrueType
// glyphs carrying only their font file, one object per font, so the parts cross to the main
// thread by structured clone and a PDF embeds each font once.
import { toleranceForSize, type EntityInit, type TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { fontBytes, testFont } from '../../../text/test/ttf/fonts';
import { RenderSession, type PlotPathPart } from '../../src/index';
import { drawingInit, entity, line, MODEL, surface } from '../fixtures';

const style: TextStyleRecord = {
  handle: '30',
  name: 'Sans',
  font: 'testsans.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const text = (handle: string, y: number): EntityInit =>
  entity(handle, {
    kind: 'TEXT',
    value: 'AB',
    style: '30',
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

function session() {
  return new RenderSession({
    document: {
      init: drawingInit(
        [
          entity('20', line(0, 0, 10, 0), { color: { kind: 'aci', index: 1 } }),
          text('21', 5),
          text('22', 20),
        ],
        { textStyles: [style] },
      ),
      block: MODEL,
      tol: toleranceForSize(1000),
    },
    surface: surface('visible'),
    createLayer: () => surface('scene'),
    requestIdle: () => {},
    fonts: { files: [{ name: 'TestSans.TTF', bytes: fontBytes(testFont()) }] },
  });
}

describe('RenderSession.plot', () => {
  it('plots the space drawn with its objects’ own properties when no table is given', () => {
    const parts = session().plot();
    expect(parts[0]).toMatchObject({ kind: 'stroke', paint: { color: [255, 0, 0] } });
  });

  it('reduces each glyph’s font to its bytes, one object per font, cloneable', () => {
    const parts = session().plot();
    const glyphs = parts.flatMap((p) =>
      p.kind === 'fill' ? ((p as PlotPathPart).glyphs ?? []) : [],
    );
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    const fonts = new Set(glyphs.map((g) => g.font));
    expect(fonts.size).toBe(1);
    const [font] = fonts;
    expect(Object.keys(font!)).toEqual(['bytes']);
    expect(() => structuredClone(parts)).not.toThrow();
  });
});

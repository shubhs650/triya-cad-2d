// Canvas2DRenderer with leaders (M1-52): a MULTILEADER draws its arrowhead, leader line,
// landing and text in their own colours, inside blocks too, is bounded by what it draws, and is
// picked by its line; a LEADER draws its path and arrowhead in its DIMSTYLE's DIMCLRD.
import {
  SpatialIndex,
  toleranceForSize,
  type EntityInit,
  type InsertGeometry,
  type LeaderGeometry,
  type MultiLeaderGeometry,
  type TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, textBounds, type RenderStyle } from '../src/index';
import { drawing, entity, MODEL, surface } from './fixtures';
import { fontBook } from './text-fonts';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const STYLE = '30';
const BLOCK = '40';
const DIMSTYLE = '41';

const romans: TextStyleRecord = {
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

/** Red leader from (0, 0) to (10, 0), a 2-unit landing, text "A" 1 high at (13, 0.5). */
const mleader: MultiLeaderGeometry = {
  kind: 'MULTILEADER',
  overrideFlags: 0,
  pathType: 1,
  lineColor: { kind: 'aci', index: 1 },
  lineweight: 'ByBlock',
  landing: true,
  dogleg: true,
  doglegLength: 2,
  arrowheadSize: 1,
  contentType: 2,
  scale: 1,
  annotative: false,
  textLeftAttachment: 1,
  textRightAttachment: 1,
  textTopAttachment: 9,
  textBottomAttachment: 9,
  textAttachmentDirection: 0,
  textAngleType: 1,
  textAlignment: 0,
  textFrame: false,
  contentBase: { x: 12, y: 0 },
  landingGap: 1,
  text: {
    content: 'A',
    style: STYLE,
    position: { x: 13, y: 0.5 },
    rotation: 0,
    height: 1,
    width: 0,
    boundaryHeight: 0,
    lineSpacing: 1,
    lineSpacingStyle: 1,
    attachment: 1,
    flow: 1,
    color: { kind: 'byBlock' },
  },
  branches: [
    {
      index: 0,
      connection: { x: 10, y: 0 },
      direction: { x: 1, y: 0 },
      doglegLength: 2,
      lines: [{ index: 0, vertices: [{ x: 0, y: 0 }] }],
    },
  ],
};

function setup(entities: EntityInit[]) {
  const fonts = fontBook();
  const d = drawing(entities, {
    blocks: [{ handle: BLOCK, name: 'NOTE' }],
    textStyles: [romans],
    dimStyles: [{ handle: DIMSTYLE, name: 'ISO-25', vars: { DIMASZ: 1, DIMCLRD: 3 } }],
  });
  const index = SpatialIndex.build(d.model, {
    tol: toleranceForSize(1000),
    annotationBounds: textBounds({ fonts, style: (h) => d.model.tables.textStyles.get(h) }),
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
    fonts,
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 7, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, index, redraw };
}

const painted = (c: ReturnType<ReturnType<typeof setup>['redraw']>, name: string) =>
  c.calls.filter((k) => k[0] === name).map((k) => k[1]);

describe('multileaders in the renderer', () => {
  it('draws the arrowhead, line and landing in the leader colour and the text ByBlock', () => {
    const c = setup([entity('20', mleader)]).redraw();
    expect(painted(c, 'fill')).toEqual(['#ff0000']);
    // One red stroke for line and landing, one white for the text (ByBlock → layer 0).
    expect(painted(c, 'stroke').sort()).toEqual(['#ff0000', '#ffffff']);
  });

  it('draws inside a block reference', () => {
    const insert: InsertGeometry = {
      kind: 'INSERT',
      block: BLOCK,
      position: { x: 0, y: -2 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    };
    const c = setup([entity('50', mleader, { owner: BLOCK }), entity('20', insert)]).redraw();
    expect(painted(c, 'fill')).toEqual(['#ff0000']);
    expect(painted(c, 'stroke')).toHaveLength(2);
  });

  it('is bounded by what it draws and picked by its line', () => {
    const { d, r, index } = setup([entity('20', mleader)]);
    const id = d.model.ids.idOf('20')!;
    // Arrow tip at the origin; the text "A" (a glyph 0.2 wide at height 1) hangs from
    // (13, 0.5) by its top-left, so its cap-height run box reaches down to y = -0.5.
    const b = index.bounds(id);
    if (b?.kind !== 'box') throw new Error('expected a box');
    expect(b.box.minX).toBeCloseTo(0);
    expect(b.box.maxX).toBeCloseTo(13.2);
    expect(b.box.minY).toBeCloseTo(-0.5);
    expect(b.box.maxY).toBeCloseTo(0.5);
    r.frame();
    // The line at x = 5 is screen (50 + 30, 50).
    expect(r.hitTest({ x: 80, y: 50 }, 3)).toEqual([id]);
    expect(r.hitTest({ x: 80, y: 80 }, 3)).toEqual([]);
  });

  it('draws a LEADER in its dimension line colour, arrowhead filled', () => {
    const leader: LeaderGeometry = {
      kind: 'LEADER',
      style: DIMSTYLE,
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      arrowhead: true,
      spline: false,
      creationType: 3,
      textHeight: 0,
      textWidth: 0,
      horizontalDirection: { x: 1, y: 0 },
      blockOffset: { x: 0, y: 0 },
      annotationOffset: { x: 0, y: 0 },
    };
    const { d, r, index, redraw } = setup([entity('20', leader)]);
    const c = redraw();
    expect(painted(c, 'fill')).toEqual(['#00ff00']);
    expect(painted(c, 'stroke')).toEqual(['#00ff00']);
    const id = d.model.ids.idOf('20')!;
    expect(index.bounds(id)).toMatchObject({ kind: 'box', box: { minX: 0, maxX: 10 } });
    expect(r.hitTest({ x: 80, y: 50 }, 3)).toEqual([id]);
  });
});

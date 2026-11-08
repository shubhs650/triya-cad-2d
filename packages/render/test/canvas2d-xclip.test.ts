// XCLIP (M1-103): a block reference with a SPATIAL_FILTER draws only the part of its block
// inside the clip boundary, which follows the reference as it moves; nested clips intersect;
// XCLIP OFF (DXF 71 = 0) shows the whole block; the frame shows unless XCLIPFRAME is 0; the
// reference's attributes are not clipped; a pick on a clipped-away part misses.
import type {
  EntityGeometry,
  EntityInit,
  HeaderValue,
  InsertGeometry,
  SpatialFilter,
  TextStyleRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, expandInsert, insertClips, type RenderStyle } from '../src/index';
import { change, drawing, entity, line, MODEL, surface, type Call } from './fixtures';
import { defaultPaint } from '../src/paint';
import { fontBook } from './text-fonts';

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

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const B = '40';
const N = '41';

// prettier-ignore
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
];

const insertOf = (block: string, extra: Partial<InsertGeometry> = {}): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
  ...extra,
});

const filterOf = (handle: string, insert: string, extra: Partial<SpatialFilter> = {}) =>
  ({
    handle,
    type: 'SPATIAL_FILTER',
    owner: `${handle}0`,
    insert,
    boundary: [
      { x: 2, y: -1 },
      { x: 6, y: 1 },
    ],
    normal: { x: 0, y: 0, z: 1 },
    origin: { x: 0, y: 0, z: 0 },
    enabled: true,
    inverseInsert: IDENTITY,
    boundaryTransform: IDENTITY,
    ...extra,
  }) satisfies SpatialFilter;

function setup(
  entities: EntityInit[],
  objects: SpatialFilter[],
  header: [string, HeaderValue][] = [],
) {
  const d = drawing(entities, {
    blocks: [
      { handle: B, name: 'B' },
      { handle: N, name: 'N' },
    ],
    objects,
    header,
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
  });
  r.resize(100, 50, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, redraw };
}

const lineInB = entity('50', line(0, 0, 10, 0), { owner: B });
const only = (calls: Call[], names: readonly string[]) => calls.filter((c) => names.includes(c[0]));

describe('XCLIP', () => {
  it('clips the block to the boundary and strokes the frame outside the clip', () => {
    const { redraw } = setup([lineInB, entity('20', insertOf(B))], [filterOf('60', '20')]);
    const c = redraw();
    // The view centre (5, 0) is the path origin: the rectangle (2, −1)–(6, 1) is (−3, −1)–(1, 1).
    expect(only(c.calls, ['save', 'clip', 'restore', 'stroke'])).toEqual([
      ['save'],
      ['clip', 'nonzero'],
      ['stroke', '#ffffff', 1],
      ['restore'],
      ['stroke', '#ffffff', 1],
    ]);
    const clipAt = c.calls.findIndex((k) => k[0] === 'clip');
    const path = c.calls
      .slice(0, clipAt)
      .filter((k) => k[0] === 'moveTo' || k[0] === 'lineTo')
      .slice(-4);
    expect(path).toEqual([
      ['moveTo', -3, -1],
      ['lineTo', 1, -1],
      ['lineTo', 1, 1],
      ['lineTo', -3, 1],
    ]);
  });

  it('moves the clip with the reference', () => {
    const { d, r, redraw } = setup([lineInB, entity('20', insertOf(B))], [filterOf('60', '20')]);
    r.apply(
      change(d, (b) =>
        b.updateEntity(d.model.ids.idOf('20')!, {
          geom: insertOf(B, { position: { x: 1, y: 2 } }),
        }),
      ),
    );
    const c = redraw();
    const clipAt = c.calls.findIndex((k) => k[0] === 'clip');
    const [first] = c.calls
      .slice(0, clipAt)
      .filter((k) => k[0] === 'moveTo')
      .slice(-1);
    expect(first).toEqual(['moveTo', -2, 1]);
  });

  it('draws the whole block and no frame when clipping is off', () => {
    const { redraw } = setup(
      [lineInB, entity('20', insertOf(B))],
      [filterOf('60', '20', { enabled: false })],
    );
    expect(only(redraw().calls, ['save', 'clip', 'restore', 'stroke'])).toEqual([
      ['stroke', '#ffffff', 1],
    ]);
  });

  it('hides the frame when XCLIPFRAME is 0', () => {
    const { redraw } = setup(
      [lineInB, entity('20', insertOf(B))],
      [filterOf('60', '20')],
      [['$XCLIPFRAME', 0]],
    );
    expect(only(redraw().calls, ['save', 'clip', 'restore', 'stroke'])).toEqual([
      ['save'],
      ['clip', 'nonzero'],
      ['stroke', '#ffffff', 1],
      ['restore'],
    ]);
  });

  it('picks only the part that shows', () => {
    const { r } = setup(
      [lineInB, entity('20', insertOf(B))],
      [filterOf('60', '20')],
      [['$XCLIPFRAME', 0]],
    );
    // Screen (50, 25) is the view centre (5, 0), inside the clip; (90, 25) is (9, 0), outside.
    expect(r.hitTest({ x: 50, y: 25 }, 3)).toHaveLength(1);
    expect(r.hitTest({ x: 90, y: 25 }, 3)).toEqual([]);
  });

  it('redraws when a change set turns the clip off', () => {
    const { d, r, redraw } = setup([lineInB, entity('20', insertOf(B))], [filterOf('60', '20')]);
    redraw();
    r.apply(change(d, (b) => b.updateObject('60', { enabled: false } as Partial<SpatialFilter>)));
    expect(redraw().named('clip')).toEqual([]);
  });
});

describe('expandInsert with XCLIP', () => {
  const src = (d: ReturnType<typeof drawing>) => ({
    model: d.model,
    paint: defaultPaint,
    insertContext: defaultPaint.insertContext,
    order: (block: string) => d.model.blockEntities(block),
    clip: insertClips(d.model),
  });

  it('intersects nested clips and leaves attributes unclipped', () => {
    const d = drawing(
      [
        lineInB,
        entity('51', insertOf(B), { owner: N }),
        entity(
          '20',
          insertOf(N, {
            position: { x: 100, y: 0 },
            attributes: [
              {
                handle: '70',
                tag: 'T',
                value: 'A',
                style: STYLE,
                position: { x: 108, y: 0 },
                height: 1,
                rotation: 0,
                widthFactor: 1,
                oblique: 0,
                halign: 0,
                valign: 0,
                backward: false,
                upsideDown: false,
                flags: 0,
                layer: '10',
                color: { kind: 'byLayer' },
                linetype: 'ByLayer',
                lineweight: 'ByLayer',
                transparency: 'ByLayer',
                ltScale: 1,
                visible: true,
              },
            ],
          }),
        ),
      ],
      {
        blocks: [
          { handle: B, name: 'B' },
          { handle: N, name: 'N' },
        ],
        objects: [
          filterOf('60', '51'),
          // Stored where the outer reference stood when clipped (at 100, 0): (101, −2)–(104, 2).
          filterOf('61', '20', {
            boundary: [
              { x: 101, y: -2 },
              { x: 104, y: 2 },
            ],
            // prettier-ignore
            inverseInsert: [
              1, 0, 0, -100,
              0, 1, 0, 0,
              0, 0, 1, 0,
            ],
          }),
        ],
        header: [['$XCLIPFRAME', 0]],
        textStyles: [style],
      },
    );
    const outer = d.model.entityByHandle('20')!;
    const text = { fonts: fontBook(), style: (h: string) => d.model.tables.textStyles.get(h) };
    const { prims } = expandInsert(outer, { ...src(d), tessellate: { text } }, { dashes: false });
    const clipped = prims.filter((p) => p.clip);
    expect(clipped).toHaveLength(1);
    // The inner clip (2, −1)–(6, 1) and the outer (1, −2)–(4, 2), both in the drawing at x + 100.
    expect(clipped[0]!.clip).toEqual([
      [101, -2, 104, -2, 104, 2, 101, 2],
      [102, -1, 106, -1, 106, 1, 102, 1],
    ]);
    // The attribute's text, outside both clips at x 108, is drawn, unclipped.
    const glyphs = prims.filter((p) => (p.kind === 'stroke' || p.kind === 'fill') && p.text);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((p) => !p.clip)).toBe(true);
  });
});

// Canvas2DRenderer with drawing style (M1-13 part 3): linetype dashes and their level of detail,
// re-fitting on LTSCALE and linetype changes, picking in the gaps, lineweights in model and
// paper space, and SORTENTSTABLE draw order.
import type { EntityInit, HeaderValue, NonGraphicalObject, SortEntsTable } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, createPaint, type RenderStyle } from '../src/index';
import {
  change,
  dash,
  DASHED,
  drawing,
  entity,
  LAYER_DASHED,
  LAYER_RED,
  line,
  MODEL,
  PAPER,
  surface,
} from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const LWT: RenderStyle = { ...DARK, showLineweights: true };

function setup(
  entities: EntityInit[],
  o: {
    block?: string;
    header?: [string, HeaderValue][];
    objects?: NonGraphicalObject[];
    lwDefault?: number;
  } = {},
) {
  const d = drawing(entities, {
    ...(o.header ? { header: o.header } : {}),
    ...(o.objects ? { objects: o.objects } : {}),
  });
  const layers: ReturnType<typeof surface>[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: o.block ?? MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const s = surface(layers.length === 0 ? 'scene' : 'transient');
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
    ...(o.lwDefault === undefined ? {} : { paint: createPaint({ lwDefault: o.lwDefault }) }),
  });
  r.resize(100, 50, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 10 });
  const scene = layers[0]!;
  const redraw = () => {
    scene.ctx.clear();
    r.frame();
    return scene.ctx;
  };
  return { d, r, scene, redraw };
}

const dashedLine = (extra: Partial<EntityInit> = {}) =>
  entity('20', line(0, 0, 10, 0), { layer: LAYER_DASHED, ...extra });

const sortents = (entries: SortEntsTable['entries']): SortEntsTable => ({
  handle: '30',
  type: 'SORTENTSTABLE',
  owner: '31',
  block: MODEL,
  entries,
});

describe('linetypes', () => {
  it('strokes the dashes of an entity on a dashed layer, in one batched path', () => {
    const { redraw } = setup([dashedLine()]);
    const c = redraw();
    expect(c.named('moveTo')).toHaveLength(14);
    expect(c.named('moveTo')[0]).toEqual(['moveTo', -5, 0]);
    expect(c.named('stroke')).toHaveLength(1);
  });

  it('draws the line continuous once a pattern is under a pixel on screen', () => {
    // ARCHITECTURE.md §7.2 LOD: "dashed linetypes below 1 px per pattern unit → solid".
    const { r, redraw } = setup([dashedLine()]);
    r.setView({ center: { x: 5, y: 0 }, scale: 1 }); // 0.75 px per pattern, 10 px long
    const c = redraw();
    expect(c.named('moveTo')).toHaveLength(1);
    expect(c.named('lineTo')).toEqual([['lineTo', 5, 0]]);
  });

  it('fits the dashes when a zoom first shows them', () => {
    const { r, redraw } = setup([dashedLine()]);
    r.setView({ center: { x: 5, y: 0 }, scale: 1 });
    expect(redraw().named('moveTo')).toHaveLength(1);
    r.setView({ center: { x: 5, y: 0 }, scale: 10 });
    expect(redraw().named('moveTo')).toHaveLength(14);
  });

  it('applies the object linetype scale', () => {
    const { redraw } = setup([dashedLine({ ltScale: 2 })]);
    expect(redraw().named('moveTo')).toHaveLength(7);
  });

  it('re-fits every dash when LTSCALE changes', () => {
    const { d, r, redraw } = setup([dashedLine()]);
    redraw();
    r.apply(change(d, (b) => b.setHeader('$LTSCALE', 2)));
    expect(redraw().named('moveTo')).toHaveLength(7);
  });

  it('re-fits every dash when a linetype changes', () => {
    const { d, r, redraw } = setup([dashedLine()]);
    redraw();
    r.apply(
      change(d, (b) =>
        b.updateTableRecord('linetypes', DASHED, {
          patternLength: 1.5,
          elements: [dash(1), dash(-0.5)],
        }),
      ),
    );
    expect(redraw().named('moveTo')).toHaveLength(7);
  });

  it('picks a dashed line in a gap', () => {
    const { d, r } = setup([dashedLine()]);
    // World (0.5, 0) lies in the first gap, 0.375 to 0.625; the aperture is 0.1 units.
    const ids = r.hitTest({ x: 5, y: 25 }, 1);
    expect(ids.map((id) => d.model.ids.handleOf(id))).toEqual(['20']);
  });

  // M1-45 part 2: XLINE and RAY have no ends to fit a pattern between, so their dashes are laid
  // out from the base point at draw time, over the part of the line on screen. AutoCAD does
  // not document where an infinite line's pattern starts; anchoring it at the base point keeps
  // every dash where it is while panning, which is what a drafter sees in AutoCAD.
  const xline = (extra: Partial<EntityInit> = {}, kind: 'XLINE' | 'RAY' = 'XLINE') =>
    entity(
      '21',
      { kind, base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      {
        layer: LAYER_DASHED,
        ...extra,
      },
    );
  /** The world x of each moveTo, for a view centred on `cx`. */
  const starts = (c: ReturnType<ReturnType<typeof setup>['redraw']>, cx: number) =>
    c.named('moveTo').map((m) => Math.round(((m[1] as number) + cx) * 1e9) / 1e9);

  it('dashes an XLINE from its base point, and the dashes stay put while panning', () => {
    const { r, redraw } = setup([xline()]);
    // View 0..10: dashes 0.5 long every 0.75 from x = 0.
    const at = starts(redraw(), 5);
    expect(at).toHaveLength(14);
    expect(at.slice(0, 3)).toEqual([0, 0.75, 1.5]);
    r.setView({ center: { x: 5.3, y: 0 }, scale: 10 });
    const panned = starts(redraw(), 5.3);
    // The dash at 0..0.5 is cut at the view's edge; the rest are where they were.
    expect(panned.slice(0, 3)).toEqual([0.3, 0.75, 1.5]);
    r.setView({ center: { x: -4.7, y: 0 }, scale: 10 });
    expect(starts(redraw(), -4.7).slice(0, 2)).toEqual([-9.7, -9]);
  });

  it('dashes a RAY only from its base point on', () => {
    const { r, redraw } = setup([xline({}, 'RAY')]);
    r.setView({ center: { x: 0, y: 0 }, scale: 10 });
    const at = starts(redraw(), 0);
    expect(at[0]).toBe(0);
    expect(at).toHaveLength(7);
  });

  it('draws an infinite line continuous once a pattern is under a pixel', () => {
    const { r, redraw } = setup([xline()]);
    r.setView({ center: { x: 5, y: 0 }, scale: 1 });
    expect(redraw().named('moveTo')).toHaveLength(1);
  });
});

describe('lineweights', () => {
  const heavy = (extra: Partial<EntityInit> = {}) =>
    entity('20', line(0, 0, 10, 0), { lineweight: 50, ...extra });
  const width = (c: ReturnType<ReturnType<typeof setup>['redraw']>) => c.named('stroke')[0]![2];

  it('shows Model-tab lineweights as whole pixels that do not follow the zoom', () => {
    const { r, redraw } = setup([heavy()]);
    r.setStyle(LWT);
    expect(width(redraw())).toBe(2); // 0.5 mm at 96 dpi is 1.89 px
    r.setView({ center: { x: 5, y: 0 }, scale: 40 });
    expect(width(redraw())).toBe(2);
    r.resize(100, 50, 2);
    expect(width(redraw())).toBe(4);
  });

  it('shows Default at LWDEFAULT', () => {
    const { r, redraw } = setup([heavy({ lineweight: 'Default' })], { lwDefault: 100 });
    r.setStyle(LWT);
    expect(width(redraw())).toBe(4); // 1 mm is 3.78 px
  });

  it('shows layout lineweights in paper millimetres at the current zoom', () => {
    const { r, redraw } = setup([heavy({ owner: PAPER })], { block: PAPER });
    r.setStyle(LWT);
    expect(width(redraw())).toBeCloseTo(5, 12); // 0.5 mm × 10 px per mm
    r.setView({ center: { x: 5, y: 0 }, scale: 20 });
    expect(width(redraw())).toBeCloseTo(10, 12);
    r.setView({ center: { x: 5, y: 0 }, scale: 0.5 });
    expect(width(redraw())).toBe(1);
  });
});

describe('draw order', () => {
  const pair = [
    entity('20', line(0, 2, 1, 2), { layer: LAYER_RED }),
    entity('21', line(0, 0, 1, 0)),
  ];
  const colours = (c: ReturnType<ReturnType<typeof setup>['redraw']>) =>
    c.named('stroke').map((s) => s[1]);

  it('draws in SORTENTSTABLE order', () => {
    // DRAWORDER sent 20 to the front: its sort handle is above 21.
    const { redraw } = setup(pair, { objects: [sortents([{ entity: '20', sort: '40' }])] });
    expect(colours(redraw())).toEqual(['#ffffff', '#ff0000']);
  });

  it('follows changes to the table', () => {
    const { d, r, redraw } = setup(pair);
    expect(colours(redraw())).toEqual(['#ff0000', '#ffffff']);
    let handle = '';
    r.apply(
      change(d, (b) => {
        handle = b.addObject({
          type: 'SORTENTSTABLE',
          owner: '31',
          block: MODEL,
          entries: [{ entity: '20', sort: '40' }],
        } as Omit<SortEntsTable, 'handle'>).handle;
      }),
    );
    expect(colours(redraw())).toEqual(['#ffffff', '#ff0000']);
    r.apply(change(d, (b) => b.removeObject(handle)));
    expect(colours(redraw())).toEqual(['#ff0000', '#ffffff']);
  });

  it('ignores the table of another block', () => {
    const other = { ...sortents([{ entity: '20', sort: '40' }]), block: PAPER };
    const { redraw } = setup(pair, { objects: [other] });
    expect(colours(redraw())).toEqual(['#ff0000', '#ffffff']);
  });
});

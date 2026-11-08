// M2-03: what a selection window takes, against what is drawn (AutoCAD 2024 Help, "To Select
// Objects"): a window (left to right) takes objects wholly inside it, a crossing window (right
// to left) objects inside it or crossing its edge; XLINEs only ever cross. Then the renderer's
// `select` on a drawing (INSERTs by everything they draw, dashed lines by their continuous
// path, objects on layers that are off not at all) and the selection highlight.
import type { EntityGeometry, EntityInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  primCrosses,
  primInside,
  type RenderPrimitive,
} from '../src/index';
import { change, drawing, entity, LAYER_RED, line, MODEL, surface, type Call } from './fixtures';

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

const stroke = (path: number[], extra: Partial<RenderPrimitive> = {}): RenderPrimitive =>
  ({ kind: 'stroke', color: 'foreground', path, ...extra }) as RenderPrimitive;

describe('primInside / primCrosses', () => {
  const seg = stroke([PATH_M, 0, 0, PATH_L, 10, 0]);

  it('a line: a window must hold both ends; a crossing window touches any part', () => {
    expect(primInside(seg, box(-1, -1, 11, 1))).toBe(true);
    expect(primInside(seg, box(-1, -1, 9, 1))).toBe(false);
    expect(primCrosses(seg, box(4, -1, 6, 1))).toBe(true);
    // The window's edge on the line counts as crossing it.
    expect(primCrosses(seg, box(4, 0, 6, 1))).toBe(true);
    expect(primCrosses(seg, box(4, 0.1, 6, 1))).toBe(false);
  });

  it('an arc by its true extent, not its ends', () => {
    // The upper half of a circle of radius 5 about the origin, counter-clockwise.
    const arc = stroke([PATH_M, 5, 0, PATH_A, 0, 0, 5, 0, Math.PI, 1]);
    expect(primInside(arc, box(-5, 0, 5, 5))).toBe(true);
    // Its top is at y = 5: a window to 4.9 leaves it out though both ends are in.
    expect(primInside(arc, box(-5, 0, 5, 4.9))).toBe(false);
    // A crossing window over its top, away from its ends, takes it; one below its chord does not.
    expect(primCrosses(arc, box(-1, 4.9, 1, 6))).toBe(true);
    expect(primCrosses(arc, box(-1, 1, 1, 2))).toBe(false);
    // The lower half of the circle is not drawn.
    expect(primCrosses(arc, box(-1, -6, 1, -4.9))).toBe(false);
  });

  it('a clockwise arc sweeps the other way', () => {
    // From 0 clockwise to −π: the lower half.
    const arc = stroke([PATH_M, 5, 0, PATH_A, 0, 0, 5, 0, -Math.PI, 0]);
    expect(primCrosses(arc, box(-1, -6, 1, -4.9))).toBe(true);
    expect(primCrosses(arc, box(-1, 4.9, 1, 6))).toBe(false);
  });

  it('a fill is crossed by a window inside it', () => {
    const square = {
      kind: 'fill',
      color: 'foreground',
      path: [PATH_M, 0, 0, PATH_L, 10, 0, PATH_L, 10, 10, PATH_L, 0, 10, PATH_Z],
    } as RenderPrimitive;
    expect(primCrosses(square, box(4, 4, 6, 6))).toBe(true);
    expect(primInside(square, box(4, 4, 6, 6))).toBe(false);
    expect(
      primCrosses(stroke(square.kind === 'fill' ? [...square.path] : []), box(4, 4, 6, 6)),
    ).toBe(false);
  });

  it('a dashed line by its continuous path, so a window over a gap still crosses it', () => {
    const dashed = stroke([PATH_M, 0, 0, PATH_L, 4, 0, PATH_M, 6, 0, PATH_L, 10, 0], {
      continuous: [PATH_M, 0, 0, PATH_L, 10, 0],
    });
    expect(primCrosses(dashed, box(4.5, -1, 5.5, 1))).toBe(true);
  });

  it('text by its run boxes too, so a window between letters crosses it', () => {
    const glyphs = {
      kind: 'fill',
      color: 'foreground',
      path: [
        PATH_M,
        0,
        0,
        PATH_L,
        1,
        0,
        PATH_L,
        1,
        2,
        PATH_Z,
        PATH_M,
        3,
        0,
        PATH_L,
        4,
        0,
        PATH_L,
        4,
        2,
        PATH_Z,
      ],
      text: { height: 2, greek: [PATH_M, 0, 0, PATH_L, 4, 0, PATH_L, 4, 2, PATH_L, 0, 2, PATH_Z] },
    } as RenderPrimitive;
    expect(primCrosses(glyphs, box(1.8, 0.5, 2.2, 1))).toBe(true);
    expect(primInside(glyphs, box(-1, -1, 5, 3))).toBe(true);
    expect(primInside(glyphs, box(-1, -1, 3.5, 3))).toBe(false);
  });

  it('an XLINE is never inside a window, and crosses one it passes through', () => {
    const x = {
      kind: 'infinite',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 1 },
      both: true,
      color: 'foreground',
    } as RenderPrimitive;
    expect(primInside(x, box(-1, -1, 1, 1))).toBe(false);
    expect(primCrosses(x, box(-1, -1, 1, 1))).toBe(true);
    expect(primCrosses(x, box(-10, -1, -9, 0))).toBe(false);
    // A RAY runs one way only.
    const ray = { ...x, both: false } as RenderPrimitive;
    expect(primCrosses(ray, box(-6, -6, -4, -4))).toBe(false);
  });

  it('a point', () => {
    const p = { kind: 'point', x: 1, y: 1, color: 'foreground' } as RenderPrimitive;
    expect(primInside(p, box(0, 0, 2, 2))).toBe(true);
    expect(primCrosses(p, box(2, 2, 3, 3))).toBe(false);
  });
});

const B = '40';
const insertOf = (block: string, x: number): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

function setup(entities: EntityInit[]) {
  const d = drawing(entities, { blocks: [{ handle: B, name: 'B' }] });
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
    style: { background: '#000000', foreground: '#ffffff', showLineweights: false },
    requestIdle: () => {},
  });
  r.resize(200, 100, 1);
  r.setView({ center: { x: 10, y: 0 }, scale: 10 });
  const handles = (ids: readonly number[]) => ids.map((id) => d.model.ids.handleOf(id));
  return { d, r, scene: () => layers[0]!.ctx, handles };
}

describe('Canvas2DRenderer.select', () => {
  const entities = [
    entity('20', line(0, 0, 10, 0)),
    entity('21', line(0, 5, 2, 5)),
    // A reference drawing the block's two lines, at x = 20.
    entity('22', insertOf(B, 20)),
    entity('41', line(0, 0, 1, 0), { owner: B }),
    entity('42', line(0, 0, 0, 3), { owner: B }),
    entity('23', line(30, 0, 31, 0), { layer: LAYER_RED }),
  ];

  it('a window takes what is wholly inside, a crossing window what it touches', () => {
    const { r, handles } = setup(entities);
    expect(handles(r.select({ kind: 'window', box: box(-1, -1, 11, 6) }))).toEqual(['20', '21']);
    expect(handles(r.select({ kind: 'window', box: box(-1, -1, 5, 6) }))).toEqual(['21']);
    expect(handles(r.select({ kind: 'crossing', box: box(4, -1, 5, 1) }))).toEqual(['20']);
  });

  it('a block reference by everything it draws', () => {
    const { r, handles } = setup(entities);
    expect(handles(r.select({ kind: 'window', box: box(19, -1, 22, 2) }))).toEqual([]);
    expect(handles(r.select({ kind: 'window', box: box(19, -1, 22, 4) }))).toEqual(['22']);
    expect(handles(r.select({ kind: 'crossing', box: box(19.5, 2, 21, 2.5) }))).toEqual(['22']);
  });

  it('objects on a layer that is off are not taken', () => {
    const { d, r, handles } = setup(entities);
    expect(handles(r.select({ kind: 'crossing', box: box(29, -1, 32, 1) }))).toEqual(['23']);
    r.apply(change(d, (b) => b.updateTableRecord('layers', LAYER_RED, { on: false })));
    expect(handles(r.select({ kind: 'crossing', box: box(29, -1, 32, 1) }))).toEqual([]);
  });

  it('highlights the selection over the scene: a glow and a dashed line in the selection colour', () => {
    const { d, r, scene } = setup(entities);
    r.frame();
    scene().clear();
    r.setHighlight([d.model.ids.idOf('20')!]);
    r.frame();
    const calls = scene().calls as Call[];
    const dashed = calls.findIndex((c) => c[0] === 'setLineDash' && (c[1] as number[]).length > 0);
    expect(dashed).toBeGreaterThan(0);
    const strokes = calls.filter((c) => c[0] === 'stroke' && c[1] === '#4da3ff');
    expect(strokes).toHaveLength(2);
    // Cleared: the scene draws without them.
    scene().clear();
    r.setHighlight([]);
    r.frame();
    expect(
      (scene().calls as Call[]).filter((c) => c[0] === 'stroke' && c[1] === '#4da3ff'),
    ).toEqual([]);
  });
});

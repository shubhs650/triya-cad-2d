// M3-04: what a selection polygon or fence takes, against what is drawn (AutoCAD 2024 Help,
// "SELECT (Command)"): WPolygon "selects objects completely inside a polygon", CPolygon "objects
// within and crossing" it, Fence "all objects crossing a selection fence" (open, and it may
// cross itself). Arcs are exact, as for windows; then the renderer's `select` with a polygon.
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  primCrossesFence,
  primCrossesPolygon,
  primInsidePolygon,
  type RenderPrimitive,
} from '../src/index';
import { drawing, entity, line, MODEL, surface } from './fixtures';

const pts = (...xy: number[]) => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i]!, y: xy[i + 1]! });
  return out;
};

const stroke = (path: number[], extra: Partial<RenderPrimitive> = {}): RenderPrimitive =>
  ({ kind: 'stroke', color: 'foreground', path, ...extra }) as RenderPrimitive;

/** A concave "U": the notch between x 4 and 6 reaches down to y 4. */
const U = pts(0, 0, 10, 0, 10, 10, 6, 10, 6, 4, 4, 4, 4, 10, 0, 10);

describe('primInsidePolygon / primCrossesPolygon', () => {
  it('a line inside a concave polygon only when no side of it crosses the line', () => {
    expect(primInsidePolygon(stroke([PATH_M, 1, 1, PATH_L, 9, 1]), U)).toBe(true);
    // Both ends in the polygon's arms, but the line passes through the notch.
    const across = stroke([PATH_M, 2, 8, PATH_L, 8, 8]);
    expect(primInsidePolygon(across, U)).toBe(false);
    expect(primCrossesPolygon(across, U)).toBe(true);
    // Wholly in the notch: outside, and crossing nothing.
    const notch = stroke([PATH_M, 4.5, 6, PATH_L, 5.5, 6]);
    expect(primInsidePolygon(notch, U)).toBe(false);
    expect(primCrossesPolygon(notch, U)).toBe(false);
  });

  it('a crossing polygon takes what lies inside it without touching a side', () => {
    expect(primCrossesPolygon(stroke([PATH_M, 1, 1, PATH_L, 2, 2]), U)).toBe(true);
    expect(primCrossesPolygon(stroke([PATH_M, 11, 1, PATH_L, 12, 2]), U)).toBe(false);
  });

  it('an arc by its true extent', () => {
    // The upper half of a circle of radius 3 about (5, 1): its top (5, 4) touches the notch.
    const arc = stroke([PATH_M, 8, 1, PATH_A, 5, 1, 3, 0, Math.PI, 1]);
    expect(primCrossesPolygon(arc, U)).toBe(true);
    expect(primInsidePolygon(arc, U)).toBe(false);
    const low = stroke([PATH_M, 7, 1, PATH_A, 5, 1, 2, 0, Math.PI, 1]);
    expect(primInsidePolygon(low, U)).toBe(true);
    // A triangle whose side cuts the arc between its ends, the ends both inside.
    const tri = pts(0, 0, 10, 0, 5, 2);
    const flat = stroke([PATH_M, 6.4, 0.5, PATH_A, 5, 0.5, 1.4, 0, Math.PI, 1]);
    expect(primInsidePolygon(flat, tri)).toBe(false);
    expect(primCrossesPolygon(flat, tri)).toBe(true);
  });

  it('a fill is crossed by a polygon inside it', () => {
    const square = stroke([PATH_M, -5, -5, PATH_L, 5, -5, PATH_L, 5, 5, PATH_L, -5, 5, PATH_Z], {
      kind: 'fill',
    } as Partial<RenderPrimitive>);
    expect(primCrossesPolygon(square, pts(-1, -1, 1, -1, 0, 1))).toBe(true);
    expect(primInsidePolygon(square, pts(-1, -1, 1, -1, 0, 1))).toBe(false);
  });

  it('an XLINE is never inside, a RAY crosses a polygon it starts in', () => {
    const xline: RenderPrimitive = {
      kind: 'infinite',
      color: 'foreground',
      base: { x: 5, y: 2 },
      direction: { x: 1, y: 0 },
      both: true,
    } as RenderPrimitive;
    expect(primInsidePolygon(xline, U)).toBe(false);
    expect(primCrossesPolygon(xline, U)).toBe(true);
    expect(primCrossesPolygon({ ...xline, base: { x: 5, y: 20 } } as RenderPrimitive, U)).toBe(
      false,
    );
  });

  it('a point', () => {
    const p = { kind: 'point', color: 'foreground', x: 2, y: 2 } as RenderPrimitive;
    expect(primInsidePolygon(p, U)).toBe(true);
    expect(primCrossesPolygon(p, U)).toBe(true);
    expect(primInsidePolygon({ ...p, x: 5, y: 6 } as RenderPrimitive, U)).toBe(false);
  });
});

describe('primCrossesFence', () => {
  const fence = pts(0, 5, 10, 5, 10, -5);

  it('takes what any of its lines crosses, not what lies beside them', () => {
    expect(primCrossesFence(stroke([PATH_M, 2, 0, PATH_L, 2, 10]), fence)).toBe(true);
    // Crossed by the second line only.
    expect(primCrossesFence(stroke([PATH_M, 8, 0, PATH_L, 12, 0]), fence)).toBe(true);
    // Inside the angle the fence makes, but never crossing it: a fence is not closed.
    expect(primCrossesFence(stroke([PATH_M, 2, 0, PATH_L, 8, 0]), fence)).toBe(false);
  });

  it('an arc by its true extent', () => {
    // A circle of radius 2 about (5, 2): its top at (5, 4) misses the fence at y 5.
    const circle = stroke([PATH_M, 7, 2, PATH_A, 5, 2, 2, 0, 2 * Math.PI, 1]);
    expect(primCrossesFence(circle, fence)).toBe(false);
    const big = stroke([PATH_M, 8, 2, PATH_A, 5, 2, 3, 0, 2 * Math.PI, 1]);
    expect(primCrossesFence(big, fence)).toBe(true);
    // Only the lower half drawn: the fence over its missing top does not cross it.
    const lower = stroke([PATH_M, 8, 3, PATH_A, 5, 3, 3, 0, -Math.PI, 0]);
    expect(primCrossesFence(lower, pts(0, 5.5, 10, 5.5))).toBe(false);
  });

  it('a fence may cross itself, and an XLINE crosses it', () => {
    const bow = pts(0, 0, 10, 10, 10, 0, 0, 10);
    expect(primCrossesFence(stroke([PATH_M, 4, 5, PATH_L, 6, 5]), bow)).toBe(true);
    const xline = {
      kind: 'infinite',
      color: 'foreground',
      base: { x: 100, y: 1 },
      direction: { x: 1, y: 0 },
      both: true,
    } as RenderPrimitive;
    expect(primCrossesFence(xline, fence)).toBe(true);
    expect(primCrossesFence({ ...xline, both: false } as RenderPrimitive, fence)).toBe(false);
  });
});

describe('Canvas2DRenderer.select with a polygon or fence', () => {
  function setup() {
    const d = drawing([
      entity('20', line(1, 1, 9, 1)),
      entity('21', line(2, 8, 8, 8)),
      entity('22', line(4.5, 6, 5.5, 6)),
      entity('23', line(20, 0, 21, 0)),
    ]);
    const r = new Canvas2DRenderer({
      now: () => 0,
      model: d.model,
      index: d.index,
      block: MODEL,
      surface: surface('visible'),
      createLayer: () => surface('scene'),
      style: { background: '#000000', foreground: '#ffffff', showLineweights: false },
      requestIdle: () => {},
    });
    r.resize(200, 100, 1);
    r.setView({ center: { x: 10, y: 0 }, scale: 10 });
    return { r, handles: (ids: readonly number[]) => ids.map((id) => d.model.ids.handleOf(id)) };
  }
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('WPolygon, CPolygon and Fence', () => {
    const { r, handles } = setup();
    expect(handles(r.select({ kind: 'window', box, polygon: U }))).toEqual(['20']);
    expect(handles(r.select({ kind: 'crossing', box, polygon: U }))).toEqual(['20', '21']);
    const fence = pts(5, 0, 5, 10);
    expect(
      handles(
        r.select({ kind: 'fence', box: { minX: 5, minY: 0, maxX: 5, maxY: 10 }, polygon: fence }),
      ),
    ).toEqual(['20', '21', '22']);
  });
});

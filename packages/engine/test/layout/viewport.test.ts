// M1-18: the model → paper map of a layout VIEWPORT.
import { describe, expect, it } from 'vitest';
import {
  applyPoint,
  VIEWPORT_OFF,
  viewportFrame,
  viewportScale,
  viewportShowsModel,
  viewportTransform,
  type ViewportGeometry,
} from '../../src/index';

const vp = (extra: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 45.5, y: 155.5 },
  width: 55.6,
  height: 48,
  id: 2,
  status: 1,
  flags: 819296,
  viewCenter: { x: 377.4, y: 176.82 },
  viewHeight: 17.718,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...extra,
});

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe('viewportTransform', () => {
  it('puts the view centre at the frame centre, the view height across the frame', () => {
    // VP4.dxf viewport 2.
    const v = vp();
    const m = viewportTransform(v);
    close(applyPoint(m, v.viewCenter), 45.5, 155.5);
    const s = 48 / 17.718;
    expect(viewportScale(v)).toBeCloseTo(s, 12);
    close(applyPoint(m, { x: 377.4, y: 176.82 + 17.718 / 2 }), 45.5, 155.5 + 24);
    close(applyPoint(m, { x: 377.4 + 1, y: 176.82 }), 45.5 + s, 155.5);
  });

  it('measures the view centre from the target', () => {
    const v = vp({
      viewTarget: { x: 100, y: 50, z: 0 },
      viewCenter: { x: 0, y: 0 },
      viewHeight: 48,
    });
    close(applyPoint(viewportTransform(v), { x: 100, y: 50 }), 45.5, 155.5);
  });

  it('turns the drawing counterclockwise by the twist', () => {
    const v = vp({ viewCenter: { x: 0, y: 0 }, viewHeight: 48, twist: Math.PI / 2 });
    // Model +X shows as paper +Y.
    close(applyPoint(viewportTransform(v), { x: 1, y: 0 }), 45.5, 156.5);
  });

  it('takes a scaled plan direction as plan', () => {
    // sample_AC1032.dwg: direction (−6.4e-14, 0, 273.6).
    const v = vp({ viewDirection: { x: -6.39e-14, y: 0, z: 273.57 } });
    const m = viewportTransform(v);
    expect(m.b).toBeCloseTo(0, 12);
    expect(m.c).toBeCloseTo(0, 12);
    expect(m.a).toBeCloseTo(viewportScale(v), 12);
  });

  it('projects model space for an isometric view', () => {
    // SE isometric: world X runs down-right, world Y up-right, both at 30° to the sheet.
    const v = vp({
      viewCenter: { x: 0, y: 0 },
      viewHeight: 48,
      viewDirection: { x: 1, y: -1, z: 1 },
    });
    const m = viewportTransform(v);
    const x = applyPoint(m, { x: 1, y: 0 });
    const y = applyPoint(m, { x: 0, y: 1 });
    expect(x.x - 45.5).toBeGreaterThan(0);
    expect(x.y - 155.5).toBeLessThan(0);
    expect(y.x - 45.5).toBeGreaterThan(0);
    expect(y.y - 155.5).toBeGreaterThan(0);
    expect(Math.atan2(-(x.y - 155.5), x.x - 45.5)).toBeCloseTo(Math.PI / 6, 9);
  });

  it('falls back to plan for a zero view direction', () => {
    const m = viewportTransform(vp({ viewDirection: { x: 0, y: 0, z: 0 } }));
    expect(m.b).toBe(0);
    expect(m.a).toBeGreaterThan(0);
  });
});

describe('viewportShowsModel', () => {
  it('draws model space only through an on, sized floating viewport', () => {
    expect(viewportShowsModel(vp())).toBe(true);
    expect(viewportShowsModel(vp({ id: 1 }))).toBe(false);
    expect(viewportShowsModel(vp({ status: 0 }))).toBe(false);
    expect(viewportShowsModel(vp({ status: -1 }))).toBe(false);
    expect(viewportShowsModel(vp({ flags: VIEWPORT_OFF }))).toBe(false);
    expect(viewportShowsModel(vp({ width: 0 }))).toBe(false);
    expect(viewportShowsModel(vp({ viewHeight: 0 }))).toBe(false);
    expect(viewportScale(vp({ viewHeight: 0 }))).toBe(0);
  });
});

describe('viewportFrame', () => {
  it('is the frame rectangle around the centre', () => {
    expect(viewportFrame(vp({ width: -4, height: 2, center: { x: 1, y: 1 } }))).toEqual({
      minX: -1,
      minY: 0,
      maxX: 3,
      maxY: 2,
    });
  });
});

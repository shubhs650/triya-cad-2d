// M6-02 part 4: ZOOM and PAN in a layout viewport made current treat its frame on the canvas as a
// window of its own; what the canvas's view maths give back is the viewport's own view.
import {
  FLOATING_VIEWPORT_FLAGS,
  paperPointOf,
  viewportViewOf,
  withViewportView,
  type ViewportGeometry,
} from '@triya/engine';
import { modelViewOf, screenToWorld, type ViewTransform } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { panBy, zoomAt } from '../src/canvas/navigate';
import {
  ViewportHistories,
  fitTurned,
  frameOnCanvas,
  frameView,
  maximizedGeometry,
  turnedBox,
  viewportViewFrom,
} from '../src/canvas/viewport-zoom';
import { windowView } from '../src/canvas/views';

/** A 40 × 30 frame about paper 100,100 showing model 15,15 at 1:1 (target 10,20). */
const vp: ViewportGeometry = {
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 40,
  height: 30,
  id: 2,
  status: 2,
  flags: FLOATING_VIEWPORT_FLAGS,
  viewCenter: { x: 5, y: -5 },
  viewHeight: 30,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 10, y: 20, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
};

/** The sheet shown 4 pixels per paper unit, paper 100,100 at the middle of 800 × 600. */
const canvas = { width: 800, height: 600 };
const sheet: ViewTransform = { center: { x: 100, y: 100 }, scale: 4 };

describe("a viewport's frame as a window of its own", () => {
  it('finds the frame on the canvas', () => {
    expect(frameOnCanvas(vp, sheet, canvas)).toEqual({
      size: { width: 160, height: 120 },
      left: 320,
      top: 240,
    });
  });

  it("maps the viewport's own view to and from a view of the frame", () => {
    const size = { width: 160, height: 120 };
    const v = frameView(vp, size);
    expect(v).toEqual({ center: { x: 15, y: 15 }, scale: 4 });
    expect(viewportViewFrom(v, size)).toEqual({ center: { x: 15, y: 15 }, height: 30 });
  });

  it('zooms the wheel about the model point under the cursor, as the canvas shows it', () => {
    const frame = frameOnCanvas(vp, sheet, canvas);
    const cursor = { x: 350, y: 270 };
    // The model point under the cursor, as the canvas maps it through the viewport.
    const before = screenToWorld(modelViewOf(sheet, vp), canvas.width, canvas.height, cursor);
    const local = { x: cursor.x - frame.left, y: cursor.y - frame.top };
    const next = zoomAt(frameView(vp, frame.size), frame.size, local, 2);
    const after = withViewportView(vp, viewportViewFrom(next, frame.size));
    expect(after.viewHeight).toBe(15);
    const still = screenToWorld(modelViewOf(sheet, after), canvas.width, canvas.height, cursor);
    expect(still.x).toBeCloseTo(before.x, 9);
    expect(still.y).toBeCloseTo(before.y, 9);
    // The frame does not move on the sheet.
    expect(after.center).toEqual(vp.center);
  });

  it('fits a ZOOM Window into the frame, its middle at the frame’s', () => {
    const frame = frameOnCanvas(vp, sheet, canvas);
    const win = windowView({ x: 0, y: 0 }, { x: 80, y: 20 }, frame.size)!;
    const after = withViewportView(vp, viewportViewFrom(win, frame.size));
    // 80 wide in a 4:3 frame: the width decides, 60 high.
    expect(after.viewHeight).toBeCloseTo(60, 9);
    expect(paperPointOf(after, { x: 40, y: 10 })).toEqual(vp.center);
  });
});

describe('a twisted viewport’s frame (M6-02 part 15)', () => {
  /** The same frame and view as `vp`, model space turned 30° counterclockwise on the sheet. */
  const twisted = withViewportView(
    { ...vp, twist: Math.PI / 6 },
    { center: { x: 15, y: 15 }, height: 30 },
  );
  const frame = frameOnCanvas(twisted, sheet, canvas);

  it('is a turned view of its frame', () => {
    const v = frameView(twisted, frame.size);
    expect(v.rotation).toBeCloseTo(Math.PI / 6, 12);
    expect(v.scale).toBeCloseTo(4, 12);
    expect(v.center.x).toBeCloseTo(15, 9);
    expect(v.center.y).toBeCloseTo(15, 9);
  });

  it('zooms the wheel and pans about the model point under the cursor, turned', () => {
    const cursor = { x: 350, y: 270 };
    const before = screenToWorld(modelViewOf(sheet, twisted), canvas.width, canvas.height, cursor);
    const local = { x: cursor.x - frame.left, y: cursor.y - frame.top };
    const zoomed = zoomAt(frameView(twisted, frame.size), frame.size, local, 2);
    expect(zoomed.rotation).toBeCloseTo(Math.PI / 6, 12);
    const after = withViewportView(twisted, viewportViewFrom(zoomed, frame.size));
    const still = screenToWorld(modelViewOf(sheet, after), canvas.width, canvas.height, cursor);
    expect(still.x).toBeCloseTo(before.x, 9);
    expect(still.y).toBeCloseTo(before.y, 9);
    // A drag right by 40 px moves what was under the cursor 40 px right, along the screen.
    const panned = withViewportView(
      twisted,
      viewportViewFrom(panBy(frameView(twisted, frame.size), 40, 0), frame.size),
    );
    const moved = screenToWorld(modelViewOf(sheet, panned), canvas.width, canvas.height, {
      x: cursor.x + 40,
      y: cursor.y,
    });
    expect(moved.x).toBeCloseTo(before.x, 9);
    expect(moved.y).toBeCloseTo(before.y, 9);
  });

  it('fits a ZOOM Window as the screen shows its corners', () => {
    const r = Math.PI / 6;
    // Two model points the turned frame shows 80 apart across and 20 up: a 80 × 20 window.
    const turn = (u: number, v: number) => ({
      x: u * Math.cos(r) - v * Math.sin(r),
      y: u * Math.sin(r) + v * Math.cos(r),
    });
    const [a, b] = [turn(0, 0), turn(80, 20)];
    const win = fitTurned(r, (t) => windowView(t(a), t(b), frame.size))!;
    expect(win.rotation).toBe(r);
    const after = withViewportView(twisted, viewportViewFrom(win, frame.size));
    expect(after.viewHeight).toBeCloseTo(60, 9);
    const mid = paperPointOf(after, turn(40, 10));
    expect(mid.x).toBeCloseTo(vp.center.x, 9);
    expect(mid.y).toBeCloseTo(vp.center.y, 9);
  });

  it('measures a box of model space along the frame’s turned axes', () => {
    const quarter = (p: { x: number; y: number }) => ({ x: p.y, y: -p.x });
    expect(turnedBox({ minX: 1, minY: 0, maxX: 4, maxY: 2 }, quarter)).toEqual({
      minX: 0,
      minY: -4,
      maxX: 2,
      maxY: -1,
    });
    // Unturned, the fit is the fit.
    const plain = fitTurned(0, () => ({ center: { x: 1, y: 2 }, scale: 3 }));
    expect(plain).toEqual({ center: { x: 1, y: 2 }, scale: 3 });
  });
});

describe('ZOOM Previous of each viewport', () => {
  it('keeps each viewport its own last views, ten at most', () => {
    const h = new ViewportHistories();
    for (let i = 0; i < 12; i++) h.push('A', { center: { x: i, y: 0 }, height: 1 });
    h.push('B', { center: { x: 99, y: 0 }, height: 1 });
    h.push('B', { center: { x: 99, y: 0 }, height: 1 });
    expect(h.previous('B')?.center.x).toBe(99);
    expect(h.previous('B')).toBeUndefined();
    const xs: number[] = [];
    for (let v = h.previous('A'); v; v = h.previous('A')) xs.push(v.center.x);
    expect(xs).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});

describe('a viewport maximized (VPMAX, M6-02 part 7)', () => {
  it('is framed by the whole canvas and shows what its frame showed, about the same point', () => {
    const g = maximizedGeometry(vp, sheet, canvas);
    // The canvas shows paper 0…200 × 25…175.
    expect(g).toMatchObject({ center: sheet.center, width: 200, height: 150 });
    expect(frameOnCanvas(g, sheet, canvas)).toEqual({ size: canvas, left: 0, top: 0 });
    // Its 40 × 30 of model space fit the 4:3 canvas exactly, about model 15,15.
    const v = viewportViewOf(g);
    expect(v.center.x).toBeCloseTo(15, 9);
    expect(v.center.y).toBeCloseTo(15, 9);
    expect(v.height).toBe(30);
    expect(modelViewOf(sheet, g).scale).toBeCloseTo(20, 9);
    // The target stays: model and display coordinates differ as they did.
    expect(g.viewTarget).toEqual(vp.viewTarget);
    // A wide canvas: the frame's height decides.
    const wide = maximizedGeometry(vp, sheet, { width: 1200, height: 300 });
    expect(viewportViewOf(wide).height).toBe(30);
    // A tall one: its width, 40 across 300 pixels of a 600 high canvas.
    const tall = maximizedGeometry(vp, sheet, { width: 300, height: 600 });
    expect(viewportViewOf(tall).height).toBeCloseTo(80, 9);
  });

  it('shows the view it is given, as a resized canvas keeps it', () => {
    const view = { center: { x: 1, y: 2 }, height: 12 };
    const g = maximizedGeometry(vp, sheet, canvas, view);
    const v = viewportViewOf(g);
    expect(v.center.x).toBeCloseTo(1, 9);
    expect(v.center.y).toBeCloseTo(2, 9);
    expect(v.height).toBe(12);
    // Its frame on the canvas is still the whole canvas.
    expect(frameView(g, canvas).scale).toBeCloseTo(50, 9);
  });
});

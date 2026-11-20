// M6-02 part 4: ZOOM and PAN in a layout viewport made current treat its frame on the canvas as a
// window of its own; what the canvas's view maths give back is the viewport's own view.
import {
  FLOATING_VIEWPORT_FLAGS,
  paperPointOf,
  withViewportView,
  type ViewportGeometry,
} from '@triya/engine';
import { modelViewOf, screenToWorld, type ViewTransform } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { zoomAt } from '../src/canvas/navigate';
import {
  ViewportHistories,
  frameOnCanvas,
  frameView,
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
